import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePresentableQuotaWindowState, FormatOptions, formatStatus } from '../display/format';
import {
  mergeAuthenticatedFailure,
  mergeAuthenticatedQuotaSuccess,
  mergeLocalAndAuthenticated
} from '../quota/merge';
import { getAuthenticatedRefreshGate } from '../quota/refreshPolicy';
import { getNextResetRefreshPlan } from '../quota/resetRefresh';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { ProviderName, ProviderUsageState } from '../types';

const now = Date.now();
const fiveHourReset = Math.floor((now + 90 * 60 * 1000) / 1000);
const sevenDayReset = Math.floor((now + 3 * 24 * 60 * 60 * 1000) / 1000);
const expiredReset = Math.floor((now - 5 * 60 * 1000) / 1000);
const postReset = Math.floor((now + 4 * 60 * 60 * 1000) / 1000);
const backoffUntil = now + 60_000;

function liveState(provider: ProviderName = 'codex', overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider,
    fiveHour: { usedPercentage: 35, resetsAtEpochSeconds: fiveHourReset },
    sevenDay: { usedPercentage: 20, resetsAtEpochSeconds: sevenDayReset },
    source: 'live authenticated refresh',
    lastUpdatedEpochMs: now,
    lastAuthenticatedRefreshEpochMs: now,
    authenticatedStatus: 'success',
    stale: false,
    ...overrides
  };
}

function localState(provider: ProviderName = 'codex', overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider,
    fiveHour: { usedPercentage: 80, resetsAtEpochSeconds: fiveHourReset },
    sevenDay: { usedPercentage: 65, resetsAtEpochSeconds: sevenDayReset },
    source: `${provider} local session snapshot`,
    lastUpdatedEpochMs: now - 10_000,
    lastLocalUpdateEpochMs: now - 10_000,
    tracing: {
      currentInputTokens: 123,
      currentOutputTokens: 45
    },
    ...overrides
  };
}

function failure(
  provider: ProviderName,
  status: ProviderUsageState['authenticatedStatus'],
  overrides: Partial<ProviderUsageState> = {}
): ProviderUsageState {
  return {
    provider,
    source: 'authenticated quota provider',
    lastAuthenticatedRefreshEpochMs: now + 1_000,
    authenticatedStatus: status,
    authenticatedHttpStatus: status === 'http_error' ? 500 : status === 'auth_expired' ? 401 : undefined,
    authenticatedError: `${status} synthetic failure`,
    stale: true,
    ...overrides
  };
}

function formatSingle(state: ProviderUsageState): ReturnType<typeof formatStatus>['providers'][number] {
  const formatted = formatStatus([state], formatOptions()).providers[0];

  assert.ok(formatted);
  return formatted;
}

function formatOptions(): FormatOptions {
  return {
    displayMode: 'standard',
    statusMode: 'remaining',
    lowRemainingPercent: 50,
    warnRemainingPercent: 30,
    criticalRemainingPercent: 10,
    emptyRemainingPercent: 1
  };
}

