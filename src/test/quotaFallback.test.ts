import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePresentableQuotaWindowState, type FormatOptions } from '../display/format';
import {
  mergeAuthenticatedFailure,
  mergeAuthenticatedQuotaSuccess,
  mergeLocalAndAuthenticated
} from '../quota/merge';
import { getAuthenticatedRefreshGate } from '../quota/refreshPolicy';
import { getNextResetRefreshPlan } from '../quota/resetRefresh';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { CLAUDE_OPUS_USAGE_METER_ID } from '../providers/authenticatedQuota';
import type { ProviderName, ProviderUsageState } from '../types';

const now = Date.now();
const fiveHourReset = Math.floor((now + 90 * 60 * 1000) / 1000);
const sevenDayReset = Math.floor((now + 3 * 24 * 60 * 60 * 1000) / 1000);
const expiredReset = Math.floor((now - 5 * 60 * 1000) / 1000);
const stalePastReset = Math.floor((now - 12 * 60 * 60 * 1000) / 1000);
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

function formatOptions(): FormatOptions {
  return {
    displayMode: 'standard',
    statusMode: 'remaining'
  };
}

function dashboardWindow(state: ProviderUsageState, key: 'fiveHour' | 'sevenDay') {
  const dashboard = buildUsageDashboardModel({ states: [state] });
  const provider = dashboard.providers[0];

  assert.ok(provider);
  const window = provider.windows.find(item => item.key === key);

  assert.ok(window);
  return window;
}

function dashboardMeter(state: ProviderUsageState, id: string) {
  const dashboard = buildUsageDashboardModel({ states: [state] });
  const provider = dashboard.providers[0];

  assert.ok(provider);
  const window = provider.windows.find(item => item.key === 'meter:' + id);

  assert.ok(window);
  return window;
}

