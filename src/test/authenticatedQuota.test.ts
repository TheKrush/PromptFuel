import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  CLAUDE_OPUS_USAGE_METER_ID,
  authenticatedWindowStatesFromObservations,
  buildAuthenticatedQuotaSuccessOutcome,
  normalizePercent,
  parseClaudeQuotaPayload,
  parseClaudeWindow,
  parseCodexQuotaPayload,
  parseCodexWindow,
  parsedWindow,
  parseResetEpochSeconds,
  readAuthenticatedQuotaCache,
  writeAuthenticatedQuotaCache
} from '../providers/authenticatedQuota';
import { mergeAuthenticatedFailure, mergeAuthenticatedQuotaSuccess, mergeLocalAndAuthenticated } from '../quota/merge';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { formatStatus } from '../display/format';
import { ProviderUsageState } from '../types';

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

  it('classifies a seven-day primary alias by explicit duration when the secondary alias is null', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary: { window_minutes: 10_080, used_percent: 53, reset_at: S_EPOCH },
        secondary: null
      }
    });

    assert.equal(parsed?.fiveHour, undefined);
    assert.equal(parsed?.sevenDay?.usedPercentage, 53);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });
  });

  it('classifies a seven-day primary_window alias by explicit duration', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 47, reset_at: S_EPOCH }
      }
    });

    assert.equal(parsed?.fiveHour, undefined);
    assert.equal(parsed?.sevenDay?.usedPercentage, 47);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });
  });

  it('classifies a five-hour secondary alias by explicit duration', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        secondary: { limit_window_seconds: FIVE_HOUR_S, used_percent: 12, reset_at: S_EPOCH }
      }
    });

    assert.equal(parsed?.fiveHour?.usedPercentage, 12);
    assert.equal(parsed?.sevenDay, undefined);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'valid', sevenDay: 'absent' });
  });

  it('classifies primary and secondary aliases in reversed logical order', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { window_minutes: 10_080, used_percent: 34, reset_at: S_EPOCH },
        secondary_window: { window_minutes: 300, used_percent: 9, reset_at: S_EPOCH }
      }
    });

    assert.equal(parsed?.fiveHour?.usedPercentage, 9);
    assert.equal(parsed?.sevenDay?.usedPercentage, 34);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'valid', sevenDay: 'valid' });
  });

  it('preserves traditional alias-position fallback when duration metadata is absent', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary: { used_percent: 7, reset_at: S_EPOCH },
        secondary: { used_percent: 28, reset_at: S_EPOCH }
      }
    });

    assert.equal(parsed?.fiveHour?.usedPercentage, 7);
    assert.equal(parsed?.sevenDay?.usedPercentage, 28);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'valid', sevenDay: 'valid' });
  });

  it('does not assign an unknown explicit duration by alias position', () => {
    const unknownOnly = parseCodexQuotaPayload({
      rate_limit: {
        primary: { window_minutes: 60, used_percent: 22, reset_at: S_EPOCH }
      }
    });
    assert.equal(unknownOnly, undefined);

    const withRecognizedSibling = parseCodexQuotaPayload({
      rate_limit: {
        primary: { window_minutes: 60, used_percent: 22, reset_at: S_EPOCH },
        secondary: { window_minutes: 10_080, used_percent: 41, reset_at: S_EPOCH }
      }
    });
    assert.equal(withRecognizedSibling?.fiveHour, undefined);
    assert.equal(withRecognizedSibling?.sevenDay?.usedPercentage, 41);
    assert.deepEqual(withRecognizedSibling?.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });
  });

  it('resolves duplicate candidates deterministically without populating both windows', () => {
    const parsed = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 31, reset_at: S_EPOCH },
        primary: { limit_window_seconds: SEVEN_DAY_S, used_percent: 32, reset_at: S_EPOCH },
        secondary: null
      }
    });

    assert.equal(parsed?.fiveHour, undefined);
    assert.equal(parsed?.sevenDay?.usedPercentage, 31);
    assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });
  });

  it('returns undefined for a wholly unrecognized Codex payload', () => {
    assert.equal(parseCodexQuotaPayload({ rate_limit: { unexpected: 'value' } }), undefined);
    assert.equal(parseCodexQuotaPayload({ unrelated: true }), undefined);
  });

  it('records independent valid, absent, null, malformed, and disabled Codex primary observations', () => {
    const both = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: FIVE_HOUR_S, used_percent: 0, reset_at: S_EPOCH },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 100, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(both?.primaryWindowObservations, { fiveHour: 'valid', sevenDay: 'valid' });
    assert.equal(both?.fiveHour?.usedPercentage, 0);
    assert.equal(both?.sevenDay?.usedPercentage, 100);

    const fiveHourAbsent = parseCodexQuotaPayload({
      rate_limit: {
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.equal(fiveHourAbsent?.fiveHour, undefined);
    assert.equal(fiveHourAbsent?.sevenDay?.usedPercentage, 20);
    assert.deepEqual(fiveHourAbsent?.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });

    const fiveHourNull = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: null,
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(fiveHourNull?.primaryWindowObservations, { fiveHour: 'null', sevenDay: 'valid' });

    const fiveHourMalformed = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: FIVE_HOUR_S, used_percent: 'bad' },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(fiveHourMalformed?.primaryWindowObservations, { fiveHour: 'malformed', sevenDay: 'valid' });

    const fiveHourResetOnly = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: FIVE_HOUR_S, reset_at: S_EPOCH },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.equal(fiveHourResetOnly?.fiveHour, undefined);
    assert.deepEqual(fiveHourResetOnly?.primaryWindowObservations, { fiveHour: 'malformed', sevenDay: 'valid' });

    const sevenDayAbsent = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { limit_window_seconds: FIVE_HOUR_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(sevenDayAbsent?.primaryWindowObservations, { fiveHour: 'valid', sevenDay: 'absent' });

    const fiveHourDisabled = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { enabled: false },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(fiveHourDisabled?.primaryWindowObservations, { fiveHour: 'disabled', sevenDay: 'valid' });

    const fiveHourUnsupported = parseCodexQuotaPayload({
      rate_limit: {
        primary_window: { supported: false },
        secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 20, reset_at: S_EPOCH }
      }
    });
    assert.deepEqual(fiveHourUnsupported?.primaryWindowObservations, { fiveHour: 'unsupported', sevenDay: 'valid' });
  });

  it('gives only valid Codex observations a newly live state', () => {
    const timestamp = Date.now();
    const valid = authenticatedWindowStatesFromObservations({ fiveHour: 'valid', sevenDay: 'valid' }, timestamp);
    assert.deepEqual(valid.fiveHour, { observation: 'valid', availability: 'live', lastLiveEpochMs: timestamp });
    assert.deepEqual(valid.sevenDay, { observation: 'valid', availability: 'live', lastLiveEpochMs: timestamp });

    for (const observation of ['absent', 'null', 'unsupported', 'disabled', 'malformed'] as const) {
      const states = authenticatedWindowStatesFromObservations({ fiveHour: observation, sevenDay: 'valid' }, timestamp);
      assert.deepEqual(states.fiveHour, { observation, availability: 'unavailable' });
      assert.equal(states.fiveHour?.lastLiveEpochMs, undefined);
      assert.equal(states.sevenDay?.availability, 'live');
    }
  });

  it('gives explicit disabled and unsupported Codex markers precedence over retained numeric fields', () => {
    for (const [field, value, observation] of [
      ['disabled', true, 'disabled'],
      ['enabled', false, 'disabled'],
      ['unsupported', true, 'unsupported'],
      ['supported', false, 'unsupported']
    ] as const) {
      const parsed = parseCodexQuotaPayload({
        rate_limit: {
          primary_window: {
            limit_window_seconds: FIVE_HOUR_S,
            used_percent: 0,
            reset_at: S_EPOCH,
            [field]: value
          },
          secondary_window: { limit_window_seconds: SEVEN_DAY_S, used_percent: 100, reset_at: S_EPOCH }
        }
      });

      assert.equal(parsed?.fiveHour, undefined);
      assert.deepEqual(parsed?.primaryWindowObservations, { fiveHour: observation, sevenDay: 'valid' });
      assert.equal(parsed?.sevenDay?.usedPercentage, 100);
    }
  });

  it('updates a live-like seven-day primary independently through acquisition, merge, cache, dashboard, and status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const now = Date.now();
      const oldLiveEpochMs = now - 25 * 60_000;
      const resetAtEpochSeconds = Math.floor(now / 1000) + SEVEN_DAY_S;
      const parsed = parseCodexQuotaPayload({
        rate_limit: {
          primary: { used_percent: 53, window_minutes: 10_080, reset_at: resetAtEpochSeconds },
          secondary: null
        }
      });

      assert.ok(parsed);
      assert.equal(parsed.sevenDay?.usedPercentage, 53);
      assert.equal(parsed.fiveHour, undefined);
      assert.deepEqual(parsed.primaryWindowObservations, { fiveHour: 'absent', sevenDay: 'valid' });

      const outcome = buildAuthenticatedQuotaSuccessOutcome('codex', parsed, 200, now);
      assert.equal(outcome.success, true);
      assert.equal(outcome.state.authenticatedStatus, 'success');
      assert.equal(outcome.state.sevenDay?.usedPercentage, 53);
      assert.deepEqual(outcome.state.authenticatedWindows?.sevenDay, {
        observation: 'valid', availability: 'live', lastLiveEpochMs: now
      });
      assert.deepEqual(outcome.state.authenticatedWindows?.fiveHour, {
        observation: 'absent', availability: 'unavailable'
      });

      const staleState: ProviderUsageState = {
        provider: 'codex',
        fiveHour: {
          usedPercentage: 0,
          resetsAtEpochSeconds: Math.floor(now / 1000) + FIVE_HOUR_S,
          sourceKind: 'stale',
          sourceUpdatedEpochMs: oldLiveEpochMs
        },
        sevenDay: {
          usedPercentage: 77,
          resetsAtEpochSeconds: resetAtEpochSeconds,
          sourceKind: 'stale',
          sourceUpdatedEpochMs: oldLiveEpochMs
        },
        sourceKind: 'stale',
        source: 'stale cached authenticated quota',
        lastUpdatedEpochMs: oldLiveEpochMs,
        lastAuthenticatedRefreshEpochMs: oldLiveEpochMs,
        authenticatedStatus: 'success',
        authenticatedWindows: {
          fiveHour: { observation: 'valid', availability: 'stale', lastLiveEpochMs: oldLiveEpochMs },
          sevenDay: { observation: 'valid', availability: 'stale', lastLiveEpochMs: oldLiveEpochMs }
        },
        stale: true
      };
      const merged = mergeAuthenticatedQuotaSuccess(staleState, outcome.state);

      assert.equal(merged.sevenDay?.usedPercentage, 53);
      assert.equal(merged.sevenDay?.sourceKind, 'authenticated');
      assert.equal(merged.authenticatedWindows?.sevenDay?.availability, 'live');
      assert.equal(merged.fiveHour?.usedPercentage, 0);
      assert.equal(merged.fiveHour?.sourceKind, 'stale');
      assert.deepEqual(merged.authenticatedWindows?.fiveHour, {
        observation: 'absent', availability: 'stale', lastLiveEpochMs: oldLiveEpochMs
      });
      assert.equal(merged.stale, false);

      await writeAuthenticatedQuotaCache(tmpDir, { codex: merged });
      const cached = (await readAuthenticatedQuotaCache(tmpDir)).codex;
      assert.ok(cached);
      assert.equal(cached.sevenDay?.usedPercentage, 53);
      assert.equal(cached.sevenDay?.sourceKind, 'cache');
      assert.deepEqual(cached.authenticatedWindows?.sevenDay, {
        observation: 'valid', availability: 'cached', lastLiveEpochMs: now
      });
      assert.equal(cached.fiveHour?.usedPercentage, 0);
      assert.equal(cached.fiveHour?.sourceKind, 'stale');
      assert.deepEqual(cached.authenticatedWindows?.fiveHour, {
        observation: 'absent', availability: 'stale', lastLiveEpochMs: oldLiveEpochMs
      });
      assert.equal(cached.stale, false);

      const overview = buildUsageDashboardModel({ states: [merged] });
      const scoped = buildUsageDashboardModel({ states: [merged], scopedToProvider: 'codex' });
      for (const dashboard of [overview, scoped]) {
        const provider = dashboard.providers[0];
        const sevenDay = provider?.windows.find(window => window.key === 'sevenDay');
        const fiveHour = provider?.windows.find(window => window.key === 'fiveHour');
        assert.equal(provider?.provider, 'codex');
        assert.equal(provider?.stale, false);
        assert.equal(sevenDay?.remainingPercent, 47);
        assert.equal(sevenDay?.freshness, 'live');
        assert.equal(fiveHour?.remainingPercent, 100);
        assert.equal(fiveHour?.freshness, 'stale');
      }
      assert.equal(overview.selectedTab, 'overview');
      assert.equal(scoped.selectedTab, 'codex');

      const formatted = formatStatus([merged], { displayMode: 'compact', statusMode: 'remaining' });
      assert.match(formatted.text, /47%/);
      assert.match(formatted.text, /100%/);
      assert.doesNotMatch(formatted.text, /[!⚠▲△?]|\bstale\b/i);
      assert.match(formatted.tooltip, /\*\*47%\*\*/);
      assert.match(formatted.tooltip, /\*\*100%\*\*/);
      assert.equal((formatted.tooltip.match(/Some live quota data is incomplete\. Open the dashboard for details\./g) ?? []).length, 1);
      assert.doesNotMatch(formatted.tooltip, /stale cached value|live window not supplied|<span[^>]*(?:title|aria-label)=/i);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
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

  it('persists a merged partial Codex success without erasing its retained sibling', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const firstRefresh = Date.now() - 5_000;
      const initial = mergeAuthenticatedQuotaSuccess(undefined, {
        provider: 'codex',
        fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600 },
        sevenDay: { usedPercentage: 20, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
        sourceKind: 'authenticated',
        source: 'live authenticated refresh',
        lastUpdatedEpochMs: firstRefresh,
        lastAuthenticatedRefreshEpochMs: firstRefresh,
        authenticatedStatus: 'success',
        stale: false,
        authenticatedWindows: {
          fiveHour: { observation: 'valid', availability: 'live', lastLiveEpochMs: firstRefresh },
          sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: firstRefresh }
        }
      });
      const merged = mergeAuthenticatedQuotaSuccess(initial, {
        provider: 'codex',
        sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
        sourceKind: 'authenticated',
        source: 'live authenticated refresh',
        lastUpdatedEpochMs: Date.now(),
        lastAuthenticatedRefreshEpochMs: Date.now(),
        authenticatedStatus: 'success',
        stale: false,
        authenticatedWindows: {
          fiveHour: { observation: 'absent', availability: 'unavailable' },
          sevenDay: { observation: 'valid', availability: 'live' }
        }
      });

      await writeAuthenticatedQuotaCache(tmpDir, { codex: merged });
      const reloaded = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(reloaded.codex?.fiveHour?.usedPercentage, 30);
      assert.equal(reloaded.codex?.sevenDay?.usedPercentage, 0);
      assert.equal(reloaded.codex?.authenticatedWindows?.fiveHour?.observation, 'absent');
      assert.equal(reloaded.codex?.authenticatedWindows?.fiveHour?.availability, 'cached');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps retained local display quota out of authenticated cache persistence and reload', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const localUpdatedAt = Date.now() - 30_000;
      const authenticatedUpdatedAt = Date.now();
      const partialAuthenticatedState = {
        provider: 'codex' as const,
        sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
        sourceKind: 'authenticated' as const,
        source: 'live authenticated refresh',
        lastUpdatedEpochMs: authenticatedUpdatedAt,
        lastAuthenticatedRefreshEpochMs: authenticatedUpdatedAt,
        authenticatedStatus: 'success' as const,
        stale: false,
        authenticatedWindows: authenticatedWindowStatesFromObservations({ fiveHour: 'absent', sevenDay: 'valid' }, authenticatedUpdatedAt)
      };
      const display = mergeAuthenticatedQuotaSuccess({
        provider: 'codex',
        fiveHour: {
          usedPercentage: 40,
          resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
          sourceKind: 'localSession',
          sourceLabel: 'local session quota',
          sourceUpdatedEpochMs: localUpdatedAt
        },
        sourceKind: 'localSession',
        source: 'local Codex session snapshot',
        lastUpdatedEpochMs: localUpdatedAt,
        lastLocalUpdateEpochMs: localUpdatedAt
      }, partialAuthenticatedState);
      const authenticatedCache = mergeAuthenticatedQuotaSuccess(undefined, partialAuthenticatedState);

      assert.equal(display.fiveHour?.sourceKind, 'localSession');
      assert.deepEqual(display.authenticatedWindows?.fiveHour, {
        observation: 'absent',
        availability: 'unavailable'
      });
      assert.equal(authenticatedCache.fiveHour, undefined);
      assert.deepEqual(authenticatedCache.authenticatedWindows?.fiveHour, {
        observation: 'absent',
        availability: 'unavailable'
      });
      assert.equal(authenticatedCache.sevenDay?.sourceKind, 'authenticated');

      await writeAuthenticatedQuotaCache(tmpDir, { codex: authenticatedCache });
      const reloaded = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(reloaded.codex?.fiveHour, undefined);
      assert.deepEqual(reloaded.codex?.authenticatedWindows?.fiveHour, {
        observation: 'absent',
        availability: 'unavailable'
      });
      assert.equal(reloaded.codex?.authenticatedWindows?.fiveHour?.lastLiveEpochMs, undefined);
      assert.equal(reloaded.codex?.sevenDay?.usedPercentage, 0);
      assert.equal(reloaded.codex?.sevenDay?.sourceKind, 'cache');
      assert.equal(reloaded.codex?.authenticatedWindows?.sevenDay?.availability, 'cached');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads legacy cached primary windows without per-window timestamps as stale', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const updatedAt = Date.now() - 60_000;
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'codex',
            lastUpdatedEpochMs: updatedAt,
            lastAuthenticatedRefreshEpochMs: updatedAt,
            authenticatedStatus: 'success',
            fiveHour: { usedPercentage: 0, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600 }
          }]
        }, undefined, 2),
        'utf8'
      );

      const result = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(result.codex?.fiveHour?.usedPercentage, 0);
      assert.equal(result.codex?.fiveHour?.sourceKind, 'stale');
      assert.equal(result.codex?.fiveHour?.sourceUpdatedEpochMs, undefined);
      assert.equal(result.codex?.stale, false);
      assert.deepEqual(result.codex?.authenticatedWindows?.fiveHour, {
        observation: 'valid',
        availability: 'stale'
      });

      const dashboard = buildUsageDashboardModel({ states: [result.codex!] });
      const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');
      assert.equal(fiveHour?.remainingPercent, 100);
      assert.equal(fiveHour?.health, 'stale');
      assert.equal(fiveHour?.healthDetail, 'Quota value is stale.');
      assert.doesNotMatch(fiveHour?.healthDetail ?? '', /Last updated/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads current cached primary windows without per-window timestamps as stale', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const updatedAt = Date.now() - 60_000;
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'codex',
            lastUpdatedEpochMs: updatedAt,
            lastAuthenticatedRefreshEpochMs: updatedAt,
            authenticatedStatus: 'success',
            stale: false,
            fiveHour: { usedPercentage: 35, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600 },
            authenticatedWindows: {
              fiveHour: { observation: 'valid', availability: 'cached' }
            }
          }]
        }, undefined, 2),
        'utf8'
      );

      const result = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(result.codex?.fiveHour?.usedPercentage, 35);
      assert.equal(result.codex?.fiveHour?.sourceKind, 'stale');
      assert.equal(result.codex?.fiveHour?.sourceUpdatedEpochMs, undefined);
      assert.deepEqual(result.codex?.authenticatedWindows?.fiveHour, {
        observation: 'valid',
        availability: 'stale'
      });

      const dashboard = buildUsageDashboardModel({ states: [result.codex!] });
      const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');
      assert.equal(fiveHour?.remainingPercent, 65);
      assert.equal(fiveHour?.health, 'stale');
      assert.equal(fiveHour?.healthDetail, 'Quota value is stale.');
      assert.doesNotMatch(fiveHour?.healthDetail ?? '', /Last updated/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads a legacy cached primary window using its own trustworthy timestamp', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const providerUpdatedAt = Date.now();
      const windowUpdatedAt = providerUpdatedAt - 60_000;
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'codex',
            lastUpdatedEpochMs: providerUpdatedAt,
            lastAuthenticatedRefreshEpochMs: providerUpdatedAt,
            authenticatedStatus: 'success',
            fiveHour: {
              usedPercentage: 35,
              resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
              sourceUpdatedEpochMs: windowUpdatedAt
            }
          }]
        }, undefined, 2),
        'utf8'
      );

      const result = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(result.codex?.fiveHour?.sourceKind, 'cache');
      assert.equal(result.codex?.fiveHour?.sourceUpdatedEpochMs, windowUpdatedAt);
      assert.deepEqual(result.codex?.authenticatedWindows?.fiveHour, {
        observation: 'valid',
        availability: 'cached',
        lastLiveEpochMs: windowUpdatedAt
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reloads Codex cached windows using each window\'s own last-live timestamp', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const oldFiveHourLive = Date.now() - 25 * 60_000;
      const recentSevenDayLive = Date.now();
      const initial = mergeAuthenticatedQuotaSuccess(undefined, {
        provider: 'codex',
        fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600 },
        sevenDay: { usedPercentage: 20, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
        lastUpdatedEpochMs: oldFiveHourLive,
        lastAuthenticatedRefreshEpochMs: oldFiveHourLive,
        authenticatedStatus: 'success',
        stale: false,
        authenticatedWindows: authenticatedWindowStatesFromObservations({ fiveHour: 'valid', sevenDay: 'valid' }, oldFiveHourLive)
      });
      const partial = mergeAuthenticatedQuotaSuccess(initial, {
        provider: 'codex',
        sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
        lastUpdatedEpochMs: recentSevenDayLive,
        lastAuthenticatedRefreshEpochMs: recentSevenDayLive,
        authenticatedStatus: 'success',
        stale: false,
        authenticatedWindows: authenticatedWindowStatesFromObservations({ fiveHour: 'malformed', sevenDay: 'valid' }, recentSevenDayLive)
      });

      assert.deepEqual(partial.authenticatedWindows?.fiveHour, {
        observation: 'malformed', availability: 'stale', lastLiveEpochMs: oldFiveHourLive
      });
      assert.equal(partial.fiveHour?.sourceKind, 'stale');
      assert.equal(partial.fiveHour?.sourceLabel, 'stale cached quota snapshot');
      assert.equal(partial.fiveHour?.sourceUpdatedEpochMs, oldFiveHourLive);
      assert.equal(partial.authenticatedWindows?.sevenDay?.availability, 'live');
      assert.equal(partial.sevenDay?.sourceKind, 'authenticated');
      const beforeRestart = buildUsageDashboardModel({ states: [partial] });
      const beforeRestartFiveHour = beforeRestart.providers[0]?.windows.find(window => window.key === 'fiveHour');
      assert.equal(beforeRestartFiveHour?.freshness, 'stale');

      await writeAuthenticatedQuotaCache(tmpDir, { codex: partial });
      const reloaded = await readAuthenticatedQuotaCache(tmpDir);

      assert.deepEqual(reloaded.codex?.authenticatedWindows?.fiveHour, {
        observation: 'malformed', availability: 'stale', lastLiveEpochMs: oldFiveHourLive
      });
      assert.equal(reloaded.codex?.fiveHour?.sourceKind, 'stale');
      assert.equal(reloaded.codex?.fiveHour?.sourceLabel, 'stale cached quota snapshot');
      assert.equal(reloaded.codex?.fiveHour?.sourceUpdatedEpochMs, oldFiveHourLive);
      assert.deepEqual(reloaded.codex?.authenticatedWindows?.sevenDay, {
        observation: 'valid', availability: 'cached', lastLiveEpochMs: recentSevenDayLive
      });
      assert.equal(reloaded.codex?.sevenDay?.sourceKind, 'cache');
      const afterRestart = buildUsageDashboardModel({ states: [reloaded.codex!] });
      const afterRestartFiveHour = afterRestart.providers[0]?.windows.find(window => window.key === 'fiveHour');
      assert.equal(afterRestartFiveHour?.freshness, 'stale');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not let a recent provider failure refresh independently aged Codex windows', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      const oldFiveHourLive = Date.now() - 25 * 60_000;
      const recentSevenDayLive = Date.now() - 5 * 60_000;
      const failureAttempt = Date.now();
      const current = mergeAuthenticatedQuotaSuccess(undefined, {
        provider: 'codex',
        fiveHour: {
          usedPercentage: 30,
          resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
          sourceUpdatedEpochMs: oldFiveHourLive
        },
        sevenDay: {
          usedPercentage: 20,
          resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400,
          sourceUpdatedEpochMs: recentSevenDayLive
        },
        lastUpdatedEpochMs: recentSevenDayLive,
        lastAuthenticatedRefreshEpochMs: recentSevenDayLive,
        authenticatedStatus: 'success',
        stale: false,
        authenticatedWindows: {
          fiveHour: { observation: 'valid', availability: 'live', lastLiveEpochMs: oldFiveHourLive },
          sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: recentSevenDayLive }
        }
      });
      const failed = mergeAuthenticatedFailure(current, {
        provider: 'codex',
        lastAuthenticatedRefreshEpochMs: failureAttempt,
        authenticatedStatus: 'network_error',
        stale: true
      }, failureAttempt + 60_000);

      assert.deepEqual(failed.authenticatedWindows?.fiveHour, {
        observation: 'valid', availability: 'stale', lastLiveEpochMs: oldFiveHourLive
      });
      assert.deepEqual(failed.authenticatedWindows?.sevenDay, {
        observation: 'valid', availability: 'cached', lastLiveEpochMs: recentSevenDayLive
      });
      assert.equal(failed.fiveHour?.sourceKind, 'stale');
      assert.equal(failed.sevenDay?.sourceKind, 'cache');
      assert.equal(failed.fiveHour?.sourceLabel, 'stale cached quota snapshot');
      assert.equal(failed.sevenDay?.sourceLabel, 'cached quota snapshot');
      assert.equal(failed.fiveHour?.sourceUpdatedEpochMs, oldFiveHourLive);
      assert.equal(failed.sevenDay?.sourceUpdatedEpochMs, recentSevenDayLive);
      const beforeRestart = buildUsageDashboardModel({ states: [failed] });
      assert.equal(beforeRestart.providers[0]?.windows.find(window => window.key === 'fiveHour')?.freshness, 'stale');
      assert.equal(beforeRestart.providers[0]?.windows.find(window => window.key === 'sevenDay')?.freshness, 'cached');

      await writeAuthenticatedQuotaCache(tmpDir, { codex: failed });
      const reloaded = await readAuthenticatedQuotaCache(tmpDir);

      assert.equal(reloaded.codex?.authenticatedWindows?.fiveHour?.availability, 'stale');
      assert.equal(reloaded.codex?.authenticatedWindows?.sevenDay?.availability, 'cached');
      assert.equal(reloaded.codex?.authenticatedWindows?.fiveHour?.lastLiveEpochMs, oldFiveHourLive);
      assert.equal(reloaded.codex?.authenticatedWindows?.sevenDay?.lastLiveEpochMs, recentSevenDayLive);
      assert.equal(reloaded.codex?.fiveHour?.sourceKind, 'stale');
      assert.equal(reloaded.codex?.sevenDay?.sourceKind, 'cache');
      assert.equal(reloaded.codex?.fiveHour?.sourceLabel, 'stale cached quota snapshot');
      assert.equal(reloaded.codex?.sevenDay?.sourceLabel, 'cached quota snapshot');
      assert.equal(reloaded.codex?.fiveHour?.sourceUpdatedEpochMs, oldFiveHourLive);
      assert.equal(reloaded.codex?.sevenDay?.sourceUpdatedEpochMs, recentSevenDayLive);
      const afterRestart = buildUsageDashboardModel({ states: [reloaded.codex!] });
      assert.equal(afterRestart.providers[0]?.windows.find(window => window.key === 'fiveHour')?.freshness, 'stale');
      assert.equal(afterRestart.providers[0]?.windows.find(window => window.key === 'sevenDay')?.freshness, 'cached');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps legacy Claude caches out of Codex window migration and warning rendering', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'claude',
            fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600 },
            lastUpdatedEpochMs: Date.now(),
            authenticatedStatus: 'success',
            authenticatedWindows: {
              fiveHour: { observation: 'absent', availability: 'unavailable' }
            }
          }]
        }, undefined, 2),
        'utf8'
      );

      const cached = (await readAuthenticatedQuotaCache(tmpDir)).claude;
      assert.equal(cached?.authenticatedWindows, undefined);
      const merged = mergeLocalAndAuthenticated({ provider: 'claude', source: 'local session' }, cached);
      const dashboard = buildUsageDashboardModel({ states: [merged] });
      const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');
      assert.doesNotMatch(JSON.stringify(dashboard), /live window/i);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not fabricate a legacy Codex missing-window observation or sibling freshness', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-quota-cache-test-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'authenticated-quota-cache.json'),
        JSON.stringify({
          providers: [{
            provider: 'codex',
            sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400 },
            lastUpdatedEpochMs: Date.now(),
            authenticatedStatus: 'success'
          }]
        }, undefined, 2),
        'utf8'
      );

      const cached = (await readAuthenticatedQuotaCache(tmpDir)).codex;
      assert.equal(cached?.authenticatedWindows?.fiveHour, undefined);
      assert.deepEqual(cached?.authenticatedWindows?.sevenDay, {
        observation: 'valid',
        availability: 'stale'
      });
      const merged = mergeLocalAndAuthenticated({ provider: 'codex', source: 'local session' }, cached);
      const dashboard = buildUsageDashboardModel({ states: [merged] });
      const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');
      const sevenDay = dashboard.providers[0]?.windows.find(window => window.key === 'sevenDay');
      assert.equal(fiveHour?.freshness, undefined);
      assert.equal(sevenDay?.health, 'stale');
      assert.equal(sevenDay?.healthDetail, 'Quota value is stale.');
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
