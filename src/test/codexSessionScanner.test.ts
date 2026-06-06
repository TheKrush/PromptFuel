import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCodexUsageState } from '../providers/codexSessionScanner';

let tmpDir = '';

function makeJsonlLine(rateLimits: unknown, windowMinutes?: number): string {
  return JSON.stringify({
    type: 'turn_complete',
    timestamp: new Date().toISOString(),
    payload: {
      model: 'codex-auto',
      rate_limits: rateLimits,
      info: {
        last_token_usage: { input_tokens: 10, output_tokens: 5 }
      }
    }
  });
}

describe('codex session scanner — percent field semantics', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-codex-scanner-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeSession(dir: string, lines: string[]): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
  }

  it('treats used_percent as a 0-100 value, not a fraction', async () => {
    // Real-world scenario: first message in a fresh 5h window → used_percent ≈ 1 (1% used, 99% left).
    // Must not be amplified to 100% used (0% left).
    const dir = path.join(tmpDir, 'first-message');
    const resetEpoch = Math.floor(Date.now() / 1000) + 5 * 3600;
    await writeSession(dir, [makeJsonlLine({
      primary: { used_percent: 1, window_minutes: 300, resets_at: resetEpoch },
      secondary: { used_percent: 5, window_minutes: 10080, resets_at: resetEpoch + 604800 }
    })]);

    const state = await readCodexUsageState(dir);
    assert.equal(state.fiveHour?.usedPercentage, 1, '1% used should not be amplified to 100%');
    assert.equal(state.sevenDay?.usedPercentage, 5, '5% used should not be amplified');
  });

  it('preserves mid-range used_percent values unchanged', async () => {
    const dir = path.join(tmpDir, 'mid-range');
    const resetEpoch = Math.floor(Date.now() / 1000) + 3 * 3600;
    await writeSession(dir, [makeJsonlLine({
      primary: { used_percent: 42, window_minutes: 300, resets_at: resetEpoch },
      secondary: { used_percent: 73, window_minutes: 10080, resets_at: resetEpoch + 604800 }
    })]);

    const state = await readCodexUsageState(dir);
    assert.equal(state.fiveHour?.usedPercentage, 42);
    assert.equal(state.sevenDay?.usedPercentage, 73);
  });

  it('handles zero usage in a fresh window without corruption', async () => {
    const dir = path.join(tmpDir, 'zero-usage');
    const resetEpoch = Math.floor(Date.now() / 1000) + 5 * 3600;
    await writeSession(dir, [makeJsonlLine({
      primary: { used_percent: 0, window_minutes: 300, resets_at: resetEpoch }
    })]);

    const state = await readCodexUsageState(dir);
    assert.equal(state.fiveHour?.usedPercentage, 0);
  });

  it('clamps out-of-range values rather than amplifying them', async () => {
    const dir = path.join(tmpDir, 'out-of-range');
    const resetEpoch = Math.floor(Date.now() / 1000) + 3600;
    await writeSession(dir, [makeJsonlLine({
      primary: { used_percent: 150, window_minutes: 300, resets_at: resetEpoch },
      secondary: { used_percent: -10, window_minutes: 10080, resets_at: resetEpoch + 604800 }
    })]);

    const state = await readCodexUsageState(dir);
    assert.equal(state.fiveHour?.usedPercentage, 100, 'values over 100 should clamp to 100');
    assert.equal(state.sevenDay?.usedPercentage, 0, 'negative values should clamp to 0');
  });
});
