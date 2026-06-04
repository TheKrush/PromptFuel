import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import type { ClaudeTodayUsageBucket } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../providers/codexCorrelatedDayBucketScanner';
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

function claudeToday(): ClaudeTodayUsageBucket {
  return {
    available: true,
    dateKey: '2026-06-04',
    dateLabel: '2026-06-04',
    assistantMessages: 2,
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 200,
    cacheReadInputTokens: 100,
    totalTokens: 1800,
    models: ['claude-sonnet-4-20250514'],
    modelUsage: [{
      model: 'claude-sonnet-4-20250514',
      assistantMessages: 2,
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 100,
      totalTokens: 1800
    }],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 2,
    recordsMatched: 2,
    fileReadErrors: 0
  };
}

function codexToday(): CodexCorrelatedDayBucket {
  return {
    available: true,
    dateKey: '2026-06-04',
    dateLabel: '2026-06-04',
    assistantMessages: 3,
    correlatedTurns: 3,
    inputTokens: 2000,
    outputTokens: 900,
    cacheCreationInputTokens: 300,
    cacheReadInputTokens: 100,
    reasoningOutputTokens: 50,
    totalTokens: 3350,
    models: ['gpt-5-codex-20260517'],
    modelUsage: [{
      model: 'gpt-5-codex-20260517',
      assistantMessages: 3,
      inputTokens: 2000,
      outputTokens: 900,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 100,
      reasoningOutputTokens: 50,
      totalTokens: 3350
    }],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 3,
    recordsMatched: 3,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

describe('provider tabs model', () => {
  it('overview tab exists and is default', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
    const overview = model.tabs.find(t => t.key === 'overview');
    assert.ok(overview, 'overview tab must exist');
    assert.equal(overview.label, 'Overview');
    assert.equal(overview.isDefault, true);
    assert.equal(overview.provider, undefined);
    assert.equal(model.selectedTab, 'overview');
  });

  it('both Claude and Codex tabs are generated when both providers have data', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
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
    const model = buildUsageDashboardModel({ states: [claudeState()], enabledProviders: ['claude'] });
    const keys = model.tabs.map(t => t.key);
    assert.ok(keys.includes('overview'));
    assert.ok(keys.includes('claude'));
    assert.ok(!keys.includes('codex'), 'Codex tab must not appear when only Claude is enabled');
  });

  it('only Codex tab when only Codex has data', () => {
    const model = buildUsageDashboardModel({ states: [codexState()], enabledProviders: ['codex'] });
    const keys = model.tabs.map(t => t.key);
    assert.ok(keys.includes('overview'));
    assert.ok(keys.includes('codex'));
    assert.ok(!keys.includes('claude'), 'Claude tab must not appear when only Codex is enabled');
  });

  it('filters disabled local provider states from dashboard visibility', () => {
    const model = buildUsageDashboardModel({
      states: [claudeState({ error: 'unavailable' }), codexState()],
      enabledProviders: ['codex']
    });
    const keys = model.tabs.map(t => t.key);
    assert.deepEqual(model.providers.map(provider => provider.provider), ['codex']);
    assert.deepEqual(model.details.providers.map(provider => provider.provider), ['codex']);
    assert.ok(!keys.includes('claude'), 'Omitted local Claude must not appear as a dashboard tab');
  });

  it('tab order: overview first, then providers', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
    assert.equal(model.tabs[0].key, 'overview');
    assert.equal(model.tabs[0].isDefault, true);
    const providerTabs = model.tabs.filter(t => t.key !== 'overview');
    assert.ok(providerTabs.length >= 2);
  });

  it('no "This Machine" wording appears in tabs or model', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes('This Machine'), 'Model must not contain "This Machine" wording');
  });

  it('absent snapshots do not create misleading snapshot controls', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
    assert.equal(model.remoteProviders, undefined, 'remoteProviders should be undefined when no remote groups');
    for (const tab of model.tabs) {
      assert.equal((tab as any).snapshotControls, undefined, 'Tabs must not contain snapshotControls field');
    }
  });

  it('tabs array length matches expected count for both providers', () => {
    const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
    assert.equal(model.tabs.length, 3);
  });

  it('overview today cards aggregate Claude and Codex into one card set', () => {
    const model = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: claudeToday(),
      codexTodayUsage: codexToday(),
      enabledProviders: ['claude', 'codex']
    });

    assert.equal(model.today.overviewCards?.length, 5, 'Overview has one five-card Today set');
    assert.deepEqual(
      model.today.overviewCards?.map(card => card.key),
      [
        'overviewTodayMessages',
        'overviewTodayTokens',
        'overviewTodayInputOutput',
        'overviewTodayCache',
        'overviewTodayApiEquivalent'
      ],
      'Overview Today cards use aggregate keys only'
    );
    assert.equal(model.today.overviewCards?.find(card => card.key === 'overviewTodayMessages')?.value, '5');
    assert.equal(model.today.overviewCards?.find(card => card.key === 'overviewTodayTokens')?.value, '5.1K');
    assert.equal(model.today.overviewCards?.find(card => card.key === 'overviewTodayInputOutput')?.value, '3.0K / 1.4K');
    assert.equal(model.today.overviewCards?.find(card => card.key === 'overviewTodayCache')?.value, '700');
    assert.ok(model.today.cards.some(card => card.key === 'todayTokens'), 'Claude provider Today cards remain in model');
    assert.ok(model.today.cards.some(card => card.key === 'codexTodayTokens'), 'Codex provider Today cards remain in model');
  });

  describe('scopedToProvider filtering', () => {
    it('scopedToProvider=claude filters providers to Claude only', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], scopedToProvider: 'claude' });
      assert.equal(model.providers.length, 1);
      assert.equal(model.providers[0].provider, 'claude');
      assert.equal(model.selectedTab, 'claude');
    });

    it('scopedToProvider=codex filters providers to Codex only', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], scopedToProvider: 'codex' });
      assert.equal(model.providers.length, 1);
      assert.equal(model.providers[0].provider, 'codex');
      assert.equal(model.selectedTab, 'codex');
    });

    it('scopedToProvider=undefined returns all providers (overview)', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()] });
      assert.equal(model.providers.length, 2);
      assert.equal(model.selectedTab, 'overview');
    });

    it('scopedToProvider=claude today cards are scoped to Claude', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], claudeTodayUsage: claudeToday(), codexTodayUsage: codexToday(), scopedToProvider: 'claude' });
      const todayAvailable = model.today.available;
      assert.equal(typeof todayAvailable, 'boolean');
      const allKeys = model.today.cards.map(c => c.key);
      assert.ok(!allKeys.some(k => k.indexOf('codexToday') === 0), 'No Codex-prefixed cards should appear when scoped to Claude');
      assert.equal(model.today.overviewCards?.find(c => c.key === 'overviewTodayTokens')?.value, '1.8K', 'Claude tab model overview fallback stays Claude-scoped');
    });

    it('scopedToProvider=codex today cards are scoped to Codex', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], claudeTodayUsage: claudeToday(), codexTodayUsage: codexToday(), scopedToProvider: 'codex' });
      const allKeys = model.today.cards.map(c => c.key);
      assert.ok(allKeys.some(k => k.indexOf('codexToday') === 0), 'Codex today cards must include codexToday-prefixed keys');
      assert.ok(!allKeys.some(k => k === 'todayTokens' || k === 'todayInputOutput' || k === 'todayCache'), 'No Claude-only cards should appear when scoped to Codex');
      assert.equal(model.today.overviewCards?.find(c => c.key === 'overviewTodayTokens')?.value, '3.3K', 'Codex tab model overview fallback stays Codex-scoped');
    });

    it('overview has both tabs present even with scopedToProvider set', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], scopedToProvider: 'claude' });
      const keys = model.tabs.map(t => t.key);
      assert.ok(keys.includes('overview'), 'Overview tab must exist');
      assert.ok(keys.includes('claude'), 'Claude tab must exist');
      assert.ok(keys.includes('codex'), 'Codex tab must exist even when scoped to Claude');
    });
  });
});
