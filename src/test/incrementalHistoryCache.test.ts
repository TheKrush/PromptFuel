import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  makeClaudeHistoryCache,
  makeCodexHistoryCache,
  readClaudeHistoryIncremental,
  readCodexHistoryIncremental
} from '../providers/historyCache';

// ---------------------------------------------------------------------------
// JSONL record builders
// ---------------------------------------------------------------------------

function claudeRecord(model: string, isoTimestamp: string, input: number, output: number, cacheCreate = 0, cacheRead = 0): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: isoTimestamp,
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead
      }
    }
  });
}

function codexTurnContext(turnId: string, model: string, timestamp: string): string {
  return JSON.stringify({ type: 'turn_context', timestamp, payload: { turn_id: turnId, model } });
}

function codexTaskStarted(turnId: string, timestamp: string): string {
  return JSON.stringify({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: turnId } });
}

function codexTokenCount(turnId: string, totalTokens: Record<string, number>, timestamp: string): string {
  return JSON.stringify({
    type: 'event_msg', timestamp,
    payload: { type: 'token_count', turn_id: turnId, info: { total_token_usage: totalTokens } }
  });
}

function codexTaskComplete(turnId: string, completedAtMs: number, timestamp: string): string {
  return JSON.stringify({
    type: 'event_msg', timestamp,
    payload: { type: 'task_complete', turn_id: turnId, completed_at: completedAtMs }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayStart(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getTime();
}

const targetDate = new Date(2026, 4, 15); // 2026-05-15 (month is 0-based)
const RANGE_DAYS = 30;

// ---------------------------------------------------------------------------
// Claude incremental cache tests
// ---------------------------------------------------------------------------

describe('Claude incremental history cache', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-claude-cache-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('cold cache returns empty history when directory has no files', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });
    const cache = makeClaudeHistoryCache();
    const result = await readClaudeHistoryIncremental(emptyDir, RANGE_DAYS, cache, targetDate);
    assert.equal(result.available, false);
    assert.ok(result.error);
    assert.equal(result.recordsMatched, 0);
  });

  it('cold cache scans a single file and returns correct totals', async () => {
    const projDir = path.join(tmpDir, 'proj1', 'session1');
    await fs.mkdir(projDir, { recursive: true });

    const ts1 = new Date(2026, 4, 14, 10, 0, 0).toISOString(); // 2026-05-14
    const ts2 = new Date(2026, 4, 15, 9, 0, 0).toISOString();  // 2026-05-15

    await fs.writeFile(path.join(projDir, 'session.jsonl'), [
      claudeRecord('claude-sonnet-4-6', ts1, 100, 50, 0, 0),
      claudeRecord('claude-opus-4-8', ts2, 200, 80, 10, 5)
    ].join('\n'));

    const cache = makeClaudeHistoryCache();
    const result = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj1'), RANGE_DAYS, cache, targetDate);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 2);
    assert.equal(result.assistantMessages, 2);
    assert.equal(result.inputTokens, 300);
    assert.equal(result.outputTokens, 130);
    assert.equal(result.cacheCreationInputTokens, 10);
    assert.equal(result.cacheReadInputTokens, 5);

    // Two distinct days
    const day14 = result.days.find(d => d.dateKey === '2026-05-14');
    const day15 = result.days.find(d => d.dateKey === '2026-05-15');
    assert.ok(day14, 'day 2026-05-14 should exist');
    assert.ok(day15, 'day 2026-05-15 should exist');
    assert.equal(day14!.inputTokens, 100);
    assert.equal(day15!.inputTokens, 200);

    // Model breakdown
    const sonnet = result.modelUsage.find(m => m.model === 'claude-sonnet-4-6');
    const opus = result.modelUsage.find(m => m.model === 'claude-opus-4-8');
    assert.ok(sonnet);
    assert.ok(opus);
    assert.equal(sonnet!.inputTokens, 100);
    assert.equal(opus!.inputTokens, 200);

    // Cache was populated
    assert.equal(cache.entries.size, 1);
  });

  it('warm cache — no file changes — does not rescan', async () => {
    const projDir = path.join(tmpDir, 'proj2', 'session1');
    await fs.mkdir(projDir, { recursive: true });
    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    await fs.writeFile(path.join(projDir, 'session.jsonl'), claudeRecord('claude-sonnet-4-6', ts, 50, 20));

    const cache = makeClaudeHistoryCache();
    const first = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj2'), RANGE_DAYS, cache, targetDate);
    assert.equal(first.recordsMatched, 1);

    // Mutate the cache entry to track if it was re-read
    const [, entry] = [...cache.entries.entries()][0];
    const originalContrib = entry.contribution;

    const second = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj2'), RANGE_DAYS, cache, targetDate);
    assert.equal(second.recordsMatched, 1);

    // Contribution object must be the same reference (not re-created)
    const [, entryAfter] = [...cache.entries.entries()][0];
    assert.strictEqual(entryAfter.contribution, originalContrib);
  });

  it('changed file is rescanned and totals update', async () => {
    const projDir = path.join(tmpDir, 'proj3', 'session1');
    await fs.mkdir(projDir, { recursive: true });
    const filePath = path.join(projDir, 'session.jsonl');
    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    await fs.writeFile(filePath, claudeRecord('claude-sonnet-4-6', ts, 50, 20));

    const cache = makeClaudeHistoryCache();
    const first = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj3'), RANGE_DAYS, cache, targetDate);
    assert.equal(first.recordsMatched, 1);
    assert.equal(first.inputTokens, 50);

    // Append a new record (simulates a new conversation turn)
    const ts2 = new Date(2026, 4, 15, 11, 0, 0).toISOString();
    await fs.appendFile(filePath, '\n' + claudeRecord('claude-sonnet-4-6', ts2, 75, 30));

    // Touch the file to update mtime (fs.appendFile updates mtime, but stat sometimes needs a tick)
    const now = new Date();
    await fs.utimes(filePath, now, now);

    const second = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj3'), RANGE_DAYS, cache, targetDate);
    assert.equal(second.recordsMatched, 2);
    assert.equal(second.inputTokens, 125);
  });

  it('deleted file is removed from cache and totals', async () => {
    const projRoot = path.join(tmpDir, 'proj4');
    const projDir1 = path.join(projRoot, 'session1');
    const projDir2 = path.join(projRoot, 'session2');
    await fs.mkdir(projDir1, { recursive: true });
    await fs.mkdir(projDir2, { recursive: true });

    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    const file1 = path.join(projDir1, 'a.jsonl');
    const file2 = path.join(projDir2, 'b.jsonl');
    await fs.writeFile(file1, claudeRecord('claude-sonnet-4-6', ts, 100, 40));
    await fs.writeFile(file2, claudeRecord('claude-opus-4-8', ts, 200, 60));

    const cache = makeClaudeHistoryCache();
    const first = await readClaudeHistoryIncremental(projRoot, RANGE_DAYS, cache, targetDate);
    assert.equal(first.recordsMatched, 2);
    assert.equal(first.inputTokens, 300);
    assert.equal(cache.entries.size, 2);

    // Delete one file
    await fs.unlink(file2);

    const second = await readClaudeHistoryIncremental(projRoot, RANGE_DAYS, cache, targetDate);
    assert.equal(second.recordsMatched, 1);
    assert.equal(second.inputTokens, 100);
    assert.equal(cache.entries.size, 1);
  });

  it('day rollover clears cache entirely', async () => {
    const projDir = path.join(tmpDir, 'proj5', 'session1');
    await fs.mkdir(projDir, { recursive: true });
    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    await fs.writeFile(path.join(projDir, 'session.jsonl'), claudeRecord('claude-sonnet-4-6', ts, 50, 20));

    const cache = makeClaudeHistoryCache();
    await readClaudeHistoryIncremental(path.join(tmpDir, 'proj5'), RANGE_DAYS, cache, targetDate);
    assert.equal(cache.entries.size, 1);

    // Simulate next day
    const nextDay = new Date(2026, 4, 16);
    await readClaudeHistoryIncremental(path.join(tmpDir, 'proj5'), RANGE_DAYS, cache, nextDay);

    // Cache was cleared and repopulated with fresh scan
    assert.equal(cache.dateKey, '2026-05-16');
    assert.equal(cache.entries.size, 1);
  });

  it('records outside the range are not counted', async () => {
    const projDir = path.join(tmpDir, 'proj6', 'session1');
    await fs.mkdir(projDir, { recursive: true });

    // Record 365+ days before targetDate — outside range
    const oldTs = new Date(2025, 3, 1).toISOString(); // 2025-04-01, well outside 30-day window
    const inTs = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    await fs.writeFile(path.join(projDir, 'session.jsonl'), [
      claudeRecord('claude-sonnet-4-6', oldTs, 999, 999),
      claudeRecord('claude-sonnet-4-6', inTs, 100, 50)
    ].join('\n'));

    const cache = makeClaudeHistoryCache();
    const result = await readClaudeHistoryIncremental(path.join(tmpDir, 'proj6'), RANGE_DAYS, cache, targetDate);
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.inputTokens, 100);
  });
});

