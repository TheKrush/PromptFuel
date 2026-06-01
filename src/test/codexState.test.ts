import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCodexBridgeState } from '../providers/codexState';

let tmpDir = '';

describe('codex bridge state reader', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-codex-state-reader-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined when no bridge state exists', async () => {
    const state = await readCodexBridgeState(path.join(tmpDir, 'missing'));
    assert.equal(state, undefined);
  });

  it('surfaces completed-turn bridge diagnostics without raw payload data', async () => {
    const dir = path.join(tmpDir, 'completed-turns');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'codex-completed-turns.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        provider: 'codex',
        source: 'codex-hook-bridge',
        sourceConfidence: 'unavailable',
        lastUpdatedEpochMs: Date.now(),
        bridgeStatus: {
          configured: false,
          lastHookEpochMs: Date.now(),
          lastError: null,
          message: 'Codex completed-turn bridge skeleton installed, but no trusted completed-turn hook payload is configured yet.',
          observedPayload: {
            hasInput: true,
            jsonParsed: true,
            safeTopLevelKeys: ['model', 'timestamp', 'usage', 'completed'],
            hasModelField: true,
            hasTimestampField: true,
            hasUsageObject: true,
            hasInputTokenField: true,
            hasOutputTokenField: true,
            hasCacheTokenField: true,
            hasReasoningTokenField: true,
            hasCompletionSignal: true
          }
        },
        today: null
      }, null, 2)}${os.EOL}`,
      'utf8'
    );

    const state = await readCodexBridgeState(dir);

    assert.equal(state?.provider, 'codex');
    assert.equal(state?.source, 'Codex completed-turn bridge status');
    assert.equal(state?.stale, false);
    assert.equal(state?.diagnosticSeverity, 'info');
    assert.equal(state?.diagnostics?.usageFieldsFound, true);
    assert.equal(state?.diagnostics?.quotaFieldsFound, false);
    assert.match(state?.error ?? '', /Source confidence: unavailable/);
    assert.match(state?.error ?? '', /Observed JSON hook payload shape signals/);
    assert.match(state?.error ?? '', /Safe top-level keys: model, timestamp, usage, completed/);

    const serialized = JSON.stringify(state);
    for (const forbidden of [
      'SECRET_SHOULD_NOT_PERSIST',
      'SESSION_SHOULD_NOT_PERSIST',
      'REQUEST_SHOULD_NOT_PERSIST',
      'PROMPT_SHOULD_NOT_PERSIST',
      'RESPONSE_SHOULD_NOT_PERSIST',
      'TRANSCRIPT_PATH_SHOULD_NOT_PERSIST',
      'ARGS_SHOULD_NOT_PERSIST',
      'WORKSPACE_PATH_SHOULD_NOT_PERSIST'
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it('ignores completed-turn files for other providers', async () => {
    const dir = path.join(tmpDir, 'invalid-provider');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'codex-completed-turns.json'), `${JSON.stringify({ provider: 'claude' })}${os.EOL}`, 'utf8');

    assert.equal(await readCodexBridgeState(dir), undefined);
  });

  it('falls back to legacy codex bridge state', async () => {
    const dir = path.join(tmpDir, 'legacy');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'codex.json'),
      `${JSON.stringify({
        provider: 'codex',
        source: 'legacy',
        lastUpdatedEpochMs: Date.now(),
        fiveHour: { usedPercentage: 12 }
      })}${os.EOL}`,
      'utf8'
    );

    const state = await readCodexBridgeState(dir);
    assert.equal(state?.provider, 'codex');
    assert.equal(state?.source, 'local Codex bridge state');
    assert.equal(state?.stale, false);
    assert.equal(state?.fiveHour?.usedPercentage, 12);
  });
});
