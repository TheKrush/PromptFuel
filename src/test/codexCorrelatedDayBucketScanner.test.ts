import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCodexCorrelatedTodayBucket } from '../providers/codexCorrelatedDayBucketScanner';

let tmpDir = '';

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

interface TurnSpec {
  turnId: string;
  model: string;
  completedAtEpochMs: number;
  /** Cumulative token_count value carried in from before this turn started (the scanner's per-turn baseline). */
  baseline: TokenUsage;
  /** Cumulative token_count value at the end of this turn; the turn's contribution is last - baseline. */
  last: TokenUsage;
}

/**
 * Builds a Codex rollout JSONL body for one turn using the real event shape observed in a live
 * ~/.codex/sessions/**\/*.jsonl rollout: turn_context -> a token_count seeding the pre-turn cumulative
 * total (so the scanner's baselineTotal-via-lastSeenTotal carry-over picks it up) -> task_started ->
 * token_count with the turn's ending cumulative total -> task_complete.
 */
function turnLines(spec: TurnSpec): string[] {
  const ts = new Date(spec.completedAtEpochMs).toISOString();
  return [
    JSON.stringify({ type: 'turn_context', timestamp: ts, payload: { turn_id: spec.turnId, model: spec.model } }),
    JSON.stringify({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: spec.baseline } } }),
    JSON.stringify({ type: 'event_msg', timestamp: ts, payload: { type: 'task_started', turn_id: spec.turnId } }),
    JSON.stringify({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: spec.last } } }),
    JSON.stringify({ type: 'event_msg', timestamp: ts, payload: { type: 'task_complete', turn_id: spec.turnId, completed_at: spec.completedAtEpochMs / 1000 } })
  ];
}

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };

async function writeSession(dir: string, lines: string[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'rollout-test.jsonl'), lines.join('\n') + '\n', 'utf8');
}

describe('codex correlated day-bucket scanner — cached-token accounting', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-codex-daybucket-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('maps cached_input_tokens to cache-read and derives uncached input, matching the provider total', async () => {
    // Real values from a live Codex rollout token_count event: total_tokens === input_tokens + output_tokens
    // holds exactly, with cached_input_tokens well within input_tokens (subset, not additive).
    const now = Date.now();
    const dir = path.join(tmpDir, 'single-turn');
    await writeSession(dir, turnLines({
      turnId: 't1',
      model: 'gpt-5.4-codex',
      completedAtEpochMs: now,
      baseline: ZERO_USAGE,
      last: { input_tokens: 19573, output_tokens: 66, cached_input_tokens: 4480, reasoning_output_tokens: 58, total_tokens: 19639 }
    }));

    const bucket = await readCodexCorrelatedTodayBucket(dir, new Date(now));

    assert.equal(bucket.available, true);
    assert.equal(bucket.cacheReadInputTokens, 4480, 'cached_input_tokens must map to cache-read, not cache-creation');
    assert.equal(bucket.cacheCreationInputTokens, 0, 'Codex reports no distinct cache-write signal');
    assert.equal(bucket.inputTokens, 19573 - 4480, 'inputTokens must be the derived uncached remainder');
    assert.equal(bucket.outputTokens, 66);
    assert.equal(bucket.totalTokens, 19639, 'provider-reported total is preserved as the cross-check value');
    // The disjoint components must reconstruct the provider-reported total exactly (no double-count).
    assert.equal(bucket.inputTokens + bucket.outputTokens + bucket.cacheCreationInputTokens + bucket.cacheReadInputTokens, bucket.totalTokens);
  });

  it('derives a correct per-turn delta across two turns with a growing cache ratio', async () => {
    // Real cumulative token_count pairs from a live session: turn 1 from a fresh baseline, turn 2 building
    // on turn 1's cumulative total with a much higher cache hit ratio.
    const now = Date.now();
    const dir = path.join(tmpDir, 'two-turns');
    const turn1Last: TokenUsage = { input_tokens: 21079, output_tokens: 403, cached_input_tokens: 4992, reasoning_output_tokens: 152, total_tokens: 21482 };
    const turn2Last: TokenUsage = { input_tokens: 41176, output_tokens: 845, cached_input_tokens: 20864, reasoning_output_tokens: 516, total_tokens: 42021 };
    const lines = [
      ...turnLines({ turnId: 't1', model: 'gpt-5.4-codex', completedAtEpochMs: now, baseline: ZERO_USAGE, last: turn1Last }),
      ...turnLines({ turnId: 't2', model: 'gpt-5.4-codex', completedAtEpochMs: now, baseline: turn1Last, last: turn2Last })
    ];
    await writeSession(dir, lines);

    const bucket = await readCodexCorrelatedTodayBucket(dir, new Date(now));

    const deltaCached = turn2Last.cached_input_tokens - turn1Last.cached_input_tokens;
    const deltaInput = turn2Last.input_tokens - turn1Last.input_tokens;
    const deltaOutput = turn2Last.output_tokens - turn1Last.output_tokens;
    const deltaTotal = turn2Last.total_tokens - turn1Last.total_tokens;

    assert.equal(bucket.correlatedTurns, 2);
    assert.equal(bucket.cacheReadInputTokens, turn1Last.cached_input_tokens + deltaCached);
    assert.equal(bucket.inputTokens, (turn1Last.input_tokens - turn1Last.cached_input_tokens) + (deltaInput - deltaCached));
    assert.equal(bucket.outputTokens, turn1Last.output_tokens + deltaOutput);
    assert.equal(bucket.totalTokens, turn1Last.total_tokens + deltaTotal);
    assert.equal(bucket.inputTokens + bucket.outputTokens + bucket.cacheCreationInputTokens + bucket.cacheReadInputTokens, bucket.totalTokens);
  });
});
