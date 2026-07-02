import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  CLAUDE_OPUS_USAGE_METER_ID,
  normalizePercent,
  parseClaudeQuotaPayload,
  parseClaudeWindow,
  parseCodexQuotaPayload,
  parseCodexWindow,
  parsedWindow,
  parseResetEpochSeconds,
  readAuthenticatedQuotaCache
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
    assert.deepEqual(parseCodexWindow({ limit_window_seconds: FIVE_HOUR_S, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 0.5, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseCodexWindow({ window_minutes: 300, usedPercentage: 42, resets_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 42, resetsAtEpochSeconds: S_EPOCH });
    assert.deepEqual(parseCodexWindow({ limit_window_seconds: SEVEN_DAY_S, utilization: 0.75, resetsAtEpochSeconds: S_EPOCH }, SEVEN_DAY_S), { usedPercentage: 75, resetsAtEpochSeconds: S_EPOCH });
    assert.equal(parseCodexWindow({ limit_window_seconds: SEVEN_DAY_S, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), undefined);
    assert.equal(parseCodexWindow({ window_minutes: 100, used_percent: 0.5, reset_at: S_EPOCH }, FIVE_HOUR_S), undefined);
    assert.deepEqual(parseCodexWindow({ used_percent: 0.25, reset_at: S_EPOCH }, FIVE_HOUR_S), { usedPercentage: 0.25, resetsAtEpochSeconds: S_EPOCH });
  });

  it('does not amplify Codex used_percent values that are already 0-100', () => {
    // Real-world calibration: a single message in a fresh 5h window produces used_percent ≈ 1.
    // It must remain 1% used (99% left), not be inflated to 100% used (0% left).
    assert.deepEqual(
      parseCodexWindow({ used_percent: 1, reset_at: S_EPOCH }, FIVE_HOUR_S),
      { usedPercentage: 1, resetsAtEpochSeconds: S_EPOCH }
    );
    assert.deepEqual(
      parseCodexWindow({ used_percent: 99, reset_at: S_EPOCH }, FIVE_HOUR_S),
      { usedPercentage: 99, resetsAtEpochSeconds: S_EPOCH }
    );
    assert.deepEqual(
      parseCodexWindow({ used_percent: 0, reset_at: S_EPOCH }, FIVE_HOUR_S),
      { usedPercentage: 0, resetsAtEpochSeconds: S_EPOCH }
    );
    // utilization is a genuine 0-1 fraction and should still be scaled
    assert.deepEqual(
      parseCodexWindow({ utilization: 1, reset_at: S_EPOCH }, FIVE_HOUR_S),
      { usedPercentage: 100, resetsAtEpochSeconds: S_EPOCH }
    );
  });

  it('parses Claude generic meters and migrates the Opus meter into the generic path', () => {
    const parsed = parseClaudeQuotaPayload({
      five_hour: { used_percentage: 25, reset_at: S_EPOCH },
      seven_day: { used_percentage: 40, reset_at: S_EPOCH },
      seven_day_opus: { used_percentage: 75, reset_at: S_EPOCH },
      preview_window: {
        id: 'fake-scoped-meter',
        label: 'preview 1d',
        scope: 'modelFamily',
        window_seconds: 86_400,
        used_percentage: 12,
        reset_at: S_EPOCH,
        temporary: true
      }
    });

    assert.equal(parsed?.fiveHour?.usedPercentage, 25);
    assert.equal(parsed?.sevenDay?.usedPercentage, 40);
    assert.deepEqual(parsed?.meters, [
      {
        id: CLAUDE_OPUS_USAGE_METER_ID,
        label: 'opus 7d',
        scope: 'modelFamily',
        windowSeconds: SEVEN_DAY_S,
        window: { usedPercentage: 75, resetsAtEpochSeconds: S_EPOCH }
      },
      {
        id: 'fake-scoped-meter',
        label: 'preview 1d',
        scope: 'modelFamily',
        windowSeconds: 86_400,
        window: { usedPercentage: 12, resetsAtEpochSeconds: S_EPOCH },
        temporary: true
      }
    ]);
  });

  it('parses non-5h/7d Codex windows as generic meters instead of dropping them', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: FIVE_HOUR_S, used_percent: 10, reset_at: S_EPOCH },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH },
        preview_window: {
          id: 'fake-scoped-meter',
          label: 'preview 1d',
          scope: 'model',
          limit_window_seconds: 86_400,
          used_percent: 15,
          reset_at: S_EPOCH,
          rollup: true
        }
      }
    });

    assert.equal(parsed?.fiveHour?.usedPercentage, 10);
    assert.equal(parsed?.sevenDay?.usedPercentage, 20);
    assert.deepEqual(parsed?.meters, [{
      id: 'fake-scoped-meter',
      label: 'preview 1d',
      scope: 'model',
      windowSeconds: 86_400,
      window: { usedPercentage: 15, resetsAtEpochSeconds: S_EPOCH },
      rollup: true
    }]);
  });

  it('does not turn a reset-only window into a generic meter', () => {
    const parsed = parseClaudeQuotaPayload({
      five_hour: { used_percentage: 25, reset_at: S_EPOCH },
      seven_day: { used_percentage: 40, reset_at: S_EPOCH },
      preview_window: {
        id: 'fake-scoped-meter',
        label: 'preview 1d',
        scope: 'modelFamily',
        window_seconds: 86_400,
        reset_at: S_EPOCH
      }
    });

    assert.equal(parsed?.meters, undefined);
  });

  it('turns a percent-only window (no reset) into a generic meter since percent is the required field', () => {
    const parsed = parseClaudeQuotaPayload({
      five_hour: { used_percentage: 25, reset_at: S_EPOCH },
      seven_day: { used_percentage: 40, reset_at: S_EPOCH },
      preview_window: {
        id: 'fake-scoped-meter',
        label: 'preview 1d',
        scope: 'modelFamily',
        window_seconds: 86_400,
        utilization: 0.3
      }
    });

    assert.deepEqual(parsed?.meters, [{
      id: 'fake-scoped-meter',
      label: 'preview 1d',
      scope: 'modelFamily',
      windowSeconds: 86_400,
      window: { usedPercentage: 30, resetsAtEpochSeconds: undefined }
    }]);
  });

  it('produces no meter for an empty or non-window generic entry', () => {
    const parsedEmptyObject = parseClaudeQuotaPayload({
      five_hour: { used_percentage: 25, reset_at: S_EPOCH },
      seven_day: { used_percentage: 40, reset_at: S_EPOCH },
      preview_window: {}
    });
    assert.equal(parsedEmptyObject?.meters, undefined);

    const parsedNonObject = parseClaudeQuotaPayload({
      five_hour: { used_percentage: 25, reset_at: S_EPOCH },
      seven_day: { used_percentage: 40, reset_at: S_EPOCH },
      preview_window: 'not-a-window'
    });
    assert.equal(parsedNonObject?.meters, undefined);
  });

  it('migrates a legacy cached sevenDayOpus window into a generic meter on cache read', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const futureEpochSeconds = Math.floor(Date.now() / 1000) + 3600;
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'claude',
            lastUpdatedEpochMs: Date.now(),
            sevenDayOpus: { usedPercentage: 80, resetsAtEpochSeconds: futureEpochSeconds }
          }]
        }, undefined, 2),
        'utf8'
      );

      const result = await readAuthenticatedQuotaCache(tmpDir);

      assert.deepEqual(result.claude?.meters, [{
        id: CLAUDE_OPUS_USAGE_METER_ID,
        label: 'opus 7d',
        scope: 'modelFamily',
        windowSeconds: 604_800,
        window: { usedPercentage: 80, resetsAtEpochSeconds: futureEpochSeconds }
      }]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not migrate a legacy cached sevenDayOpus window without usedPercentage', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const futureEpochSeconds = Math.floor(Date.now() / 1000) + 3600;
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'claude',
            lastUpdatedEpochMs: Date.now(),
            sevenDayOpus: { resetsAtEpochSeconds: futureEpochSeconds }
          }]
        }, undefined, 2),
        'utf8'
      );

      const result = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(result.claude?.meters, undefined);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