describe('quota fallback regression coverage', () => {
  it('live authenticated success updates displayed quota', () => {
    const merged = mergeAuthenticatedQuotaSuccess(localState(), liveState());
    const fiveHour = derivePresentableQuotaWindowState(merged, merged.fiveHour, formatOptions());
    const sevenDay = derivePresentableQuotaWindowState(merged, merged.sevenDay, formatOptions());

    assert.equal(merged.fiveHour?.usedPercentage, 35);
    assert.equal(merged.sevenDay?.usedPercentage, 20);
    assert.equal(merged.fiveHour?.sourceKind, 'authenticated');
    assert.equal(merged.sevenDay?.sourceKind, 'authenticated');
    assert.equal(fiveHour.freshness, 'live');
    assert.equal(sevenDay.freshness, 'live');
    assert.equal(dashboardWindow(merged, 'fiveHour').remainingPercent, 65);
    assert.equal(dashboardWindow(merged, 'sevenDay').remainingPercent, 80);
  });

  it('HTTP and network failures preserve cached or local quota', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('codex'));
    const httpFallback = mergeAuthenticatedFailure(cached, failure('codex', 'http_error'), backoffUntil);
    const httpFiveHour = derivePresentableQuotaWindowState(httpFallback, httpFallback.fiveHour, formatOptions());

    assert.equal(httpFallback.fiveHour?.usedPercentage, 35);
    assert.equal(httpFallback.sevenDay?.usedPercentage, 20);
    assert.equal(httpFallback.fiveHour?.sourceKind, 'cache');
    assert.equal(httpFallback.sevenDay?.sourceKind, 'cache');
    assert.equal(httpFallback.authenticatedStatus, 'http_error');
    assert.equal(httpFiveHour.freshness, 'cached');
    assert.equal(httpFiveHour.incident, 'http_error');
    assert.equal(dashboardWindow(httpFallback, 'fiveHour').remainingPercent, 65);
    assert.equal(dashboardWindow(httpFallback, 'sevenDay').remainingPercent, 80);

    const networkFallback = mergeAuthenticatedFailure(localState('claude'), failure('claude', 'network_error'), backoffUntil);
    const networkFiveHour = derivePresentableQuotaWindowState(networkFallback, networkFallback.fiveHour, formatOptions());

    assert.equal(networkFallback.fiveHour?.usedPercentage, 80);
    assert.equal(networkFallback.sevenDay?.usedPercentage, 65);
    assert.equal(networkFallback.fiveHour?.sourceKind, 'localSession');
    assert.equal(networkFallback.sevenDay?.sourceKind, 'localSession');
    assert.equal(networkFallback.authenticatedStatus, 'network_error');
    assert.equal(networkFiveHour.freshness, 'local');
    assert.equal(networkFiveHour.incident, 'network_error');
    assert.equal(dashboardWindow(networkFallback, 'fiveHour').remainingPercent, 20);
    assert.equal(dashboardWindow(networkFallback, 'sevenDay').remainingPercent, 35);
  });

  it('parse/schema and auth-expired failures preserve cached or local quota', () => {
    const cached = mergeAuthenticatedFailure(
      mergeAuthenticatedQuotaSuccess(undefined, liveState('codex')),
      failure('codex', 'parse_error'),
      backoffUntil
    );
    const cachedFiveHour = derivePresentableQuotaWindowState(cached, cached.fiveHour, formatOptions());

    assert.equal(cached.fiveHour?.usedPercentage, 35);
    assert.equal(cached.sevenDay?.usedPercentage, 20);
    assert.equal(cached.fiveHour?.sourceKind, 'cache');
    assert.equal(cached.sevenDay?.sourceKind, 'cache');
    assert.equal(cached.authenticatedStatus, 'parse_error');
    assert.equal(cachedFiveHour.freshness, 'cached');
    assert.equal(cachedFiveHour.incident, 'parse_error');
    assert.equal(dashboardWindow(cached, 'fiveHour').remainingPercent, 65);
    assert.equal(dashboardWindow(cached, 'sevenDay').remainingPercent, 80);

    const localFallback = mergeAuthenticatedFailure(localState('claude'), failure('claude', 'auth_expired'), backoffUntil);
    const localFiveHour = derivePresentableQuotaWindowState(localFallback, localFallback.fiveHour, formatOptions());

    assert.equal(localFallback.fiveHour?.usedPercentage, 80);
    assert.equal(localFallback.sevenDay?.usedPercentage, 65);
    assert.equal(localFallback.fiveHour?.sourceKind, 'localSession');
    assert.equal(localFallback.sevenDay?.sourceKind, 'localSession');
    assert.equal(localFallback.authenticatedStatus, 'auth_expired');
    assert.equal(localFiveHour.freshness, 'local');
    assert.equal(localFiveHour.incident, 'auth_expired');
    assert.equal(dashboardWindow(localFallback, 'fiveHour').remainingPercent, 20);
    assert.equal(dashboardWindow(localFallback, 'sevenDay').remainingPercent, 35);
  });

  it('no cache and no local quota produces an unavailable state', () => {
    const unavailable = mergeAuthenticatedFailure(undefined, failure('codex', 'network_error'), backoffUntil);
    const fiveHour = derivePresentableQuotaWindowState(unavailable, unavailable.fiveHour, formatOptions());
    const sevenDay = derivePresentableQuotaWindowState(unavailable, unavailable.sevenDay, formatOptions());

    assert.equal(unavailable.fiveHour, undefined);
    assert.equal(unavailable.sevenDay, undefined);
    assert.equal(unavailable.authenticatedStatus, 'network_error');
    assert.equal(fiveHour.severity, 'unavailable');
    assert.equal(fiveHour.freshness, 'unknown');
    assert.equal(fiveHour.incident, 'network_error');
    assert.equal(sevenDay.severity, 'unavailable');
    assert.equal(sevenDay.freshness, 'unknown');
    assert.equal(sevenDay.incident, 'network_error');
  });

  it('stale cached critical quota remains critical instead of unavailable', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('codex', {
      fiveHour: { usedPercentage: 97, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 20, resetsAtEpochSeconds: sevenDayReset }
    }));
    const fallback = mergeAuthenticatedFailure(cached, failure('codex', 'http_error'), backoffUntil);
    const fiveHour = derivePresentableQuotaWindowState(fallback, fallback.fiveHour, formatOptions());

    assert.equal(fallback.fiveHour?.usedPercentage, 97);
    assert.equal(fallback.fiveHour?.sourceKind, 'cache');
    assert.equal(fiveHour.severity, 'critical');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(fiveHour.incident, 'http_error');
    assert.equal(dashboardWindow(fallback, 'fiveHour').available, true);
    assert.equal(dashboardWindow(fallback, 'fiveHour').remainingPercent, 3);
  });

  it('high quota with auth incident stays normal quota severity', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      fiveHour: { usedPercentage: 15, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 10, resetsAtEpochSeconds: sevenDayReset }
    }));
    const fallback = mergeAuthenticatedFailure(cached, failure('claude', 'auth_expired'), backoffUntil);
    const fiveHour = derivePresentableQuotaWindowState(fallback, fallback.fiveHour, formatOptions());
    const sevenDay = derivePresentableQuotaWindowState(fallback, fallback.sevenDay, formatOptions());

    assert.equal(fiveHour.severity, 'normal');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(fiveHour.incident, 'auth_expired');
    assert.equal(sevenDay.severity, 'normal');
    assert.equal(sevenDay.freshness, 'cached');
    assert.equal(sevenDay.incident, 'auth_expired');
    assert.equal(dashboardWindow(fallback, 'fiveHour').remainingPercent, 85);
    assert.equal(dashboardWindow(fallback, 'sevenDay').remainingPercent, 90);
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
    assert.equal(merged.sevenDay?.sourceKind, 'cache');
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
    assert.equal(merged.sevenDay?.sourceKind, 'authenticated');
    assert.equal(merged.lastUpdatedEpochMs, now);
    assert.equal(merged.lastAuthenticatedRefreshEpochMs, now);
  });

  it('carries the migrated Opus meter through authenticated merges', () => {
    const opusReset = Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000);
    const local = localState('claude', {
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 50, resetsAtEpochSeconds: sevenDayReset }
    });
    const authenticated = liveState('claude', {
      fiveHour: { usedPercentage: 40, resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 60, resetsAtEpochSeconds: sevenDayReset },
      meters: [{
        id: CLAUDE_OPUS_USAGE_METER_ID,
        label: 'opus 7d',
        scope: 'modelFamily',
        windowSeconds: 7 * 24 * 60 * 60,
        window: { usedPercentage: 80, resetsAtEpochSeconds: opusReset }
      }]
    });

    const merged = mergeLocalAndAuthenticated(local, authenticated);
    const successMerged = mergeAuthenticatedQuotaSuccess(local, authenticated);

    assert.equal(merged.fiveHour?.usedPercentage, 40);
    assert.equal(merged.sevenDay?.usedPercentage, 60);
    assert.equal(merged.meters?.[0]?.id, CLAUDE_OPUS_USAGE_METER_ID);
    assert.equal(merged.meters?.[0]?.window.usedPercentage, 80);
    assert.equal(successMerged.meters?.[0]?.id, CLAUDE_OPUS_USAGE_METER_ID);

    const opusOnly = mergeLocalAndAuthenticated(local, liveState('claude', {
      fiveHour: undefined,
      sevenDay: undefined,
      meters: [{
        id: CLAUDE_OPUS_USAGE_METER_ID,
        label: 'opus 7d',
        scope: 'modelFamily',
        windowSeconds: 7 * 24 * 60 * 60,
        window: { usedPercentage: 70, resetsAtEpochSeconds: opusReset }
      }]
    }));
    assert.equal(opusOnly.fiveHour?.usedPercentage, 30);
    assert.equal(opusOnly.sevenDay?.usedPercentage, 50);
    assert.equal(opusOnly.meters?.[0]?.window.usedPercentage, 70);
    assert.equal(dashboardMeter(opusOnly, CLAUDE_OPUS_USAGE_METER_ID).remainingPercent, 30);

    const codexMerged = mergeLocalAndAuthenticated(localState('codex'), liveState('codex'));
    assert.equal(codexMerged.meters, undefined);
  });

  it('generic meters receive cached expiry treatment like primary windows', () => {
    const meterId = 'fake-scoped-meter';
    const expiredCached = mergeAuthenticatedFailure(
      liveState('claude', {
        fiveHour: { usedPercentage: 35, resetsAtEpochSeconds: fiveHourReset },
        meters: [{
          id: meterId,
          label: 'preview 1d',
          scope: 'model',
          windowSeconds: 86_400,
          window: { usedPercentage: 100, resetsAtEpochSeconds: expiredReset }
        }],
        lastUpdatedEpochMs: expiredReset * 1000 - 60_000,
        lastAuthenticatedRefreshEpochMs: expiredReset * 1000 - 60_000
      }),
      failure('claude', 'network_error'),
      backoffUntil
    );

    assert.equal(expiredCached.meters?.[0]?.window.usedPercentage, 0);
    assert.equal(expiredCached.meters?.[0]?.window.sourceKind, 'cache');
    assert.equal(dashboardMeter(expiredCached, meterId).remainingPercent, 100);
  });

  it('reset-time refresh treats expired cached quota as reset after live failure', () => {
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
    const fiveHour = derivePresentableQuotaWindowState(expiredCached, expiredCached.fiveHour, formatOptions());

    assert.equal(expiredCached.fiveHour?.usedPercentage, 0);
    assert.equal(expiredCached.fiveHour?.sourceKind, 'cache');
    assert.equal(expiredCached.authenticatedStatus, 'network_error');
    assert.equal(fiveHour.severity, 'normal');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(fiveHour.incident, 'network_error');
    assert.equal(dashboardWindow(expiredCached, 'fiveHour').remainingPercent, 100);
  });

  it('manually resets long-expired cached quota windows to full remaining', () => {
    const staleCached = mergeAuthenticatedFailure(
      liveState('codex', {
        fiveHour: { usedPercentage: 74, resetsAtEpochSeconds: stalePastReset },
        sevenDay: { usedPercentage: 41, resetsAtEpochSeconds: sevenDayReset },
        lastUpdatedEpochMs: stalePastReset * 1000 - 60_000,
        lastAuthenticatedRefreshEpochMs: stalePastReset * 1000 - 60_000
      }),
      failure('codex', 'network_error'),
      backoffUntil
    );
    const fiveHour = derivePresentableQuotaWindowState(staleCached, staleCached.fiveHour, formatOptions());

    assert.equal(staleCached.fiveHour?.usedPercentage, 0);
    assert.equal(staleCached.fiveHour?.sourceKind, 'cache');
    assert.equal(staleCached.fiveHour?.sourceLabel, 'expired cached quota snapshot');
    assert.equal(fiveHour.severity, 'normal');
    assert.equal(fiveHour.freshness, 'cached');
    assert.equal(dashboardWindow(staleCached, 'fiveHour').remainingPercent, 100);
    assert.equal(dashboardWindow(staleCached, 'sevenDay').remainingPercent, 59);
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

    const localRecovery = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 5, resetsAtEpochSeconds: postReset },
      source: 'Claude statusLine quota',
      lastUpdatedEpochMs: now,
      lastLocalUpdateEpochMs: now
    }, preResetCache);
    assert.equal(localRecovery.fiveHour?.usedPercentage, 5);
    assert.equal(localRecovery.fiveHour?.sourceKind, 'statusLine');
    assert.equal(localRecovery.lastUpdatedEpochMs, now);

    const liveRecovery = mergeAuthenticatedQuotaSuccess(preResetCache, liveState('claude', {
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: postReset },
      sevenDay: undefined,
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now
    }));
    assert.equal(liveRecovery.fiveHour?.usedPercentage, 2);
    assert.equal(liveRecovery.fiveHour?.sourceKind, 'authenticated');
    assert.equal(liveRecovery.lastAuthenticatedRefreshEpochMs, now);
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
    assert.equal(successMissingFreshFiveHour.fiveHour?.sourceKind, 'cache');
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

      assert.equal(merged.fiveHour?.usedPercentage, 10);
      assert.equal(merged.fiveHour?.sourceKind, 'localSession');
      assert.equal(merged.sevenDay?.usedPercentage, 45);
      assert.equal(merged.sevenDay?.sourceKind, 'cache');
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
    const fiveHour = dashboardWindow(merged, 'fiveHour');

    assert.equal(merged.fiveHour?.usedPercentage, 0);
    assert.equal(fiveHour.available, true);
    assert.equal(fiveHour.remainingPercent, 100);
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
      const fiveHour = dashboardWindow(fallback, 'fiveHour');

      assert.equal(fiveHour.available, true);
      assert.equal(fiveHour.remainingPercent, 100);
      assert.equal(fiveHour.resetLabel, undefined);
    }
  });

  it('dashboard marks present windows without usable percentage unavailable', () => {
    const dashboard = buildUsageDashboardModel({ states: [{
      provider: 'codex',
      fiveHour: { resetsAtEpochSeconds: fiveHourReset },
      sevenDay: { usedPercentage: 57, resetsAtEpochSeconds: sevenDayReset },
      source: 'local Codex session snapshot',
      lastUpdatedEpochMs: now,
      authenticatedStatus: 'skipped'
    }] });
    const fiveHour = dashboard.providers[0]?.windows.find(window => window.key === 'fiveHour');

    assert.equal(fiveHour?.available, false);
  });
});

