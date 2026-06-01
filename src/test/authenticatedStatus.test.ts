import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_DISABLED_STATUSES, buildUsageDashboardModel } from '../panel/usageDashboardModel';
import type { AuthenticatedQuotaStatus, ProviderUsageState } from '../types';

function makeProviderState(overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider: 'claude',
    source: 'local statusLine/hook state',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    ...overrides
  };
}

function dashboardProvider(overrides: Partial<ProviderUsageState> = {}) {
  const model = buildUsageDashboardModel([makeProviderState(overrides)], undefined, undefined, undefined, undefined, ['claude']);
  const provider = model.providers.find(p => p.provider === 'claude');
  assert.ok(provider, 'claude provider present');
  return provider;
}

describe('authenticated status presentation', () => {
  it('classifies only disabled-style auth statuses as non-errors', () => {
    assert.ok(AUTH_DISABLED_STATUSES instanceof Set);
    assert.deepEqual([...AUTH_DISABLED_STATUSES].sort(), ['disabled', 'not_configured', 'skipped']);
    for (const status of ['backoff', 'http_error', 'network_error', 'auth_expired', 'parse_error', 'success']) {
      assert.equal(AUTH_DISABLED_STATUSES.has(status as AuthenticatedQuotaStatus), false);
    }
  });

  it('suppresses authenticated errors for disabled statuses', () => {
    for (const authenticatedStatus of AUTH_DISABLED_STATUSES) {
      const provider = dashboardProvider({
        authenticatedStatus,
        authenticatedError: 'Authenticated refresh is disabled.'
      });

      assert.equal(provider.error, undefined);
      assert.ok(provider.status, `${authenticatedStatus} should still expose neutral status context`);
      assert.equal(provider.status.toLowerCase().includes('error'), false);
      assert.equal(provider.status.toLowerCase().includes('failure'), false);
    }
  });

  it('preserves authenticated errors for active failure statuses', () => {
    for (const authenticatedStatus of ['http_error', 'network_error', 'auth_expired', 'parse_error', 'backoff'] as const) {
      const provider = dashboardProvider({
        authenticatedStatus,
        authenticatedError: 'Quota refresh failed'
      });

      assert.equal(provider.error, 'Quota refresh failed');
      assert.ok(provider.status, `${authenticatedStatus} should expose status context`);
    }
  });

  it('keeps local provider errors visible even when authenticated refresh is skipped', () => {
    const provider = dashboardProvider({
      authenticatedStatus: 'skipped',
      authenticatedError: 'Manual authenticated refresh is disabled.',
      error: 'Corrupt local state file'
    });

    assert.equal(provider.error, 'Corrupt local state file');
  });

  it('omits status text when no authenticated status exists', () => {
    assert.equal(dashboardProvider().status, undefined);
  });
});