// ---------------------------------------------------------------------------
// Codex incremental cache tests
// ---------------------------------------------------------------------------

describe('Codex incremental history cache', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-codex-cache-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function buildCodexSession(model: string, completedAtMs: number, baseline: number, after: number): string {
    const ts = new Date(completedAtMs).toISOString();
    const turnId = `turn-${completedAtMs}`;
    return [
      codexTurnContext(turnId, model, ts),
      codexTokenCount(turnId, { input_tokens: baseline, output_tokens: 0, total_tokens: baseline }, ts),
      codexTaskStarted(turnId, ts),
      codexTokenCount(turnId, { input_tokens: after, output_tokens: 10, total_tokens: after + 10 }, ts),
      codexTaskComplete(turnId, completedAtMs, ts)
    ].join('\n');
  }

  function buildCachedCodexSession(model: string, completedAtMs: number, after: number, cachedAfter: number): string {
    const ts = new Date(completedAtMs).toISOString();
    const turnId = `turn-cached-${completedAtMs}`;
    return [
      codexTurnContext(turnId, model, ts),
      codexTokenCount(turnId, { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, total_tokens: 0 }, ts),
      codexTaskStarted(turnId, ts),
      codexTokenCount(turnId, { input_tokens: after, output_tokens: 10, cached_input_tokens: cachedAfter, total_tokens: after + 10 }, ts),
      codexTaskComplete(turnId, completedAtMs, ts)
    ].join('\n');
  }

  it('cold cache returns correct Codex totals', async () => {
    const sessDir = path.join(tmpDir, 'sess1');
    await fs.mkdir(sessDir, { recursive: true });

    const completedAtMs = dayStart(2026, 5, 15) + 10 * 3600 * 1000;
    await fs.writeFile(path.join(sessDir, 'session.jsonl'), buildCodexSession('gpt-5.4', completedAtMs, 100, 300));

    const cache = makeCodexHistoryCache();
    const result = await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.inputTokens, 200); // delta: 300 - 100
    assert.equal(result.totalTokens, 210); // delta total: (300+10) - (100+0) = 210

    const model = result.modelUsage.find(m => m.model === 'gpt-5.4');
    assert.ok(model);
    assert.equal(model!.inputTokens, 200);
  });

  it('warm cache reuses Codex entries without rescan', async () => {
    const sessDir = path.join(tmpDir, 'sess2');
    await fs.mkdir(sessDir, { recursive: true });

    const completedAtMs = dayStart(2026, 5, 15) + 10 * 3600 * 1000;
    await fs.writeFile(path.join(sessDir, 'session.jsonl'), buildCodexSession('gpt-5.4', completedAtMs, 50, 150));

    const cache = makeCodexHistoryCache();
    await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);
    const [, entry] = [...cache.entries.entries()][0];
    const originalContrib = entry.contribution;

    await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);
    const [, entryAfter] = [...cache.entries.entries()][0];
    assert.strictEqual(entryAfter.contribution, originalContrib);
  });

  it('Codex deleted file removed from cache', async () => {
    const sessDir = path.join(tmpDir, 'sess3');
    await fs.mkdir(sessDir, { recursive: true });

    const t1 = dayStart(2026, 5, 14) + 10 * 3600 * 1000;
    const t2 = dayStart(2026, 5, 15) + 10 * 3600 * 1000;
    const file1 = path.join(sessDir, 'a.jsonl');
    const file2 = path.join(sessDir, 'b.jsonl');
    await fs.writeFile(file1, buildCodexSession('gpt-5.4', t1, 0, 100));
    await fs.writeFile(file2, buildCodexSession('gpt-5.4', t2, 0, 200));

    const cache = makeCodexHistoryCache();
    const first = await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);
    assert.equal(first.recordsMatched, 2);
    assert.equal(cache.entries.size, 2);

    await fs.unlink(file1);
    const second = await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);
    assert.equal(second.recordsMatched, 1);
    assert.equal(cache.entries.size, 1);
  });

  it('maps cached_input_tokens to cache-read on the incremental production path, not double-counted', async () => {
    const sessDir = path.join(tmpDir, 'sess4');
    await fs.mkdir(sessDir, { recursive: true });

    const completedAtMs = dayStart(2026, 5, 15) + 10 * 3600 * 1000;
    // Real-shaped values: total_tokens === input_tokens + output_tokens, cached_input_tokens is a subset of input_tokens.
    await fs.writeFile(path.join(sessDir, 'session.jsonl'), buildCachedCodexSession('gpt-5.4', completedAtMs, 19573, 4480));

    const cache = makeCodexHistoryCache();
    const result = await readCodexHistoryIncremental(sessDir, RANGE_DAYS, cache, targetDate);

    assert.equal(result.available, true);
    assert.equal(result.cacheReadInputTokens, 4480, 'cached_input_tokens must map to cache-read on the incremental path');
    assert.equal(result.cacheCreationInputTokens, 0, 'Codex reports no distinct cache-write signal');
    assert.equal(result.inputTokens, 19573 - 4480, 'inputTokens must be the derived uncached remainder, not the raw inclusive value');
    // Disjoint components must reconstruct the provider-reported total exactly (no double-count).
    assert.equal(result.inputTokens + result.outputTokens + result.cacheCreationInputTokens + result.cacheReadInputTokens, result.totalTokens);

    const day = result.days.find(d => d.dateKey === '2026-05-15');
    assert.ok(day);
    assert.equal(day!.cacheReadInputTokens, 4480);
    assert.equal(day!.inputTokens, 19573 - 4480);

    const model = result.modelUsage.find(m => m.model === 'gpt-5.4');
    assert.ok(model);
    assert.equal(model!.cacheReadInputTokens, 4480);
    assert.equal(model!.inputTokens, 19573 - 4480);
  });
});
