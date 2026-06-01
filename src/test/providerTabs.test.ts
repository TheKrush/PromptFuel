import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import type { ProviderUsageState } from '../types';

const now = Date.now();
const resetEpoch = Math.floor((now + 90 * 60 * 1000) / 1000);

function claudeState(overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider: 'claude',
    fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: resetEpoch },
    sevenDay: { usedPercentage: 40, resetsAtEpochSeconds: resetEpoch },
    source: 'Claude local session snapshot',
    lastUpdatedEpochMs: now,
    stale: false,
    ...overrides
  };
}

function codexState(overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider: 'codex',
    fiveHour: { usedPercentage: 50, resetsAtEpochSeconds: resetEpoch },
    sevenDay: { usedPercentage: 60, resetsAtEpochSeconds: resetEpoch },
    source: 'Codex local session snapshot',
    lastUpdatedEpochMs: now,
    stale: false,
    ...overrides
  };
}

describe('provider tabs model', () => {
  it('overview tab exists and is default', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    const overview = model.tabs.find(t => t.key === 'overview');
    assert.ok(overview, 'overview tab must exist');
    assert.equal(overview.label, 'Overview');
    assert.equal(overview.isDefault, true);
    assert.equal(overview.provider, undefined);
    assert.equal(model.selectedTab, 'overview');
  });

  it('both Claude and Codex tabs are generated when both providers have data', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    const keys = model.tabs.map(t => t.key);
    assert.ok(keys.includes('claude'), 'Claude tab must exist');
    assert.ok(keys.includes('codex'), 'Codex tab must exist');

    const claudeTab = model.tabs.find(t => t.key === 'claude');
    assert.equal(claudeTab?.label, 'Claude');
    assert.equal(claudeTab?.provider, 'claude');

    const codexTab = model.tabs.find(t => t.key === 'codex');
    assert.equal(codexTab?.label, 'Codex');
    assert.equal(codexTab?.provider, 'codex');
  });

  it('only Claude tab when only Claude has data', () => {
    const model = buildUsageDashboardModel([claudeState()], undefined, undefined, undefined, undefined, ['claude']);
    const keys = model.tabs.map(t => t.key);
    assert.ok(keys.includes('overview'));
    assert.ok(keys.includes('claude'));
    assert.ok(!keys.includes('codex'), 'Codex tab must not appear when only Claude is enabled');
  });

  it('only Codex tab when only Codex has data', () => {
    const model = buildUsageDashboardModel([codexState()], undefined, undefined, undefined, undefined, ['codex']);
    const keys = model.tabs.map(t => t.key);
    assert.ok(keys.includes('overview'));
    assert.ok(keys.includes('codex'));
    assert.ok(!keys.includes('claude'), 'Claude tab must not appear when only Codex is enabled');
  });

  it('tab order: overview first, then providers', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    assert.equal(model.tabs[0].key, 'overview');
    assert.equal(model.tabs[0].isDefault, true);
    const providerTabs = model.tabs.filter(t => t.key !== 'overview');
    assert.ok(providerTabs.length >= 2);
  });

  it('no "This Machine" wording appears in tabs or model', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes('This Machine'), 'Model must not contain "This Machine" wording');
  });

  it('absent snapshots do not create misleading snapshot controls', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    assert.equal(model.remoteProviders, undefined, 'remoteProviders should be undefined when no remote groups');
    for (const tab of model.tabs) {
      assert.equal((tab as any).snapshotControls, undefined, 'Tabs must not contain snapshotControls field');
    }
  });

  it('tabs array length matches expected count for both providers', () => {
    const model = buildUsageDashboardModel([claudeState(), codexState()]);
    assert.equal(model.tabs.length, 3);
  });

  describe('scopedToProvider filtering', () => {
    it('scopedToProvider=claude filters providers to Claude only', () => {
      const model = buildUsageDashboardModel([claudeState(), codexState()], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'claude');
      assert.equal(model.providers.length, 1);
      assert.equal(model.providers[0].provider, 'claude');
      assert.equal(model.selectedTab, 'claude');
    });

    it('scopedToProvider=codex filters providers to Codex only', () => {
      const model = buildUsageDashboardModel([claudeState(), codexState()], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'codex');
      assert.equal(model.providers.length, 1);
      assert.equal(model.providers[0].provider, 'codex');
      assert.equal(model.selectedTab, 'codex');
    });

    it('scopedToProvider=undefined returns all providers (overview)', () => {
      const model = buildUsageDashboardModel([claudeState(), codexState()]);
      assert.equal(model.providers.length, 2);
      assert.equal(model.selectedTab, 'overview');
    });

    it('scopedToProvider=claude today cards are scoped to Claude', () => {
      const model = buildUsageDashboardModel([claudeState()], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'claude');
      const todayAvailable = model.today.available;
      assert.equal(typeof todayAvailable, 'boolean');
      const allKeys = model.today.cards.map(c => c.key);
      assert.ok(!allKeys.some(k => k.indexOf('codexToday') === 0), 'No Codex-prefixed cards should appear when scoped to Claude');
    });

    it('scopedToProvider=codex today cards are scoped to Codex', () => {
      const model = buildUsageDashboardModel([codexState()], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'codex');
      const allKeys = model.today.cards.map(c => c.key);
      assert.ok(allKeys.some(k => k.indexOf('codexToday') === 0), 'Codex today cards must include codexToday-prefixed keys');
      assert.ok(!allKeys.some(k => k === 'todayTokens' || k === 'todayInputOutput' || k === 'todayCache'), 'No Claude-only cards should appear when scoped to Codex');
    });

    it('overview has both tabs present even with scopedToProvider set', () => {
      const model = buildUsageDashboardModel([claudeState(), codexState()], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'claude');
      const keys = model.tabs.map(t => t.key);
      assert.ok(keys.includes('overview'), 'Overview tab must exist');
      assert.ok(keys.includes('claude'), 'Claude tab must exist');
      assert.ok(keys.includes('codex'), 'Codex tab must exist even when scoped to Claude');
    });
  });
});