describe('F6: explicit sourceKind — label-independence of merge results', () => {
  it('merge authority is unchanged when source display label is replaced with an arbitrary string', () => {
    const standardLabel = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 80, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'localSession',
      source: `claude local session snapshot`,
      lastUpdatedEpochMs: now - 10_000,
      lastLocalUpdateEpochMs: now - 10_000
    }, undefined);

    const arbitraryLabel = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 80, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'localSession',
      source: 'this label does not contain any matching keywords',
      lastUpdatedEpochMs: now - 10_000,
      lastLocalUpdateEpochMs: now - 10_000
    }, undefined);

    assert.equal(standardLabel.fiveHour?.sourceKind, 'localSession');
    assert.equal(arbitraryLabel.fiveHour?.sourceKind, 'localSession');
  });

  it('authenticated sourceKind yields authenticated window regardless of source string', () => {
    const standard = mergeAuthenticatedQuotaSuccess(undefined, {
      provider: 'claude',
      fiveHour: { usedPercentage: 10, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'authenticated',
      source: 'live authenticated refresh',
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now,
      authenticatedStatus: 'success',
      stale: false
    });

    const renamedLabel = mergeAuthenticatedQuotaSuccess(undefined, {
      provider: 'claude',
      fiveHour: { usedPercentage: 10, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'authenticated',
      source: 'custom display label for this source',
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now,
      authenticatedStatus: 'success',
      stale: false
    });

    assert.equal(standard.fiveHour?.sourceKind, 'authenticated');
    assert.equal(renamedLabel.fiveHour?.sourceKind, 'authenticated');
  });

  it('stale authenticated state produces cache windows regardless of source string', () => {
    const withKind = mergeAuthenticatedFailure(
      liveState('claude', {
        lastUpdatedEpochMs: now - 10_000,
        lastAuthenticatedRefreshEpochMs: now - 10_000
      }),
      {
        provider: 'claude',
        sourceKind: 'cache',
        source: 'renamed failure label',
        lastAuthenticatedRefreshEpochMs: now + 1_000,
        authenticatedStatus: 'http_error',
        authenticatedHttpStatus: 500,
        authenticatedError: 'HTTP 500',
        stale: true
      },
      backoffUntil
    );

    assert.equal(withKind.fiveHour?.sourceKind, 'cache');
    assert.equal(withKind.sevenDay?.sourceKind, 'cache');
  });

  it('statusLine sourceKind produces statusLine window regardless of source string', () => {
    const standard = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 5, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'statusLine',
      source: 'Claude statusLine quota',
      lastUpdatedEpochMs: now,
      lastLocalUpdateEpochMs: now
    }, undefined);

    const renamedSource = mergeLocalAndAuthenticated({
      provider: 'claude',
      fiveHour: { usedPercentage: 5, resetsAtEpochSeconds: fiveHourReset },
      sourceKind: 'statusLine',
      source: 'arbitrary label with no keywords',
      lastUpdatedEpochMs: now,
      lastLocalUpdateEpochMs: now
    }, undefined);

    assert.equal(standard.fiveHour?.sourceKind, 'statusLine');
    assert.equal(renamedSource.fiveHour?.sourceKind, 'statusLine');
  });
});