describe('quota fallback regression coverage', () => {
  it('live authenticated success updates displayed quota', () => {
    const merged = mergeAuthenticatedQuotaSuccess(localState(), liveState());
    const formatted = formatSingle(merged);

    assert.equal(merged.fiveHour?.usedPercentage, 35);
    assert.equal(merged.sevenDay?.usedPercentage, 20);
    assert.equal(merged.fiveHour?.sourceKind, 'authenticated');
    assert.match(formatted.text, /80%/);
    assert.match(formatted.text, /65%/);
    assert.doesNotMatch(formatted.text, /unavailable|\?/i);
  });

  it('HTTP and network failures preserve cached or local quota', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('codex'));
    const httpFallback = mergeAuthenticatedFailure(cached, failure('codex', 'http_error'), backoffUntil);

    assert.equal(httpFallback.fiveHour?.usedPercentage, 35);
    assert.equal(httpFallback.sevenDay?.usedPercentage, 20);
    assert.equal(httpFallback.fiveHour?.sourceKind, 'cache');
    assert.match(formatSingle(httpFallback).tooltip, /Live refresh failed; using cached quota/);

    const networkFallback = mergeAuthenticatedFailure(localState('claude'), failure('claude', 'network_error'), backoffUntil);
    assert.equal(networkFallback.fiveHour?.usedPercentage, 80);
    assert.equal(networkFallback.sevenDay?.usedPercentage, 65);
    assert.equal(networkFallback.fiveHour?.sourceKind, 'localSession');
    assert.match(formatSingle(networkFallback).tooltip, /Live refresh failed; using local quota/);
  });

  it('parse/schema and auth-expired failures preserve cached or local quota', () => {
    const cached = mergeAuthenticatedFailure(
      mergeAuthenticatedQuotaSuccess(undefined, liveState('codex')),
      failure('codex', 'parse_error'),
      backoffUntil
    );
    assert.equal(cached.fiveHour?.usedPercentage, 35);
    assert.equal(cached.sevenDay?.usedPercentage, 20);
    assert.equal(cached.fiveHour?.sourceKind, 'cache');
    assert.match(formatSingle(cached).tooltip, /Live refresh failed; using cached quota/);

    const localFallback = mergeAuthenticatedFailure(localState('claude'), failure('claude', 'auth_expired'), backoffUntil);
    assert.equal(localFallback.fiveHour?.usedPercentage, 80);
    assert.equal(localFallback.sevenDay?.usedPercentage, 65);
    assert.equal(localFallback.fiveHour?.sourceKind, 'localSession');
    assert.match(formatSingle(localFallback).tooltip, /Auth expired; showing last known quota/);
  });

  it('no cache and no local quota produces an unavailable state', () => {
    const unavailable = mergeAuthenticatedFailure(undefined, failure('codex', 'network_error'), backoffUntil);
    const formatted = formatSingle(unavailable);

    assert.equal(unavailable.fiveHour, undefined);
    assert.equal(unavailable.sevenDay, undefined);
    assert.match(formatted.text, /Codex unavailable/);
    assert.match(formatted.text, /unavailable/);
  });

  it('stale cached critical quota remains critical instead of unavailable', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('codex', {
      fiveHour: { usedPercentage: 97, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 20, resetsAtEpochSeconds: sevenDayReset }
    }));
    const fallback = mergeAuthenticatedFailure(cached, failure('codex', 'http_error'), backoffUntil);
    const formatted = formatSingle(fallback);
    const fiveHour = derivePresentableQuotaWindowState(fallback, fallback.fiveHour, formatOptions());

    assert.equal(fiveHour.severity, 'critical');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(fiveHour.incident, 'http_error');
    assert.equal(formatted.severity, 'critical');
    assert.match(formatted.text, /3%/);
    assert.doesNotMatch(formatted.text, /unavailable|\?/i);
  });

  it('high quota with auth incident stays normal quota severity', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      fiveHour: { usedPercentage: 15, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 10, resetsAtEpochSeconds: sevenDayReset }
    }));
    const fallback = mergeAuthenticatedFailure(cached, failure('claude', 'auth_expired'), backoffUntil);
    const formatted = formatSingle(fallback);
    const fiveHour = derivePresentableQuotaWindowState(fallback, fallback.fiveHour, formatOptions());

    assert.equal(fiveHour.severity, 'normal');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(fiveHour.incident, 'auth_expired');
    assert.equal(formatted.severity, 'normal');
    assert.match(formatted.text, /85%/);
    assert.match(formatted.text, /90%/);
    assert.doesNotMatch(formatted.text, /unavailable|\?|blocked/i);
  });

  it('local metadata can update without overwriting quota', () => {
    const cached = mergeAuthenticatedFailure(
      mergeAuthenticatedQuotaSuccess(undefined, liveState('codex')),
      failure('codex', 'http_error'),
      backoffUntil
    );
    const updatedLocal = localState('codex', {
      lastUpdatedEpochMs: now + 5_000,
      lastLocalUpdateEpochMs: now + 5_000,
      tracing: {
        currentInputTokens: 999,
        currentOutputTokens: 111
      }
    });

    const merged = mergeLocalAndAuthenticated(updatedLocal, cached);

    assert.equal(merged.fiveHour?.usedPercentage, 35);
    assert.equal(merged.sevenDay?.usedPercentage, 20);
    assert.equal(merged.fiveHour?.sourceKind, 'cache');
    assert.equal(merged.tracing?.currentInputTokens, 999);
    assert.equal(merged.tracing?.currentOutputTokens, 111);
  });

  it('stale local snapshots cannot overwrite newer live quota', () => {
    const local = localState('codex', {
      lastUpdatedEpochMs: now - 60_000,
      lastLocalUpdateEpochMs: now - 60_000,
      fiveHour: { usedPercentage: 99, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 99, resetsAtEpochSeconds: sevenDayReset }
    });
    const live = liveState('codex', {
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now
    });

    const merged = mergeLocalAndAuthenticated(local, live);

    assert.equal(merged.fiveHour?.usedPercentage, 35);
    assert.equal(merged.sevenDay?.usedPercentage, 20);
    assert.equal(merged.fiveHour?.sourceKind, 'authenticated');
    assert.match(merged.ignoredQuotaSource ?? '', /local session snapshot ignored/);
  });

  it('carries seven-day Opus quota through authenticated merges', () => {
    const opusReset = Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000);
    const local = localState('claude', {
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 50, resetsAtEpochSeconds: sevenDayReset }
    });
    const authenticated = liveState('claude', {
      fiveHour: { usedPercentage: 40, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 60, resetsAtEpochSeconds: sevenDayReset },
      sevenDayOpus: { usedPercentage: 80, resetsAtEpochSeconds: opusReset }
    });

    const merged = mergeLocalAndAuthenticated(local, authenticated);
    const successMerged = mergeAuthenticatedQuotaSuccess(local, authenticated);

    assert.equal(merged.fiveHour?.usedPercentage, 40);
    assert.equal(merged.sevenDay?.usedPercentage, 60);
    assert.deepEqual(merged.sevenDayOpus, authenticated.sevenDayOpus);
    assert.deepEqual(successMerged.sevenDayOpus, authenticated.sevenDayOpus);

    const opusOnly = mergeLocalAndAuthenticated(local, liveState('claude', {
      fiveHour: undefined,
      sevenDay: undefined,
      sevenDayOpus: { usedPercentage: 70, resetsAtEpochSeconds: opusReset }
    }));
    assert.equal(opusOnly.fiveHour?.usedPercentage, 30);
    assert.equal(opusOnly.sevenDay?.usedPercentage, 50);
    assert.equal(opusOnly.sevenDayOpus?.usedPercentage, 70);

    const codexMerged = mergeLocalAndAuthenticated(localState('codex'), liveState('codex'));
    assert.equal(codexMerged.sevenDayOpus, undefined);
  });

  it('reset-time refresh uses the same safe fallback path after live failure', () => {
    const resetPlan = getNextResetRefreshPlan(
      [{ provider: 'claude', fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset } }],
      { nowEpochMs: now, immediateDelayMs: 5_000, recentPastWindowMs: 10 * 60_000 }
    );
    assert.equal(resetPlan?.provider, 'claude');
    assert.equal(resetPlan?.windowLabel, '5h');

    const gate = getAuthenticatedRefreshGate({
      nowEpochMs: now,
      bypassPollDelay: true,
      bypassBackoff: true,
      backoffUntilEpochMs: backoffUntil,
      nextPollEpochMs: now + 5 * 60_000
    });
    assert.equal(gate.action, 'fetch');
    assert.equal(gate.bypassedBackoff, true);

    const expiredCached = mergeAuthenticatedFailure(
      liveState('claude', {
        fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset },
        lastUpdatedEpochMs: expiredReset * 1000 - 60_000,
        lastAuthenticatedRefreshEpochMs: expiredReset * 1000 - 60_000
      }),
      failure('claude', 'network_error'),
      backoffUntil
    );
    assert.equal(expiredCached.fiveHour?.usedPercentage, 100);
    assert.equal(expiredCached.fiveHour?.sourceKind, 'cache');
    assert.match(expiredCached.fiveHour?.sourceLabel ?? '', /expired cached quota snapshot/);
    assert.match(formatSingle(expiredCached).tooltip, /Live refresh failed; using expired cached quota/);
  });

  it('recovers from expired cached quota with newer local or live post-reset data', () => {
    const preResetCache = mergeAuthenticatedFailure(
      liveState('claude', {
        fiveHour: { usedPercentage: 0, resetsAtEpochSeconds: expiredReset },
        lastUpdatedEpochMs: expiredReset * 1000 - 60_000,
        lastAuthenticatedRefreshEpochMs: expiredReset * 1000 - 60_000
      }),
      failure('claude', 'http_error'),
      now + 30 * 60_000
    );
    assert.equal(preResetCache.fiveHour?.usedPercentage, 0);
    assert.equal(preResetCache.fiveHour?.sourceKind, 'cache');
    assert.match(preResetCache.fiveHour?.sourceLabel ?? '', /expired cached quota snapshot/);

    const localRecovery = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 5, resetsAtEpochSeconds: postReset },
      source: 'Claude statusLine quota',
      lastUpdatedEpochMs: now,
      lastLocalUpdateEpochMs: now
    }, preResetCache);
    assert.equal(localRecovery.fiveHour?.usedPercentage, 5);
    assert.equal(localRecovery.fiveHour?.sourceKind, 'statusLine');
    assert.match(localRecovery.ignoredQuotaSource ?? '', /expired cached quota snapshot ignored: expired reset window/);

    const liveRecovery = mergeAuthenticatedQuotaSuccess(preResetCache, liveState('claude', {
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: postReset },
      sevenDay: undefined,
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now
    }));
    assert.equal(liveRecovery.fiveHour?.usedPercentage, 2);
    assert.equal(liveRecovery.fiveHour?.sourceKind, 'authenticated');
  });

  it('does not reuse expired current windows when authenticated success omits that window', () => {
    const expiredCurrentFiveHour: ProviderUsageState = {
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset, sourceKind: 'cache' as const, sourceAuthorityRank: 100 },
      source: 'cached quota snapshot',
      stale: true,
      lastUpdatedEpochMs: expiredReset * 1000 - 60_000
    };
    const successMissingFiveHour = mergeAuthenticatedQuotaSuccess(expiredCurrentFiveHour, liveState('claude', {
      fiveHour: undefined,
      sevenDay: { usedPercentage: 10, resetsAtEpochSeconds: postReset },
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now
    }));
    assert.equal(successMissingFiveHour.fiveHour, undefined);

    const freshCurrentFiveHour: ProviderUsageState = {
      provider: 'claude',
      fiveHour: { usedPercentage: 40, resetsAtEpochSeconds: postReset, sourceKind: 'cache' as const, sourceAuthorityRank: 100 },
      source: 'cached quota snapshot',
      stale: true,
      lastUpdatedEpochMs: now - 60_000
    };
    const successMissingFreshFiveHour = mergeAuthenticatedQuotaSuccess(freshCurrentFiveHour, liveState('claude', {
      fiveHour: undefined,
      sevenDay: { usedPercentage: 10, resetsAtEpochSeconds: postReset },
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now
    }));
    assert.equal(successMissingFreshFiveHour.fiveHour?.usedPercentage, 40);
  });

  it('5h and 7d provider windows merge independently for Claude and Codex', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const cached = mergeAuthenticatedFailure(
        liveState(provider, {
          fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset },
          sevenDay: { usedPercentage: 45, resetsAtEpochSeconds: sevenDayReset },
          lastUpdatedEpochMs: expiredReset * 1000 - 60_000,
          lastAuthenticatedRefreshEpochMs: expiredReset * 1000 - 60_000
        }),
        failure(provider, 'http_error'),
        backoffUntil
      );
      const local = localState(provider, {
        fiveHour: { usedPercentage: 10, resetsAtEpochSeconds: postReset },
        sevenDay: { usedPercentage: 90, resetsAtEpochSeconds: sevenDayReset },
        lastUpdatedEpochMs: now,
        lastLocalUpdateEpochMs: now
      });

      const merged = mergeLocalAndAuthenticated(local, cached);

      assert.equal(merged.fiveHour?.usedPercentage, 10, `${provider} 5h should use fresh local quota`);
      assert.equal(merged.fiveHour?.sourceKind, 'localSession');
      assert.equal(merged.sevenDay?.usedPercentage, 45, `${provider} 7d should keep cached authenticated quota`);
      assert.equal(merged.sevenDay?.sourceKind, 'cache');
      assert.match(merged.ignoredQuotaSource ?? '', /expired cached quota snapshot ignored: expired reset window/);
      assert.match(merged.ignoredQuotaSource ?? '', /local session snapshot ignored: older\/lower authority/);
    }
  });

  it('fresh reset exhaustion guard renders as full instead of unavailable', () => {
    const freshReset5h = Math.floor((Date.now() + 5 * 60 * 60 * 1000) / 1000);
    const merged = mergeLocalAndAuthenticated({
      provider: 'codex',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: freshReset5h },
      sevenDay: { usedPercentage: 57, resetsAtEpochSeconds: sevenDayReset },
      source: 'local Codex session snapshot',
      lastUpdatedEpochMs: now
    }, undefined);
    const formatted = formatSingle(merged);
    const dashboard = buildUsageDashboardModel([merged]);
    const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');

    assert.equal(merged.fiveHour?.usedPercentage, 0);
    assert.match(formatted.text, /100%/);
    assert.doesNotMatch(formatted.text, /unavailable|\?/i);
    assert.equal(fiveHour?.available, true);
    assert.equal(fiveHour?.remainingPercent, 100);
  });

  it('clears expired local quota windows but preserves genuine exhausted windows', () => {
    const expiredLocalSession = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset },
      source: 'local session snapshot',
      lastUpdatedEpochMs: expiredReset * 1000 - 60_000
    }, undefined);
    assert.equal(expiredLocalSession.fiveHour?.usedPercentage, undefined);
    assert.equal(expiredLocalSession.fiveHour?.sourceKind, 'localSession');

    const expiredStatusLine = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset },
      source: 'Claude statusLine quota',
      lastUpdatedEpochMs: expiredReset * 1000 - 60_000
    }, undefined);
    assert.equal(expiredStatusLine.fiveHour?.usedPercentage, undefined);
    assert.equal(expiredStatusLine.fiveHour?.sourceKind, 'statusLine');

    const midWindowReset = Math.floor((now + 3 * 60 * 60 * 1000) / 1000);
    const midWindowExhausted = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: midWindowReset }
    }, undefined);
    assert.equal(midWindowExhausted.fiveHour?.usedPercentage, 100);
  });

  it('fresh reset exhaustion guard respects configured tolerance', () => {
    const freshReset5h = Math.floor((Date.now() + 5 * 60 * 60 * 1000) / 1000);
    const disabledGuard = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: freshReset5h }
    }, undefined, { freshResetToleranceSeconds: 0 });
    assert.equal(disabledGuard.fiveHour?.usedPercentage, 100);

    const thirtySecondsOff = Math.floor((Date.now() + 5 * 60 * 60 * 1000 + 30_000) / 1000);
    const toleranceMatch = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: thirtySecondsOff }
    }, undefined, { freshResetToleranceSeconds: 60 });
    assert.equal(toleranceMatch.fiveHour?.usedPercentage, 0);

    const ninetySecondsOff = Math.floor((Date.now() + 5 * 60 * 60 * 1000 + 90_000) / 1000);
    const toleranceMiss = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: ninetySecondsOff }
    }, undefined, { freshResetToleranceSeconds: 60 });
    assert.equal(toleranceMiss.fiveHour?.usedPercentage, 100);
  });

  it('dashboard keeps 5h available when usable percentage has no reset metadata', () => {
    for (const providerName of ['claude', 'codex'] as const) {
      const source = providerName === 'claude'
        ? 'Claude statusLine quota'
        : 'local Codex session snapshot';
      const fallback = mergeAuthenticatedFailure({
        provider: providerName,
        fiveHour: { usedPercentage: 0 },
        sevenDay: { usedPercentage: 57, resetsAtEpochSeconds: sevenDayReset },
        source,
        lastUpdatedEpochMs: now
      }, failure(providerName, 'network_error'), backoffUntil);
      const formatted = formatSingle(fallback);
      const dashboard = buildUsageDashboardModel([fallback]);
      const provider = dashboard.providers[0];
      const fiveHour = provider?.windows.find(window => window.key === 'fiveHour');

      assert.match(formatted.text, /100%/, `${providerName} 5h should render usable percent`);
      assert.doesNotMatch(formatted.text, /unavailable/i, `${providerName} 5h should not become unavailable`);
      assert.equal(fiveHour?.available, true, `${providerName} dashboard 5h should be available`);
      assert.equal(fiveHour?.remainingPercent, 100);
      assert.equal(fiveHour?.resetLabel, undefined);
      assert.doesNotMatch(fiveHour?.source?.unavailableReason ?? '', /missing|metadata/i);
    }
  });

  it('dashboard explains present windows that lack a usable percentage', () => {
    const dashboard = buildUsageDashboardModel([{
      provider: 'codex',
      fiveHour: { resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 57, resetsAtEpochSeconds: sevenDayReset },
      source: 'local Codex session snapshot',
      lastUpdatedEpochMs: now,
      authenticatedStatus: 'skipped'
    }]);
    const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');

    assert.equal(fiveHour?.available, false);
    assert.match(fiveHour?.source?.unavailableReason ?? '', /reset metadata but no usable percentage/);
  });
});
