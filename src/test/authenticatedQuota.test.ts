import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePercent,
  parseClaudeWindow,
  parseCodexWindow,
  parsedWindow,
  parseResetEpochSeconds
} from '../providers/authenticatedQuota';

const S_EPOCH = 1_747_900_000;
const MS_EPOCH = 1_747_900_000_000;
const ISO_STR = '2025-05-22T12:00:00.000Z';
const ISO_S = Math.floor(Date.parse(ISO_STR) / 1000);
const FIVE_HOUR_S = 18_000;
const SEVEN_DAY_S = 604_800;

describe('authenticated quota parsing', () => {
  it('normalizes fractional and raw percentages', () => {
    assert.equal(normalizePercent(undefined), undefined);
    assert.equal(normalizePercent(0), 0);
    assert.equal(normalizePercent(0.5), 50);
    assert.equal(normalizePercent(1), 100);
    assert.equal(normalizePercent(42), 42);
    assert.equal(normalizePercent(-5), 0);
    assert.equal(normalizePercent(150), 100);
  });

  it('parses reset epochs from milliseconds, seconds, and ISO strings', () => {
    assert.equal(parseResetEpochSeconds(MS_EPOCH), S_EPOCH);
    assert.equal(parseResetEpochSeconds(S_EPOCH), S_EPOCH);
    assert.equal(parseResetEpochSeconds(ISO_STR), ISO_S);
    assert.equal(parseResetEpochSeconds('not-a-date'), undefined);
    assert.equal(parseResetEpochSeconds(undefined), undefined);
    assert.equal(parseResetEpochSeconds(null), undefined);
    assert.equal(parseResetEpochSeconds(100), undefined);
  });

  it('returns a parsed window when at least one value is present', () => {
    assert.equal(parsedWindow(undefined, undefined), undefined);
    assert.deepEqual(parsedWindow(42, undefined), { usedPercentage: 42, resetsAtEpochSeconds: undefined });
    assert.deepEqual(parsedWindow(undefined, S_EPOCH), { usedPercentage: undefined, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parsedWindow(42, S_EPOCH), { usedPercentage: 42, resetsAtEpochSeconds: S_EPOCH });
  });

  it('parses Claude windows across known field aliases', () => {
    assert.equal(parseClaudeWindow(undefined), undefined);
    assert.equal(parseClaudeWindow({}), undefined);
    assert.deepEqual(parseClaudeWindow({ utilization: 0.5, resets_at: S_EPOCH }), { usedPercentage: 50, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseClaudeWindow({ used_percentage: 42, reset_at: MS_EPOCH }), { usedPercentage: 42, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseClaudeWindow({ usedPercent: 1, resetsAt: ISO_STR }), { usedPercentage: 100, resetsAtEpochSeconds: ISO_S });
    assert.deepEqual(parseClaudeWindow({ utilization: 0.25 }), { usedPercentage: 25, resetsAtEpochSeconds: undefined });
    assert.deepEqual(parseClaudeWindow({ resets_at: S_EPOCH }), { usedPercentage: undefined, resetsAtEpochSeconds: S_EPOCH });
    assert.equal(parseClaudeWindow({ utilization: 'bad', resets_at: 'bad' }), undefined);
  });

  it('parses Codex windows and rejects mismatched window sizes', () => {
    assert.equal(parseCodexWindow(undefined, FIVE_HOUR_S), undefined);
    assert.equal(parseCodexWindow({}, FIVE_HOUR_S), undefined);
    assert.deepEqual(parseCodexWindow({ limit_window_seconds: FIVE_HOUR_S, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 50, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseCodexWindow({ window_minutes: 300, usedPercentage: 42, resets_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 42, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseCodexWindow({ limit_window_seconds: SEVEN_DAY_S, utilization: 0.75, resetsAtEpochSeconds: S_EPOCH }, SEVEN_DAY_S), { usedPercentage: 75, resetsAtEpochSeconds: S_EPOCH });
    assert.equal(parseCodexWindow({ limit_window_seconds: SEVEN_DAY_S, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), undefined);
    assert.equal(parseCodexWindow({ window_minutes: 100, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), undefined);
    assert.deepEqual(parseCodexWindow({ used_percent: 0.25, reset_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 25, resetsAtEpochSeconds: S_EPOCH });
  });
});