describe('authenticated refresh failure fallback stale semantics', () => {
  it('transient failure with recently cached quota does not mark the state stale', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      lastUpdatedEpochMs: now - 92_000,
      lastAuthenticatedRefreshEpochMs: now - 92_000
    }));

    const fallback = mergeAuthenticatedFailure(cached, failure('claude', 'network_error'), backoffUntil);

    assert.equal(fallback.fiveHour?.sourceKind, 'cache');
    assert.equal(fallback.stale, false);
  });

  it('genuinely old cached quota is still marked stale', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      lastUpdatedEpochMs: now - 25 * 60_000,
      lastAuthenticatedRefreshEpochMs: now - 25 * 60_000
    }));

    const fallback = mergeAuthenticatedFailure(cached, failure('claude', 'network_error'), backoffUntil);

    assert.equal(fallback.fiveHour?.sourceKind, 'cache');
    assert.equal(fallback.stale, true);
  });

  it('a state already flagged stale remains stale even with a recent timestamp', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      lastUpdatedEpochMs: now - 92_000,
      lastAuthenticatedRefreshEpochMs: now - 92_000
    }));
    const alreadyStale: ProviderUsageState = { ...cached, stale: true };

    const fallback = mergeAuthenticatedFailure(alreadyStale, failure('claude', 'network_error'), backoffUntil);

    assert.equal(fallback.stale, true);
  });

  it('a successful authenticated refresh clears stale state', () => {
    const cached = mergeAuthenticatedQuotaSuccess(undefined, liveState('claude', {
      lastUpdatedEpochMs: now - 25 * 60_000,
      lastAuthenticatedRefreshEpochMs: now - 25 * 60_000
    }));
    const stalledFallback = mergeAuthenticatedFailure(cached, failure('claude', 'network_error'), backoffUntil);
    assert.equal(stalledFallback.stale, true);

    const recovered = mergeAuthenticatedQuotaSuccess(stalledFallback, liveState('claude'));

    assert.equal(recovered.stale, false);
  });
});
