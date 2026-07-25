import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { buildClaudeHistoryChart, buildCodexHistoryChart, buildCombinedHistoryChart } from '../panel/dashboard/historyChart';
import type { UsageDashboardHistoryChart } from '../panel/usageDashboardModel';
import type { UsageHistoryPoint } from '../panel/usageHistoryBinning';
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

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function historyPoint(
  provider: 'claude' | 'codex',
  dateKey: string,
  costUsd: number | undefined,
  options: { totalTokens?: number; source?: 'local' | 'remote'; sourceLabel?: string; modelData?: boolean } = {}
): UsageHistoryPoint & { sourceLabel?: string } {
  const totalTokens = options.totalTokens ?? 1000;
  const modelData = options.modelData ?? true;
  const model = provider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-5-codex-20260517';
  return {
    dateKey,
    label: dateKey,
    totalTokens,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    models: modelData ? [{
      label: model,
      model,
      provider,
      providerLabel: provider === 'claude' ? 'Claude' : 'Codex',
      totalTokens,
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      apiEquivalentCostUsd: costUsd,
      pricingMatchedModel: model,
      assistantMessages: totalTokens > 0 ? 1 : 0
    }] : [],
    source: options.source ?? 'local',
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {})
  };
}

function historyChartForTest(points: UsageHistoryPoint[]): UsageDashboardHistoryChart {
  return {
    available: true,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    ranges: [],
    points: points as UsageDashboardHistoryChart['points'],
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0)
  };
}

function combinedRangeCard(
  claudePoints: UsageHistoryPoint[],
  codexPoints: UsageHistoryPoint[],
  range: '1D' | '1W' | '1M' | '1Y' | 'ALL' = '1D'
) {
  const combined = buildCombinedHistoryChart(historyChartForTest(claudePoints), historyChartForTest(codexPoints));
  assert.ok(combined?.rangeViews?.[range]?.apiEquivalentCard, `${range} combined range card must be serialized`);
  return combined.rangeViews[range].apiEquivalentCard;
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

  describe('serialized history range API-equivalent cards', () => {
    const today = localDateKey(new Date());
    const priorDayDate = new Date();
    priorDayDate.setDate(priorDayDate.getDate() - 1);
    const priorDay = localDateKey(priorDayDate);

    it('keeps valid Codex when unavailable Claude coverage makes the combined card partial', () => {
      const card = combinedRangeCard(
        [historyPoint('claude', today, undefined, { modelData: false })],
        [historyPoint('codex', today, 2.34)]
      );

      assert.equal(card.available, true);
      assert.equal(card.value, '$2.34');
      assert.match(card.detail ?? '', /Partial estimate.*Claude/);
      assert.match(card.detailTooltip ?? '', /partial: unavailable from Claude: local history model\/token data unavailable/i);
    });

    it('serializes a complete combined card only when both active provider contributions are estimable', () => {
      const card = combinedRangeCard(
        [historyPoint('claude', today, 1.23)],
        [historyPoint('codex', today, 2.34)]
      );

      assert.equal(card.available, true);
      assert.equal(card.value, '$3.57');
      assert.doesNotMatch(card.detail ?? '', /Partial estimate/);
      assert.deepEqual(card.detailLines, ['Claude: $1.23', 'Codex: $2.34']);
    });

    it('preserves unavailable presentation when neither active provider can be estimated', () => {
      const card = combinedRangeCard(
        [historyPoint('claude', today, undefined, { modelData: false })],
        [historyPoint('codex', today, undefined, { modelData: false })]
      );

      assert.equal(card.available, false);
      assert.equal(card.value, 'Unavailable');
      assert.equal(card.detail, 'Provider estimates unavailable');
    });

    it('excludes malformed provider cost data without emitting NaN or a fake zero', () => {
      const card = combinedRangeCard(
        [historyPoint('claude', today, Number.NaN)],
        [historyPoint('codex', today, 2.34)]
      );

      assert.equal(card.available, true);
      assert.equal(card.value, '$2.34');
      assert.match(card.detail ?? '', /Partial estimate.*Claude/);
      assert.doesNotMatch(`${card.value} ${card.detail} ${card.detailTooltip}`, /NaN/);
    });

    it('does not treat an inactive provider as unavailable combined-estimate coverage', () => {
      const card = combinedRangeCard(
        [historyPoint('claude', today, undefined, { totalTokens: 0, modelData: false })],
        [historyPoint('codex', today, 2.34)]
      );

      assert.equal(card.available, true);
      assert.equal(card.value, '$2.34');
      assert.doesNotMatch(card.detail ?? '', /Partial estimate/);
    });

    it('keeps provider-specific cards unavailable while the combined range can remain partial', () => {
      const unavailableClaude = historyPoint('claude', today, undefined, { modelData: false });
      const claudeChart = buildClaudeHistoryChart(undefined, [unavailableClaude]);
      const providerCard = claudeChart.rangeViews?.['1D'].apiEquivalentCard;
      const combinedCard = combinedRangeCard([unavailableClaude], [historyPoint('codex', today, 2.34)]);

      assert.equal(providerCard?.available, false);
      assert.equal(combinedCard.available, true);
      assert.match(combinedCard.detail ?? '', /Partial estimate.*Claude/);
    });

    it('binds each prepared card to its exact range and keeps source disclosure safe', () => {
      const claudeToday = historyPoint('claude', today, undefined, { modelData: false, source: 'remote', sourceLabel: 'raw-hostname.example' });
      const codexToday = historyPoint('codex', today, 2.34);
      const claudePrior = historyPoint('claude', priorDay, 1.23);
      const codexPrior = historyPoint('codex', priorDay, 3.45);
      const oneDay = combinedRangeCard([claudeToday, claudePrior], [codexToday, codexPrior], '1D');
      const oneWeek = combinedRangeCard([claudeToday, claudePrior], [codexToday, codexPrior], '1W');

      assert.notEqual(oneDay.value, oneWeek.value, 'distinct ranges carry distinct prepared cards');
      assert.match(oneDay.detailTooltip ?? '', /snapshot history model\/token data unavailable/i);
      assert.doesNotMatch(JSON.stringify(oneDay), /raw-hostname\.example/);
    });
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

    it('overview has both tabs present even with scopedToProvider set', () => {
      const model = buildUsageDashboardModel({ states: [claudeState(), codexState()], scopedToProvider: 'claude' });
      const keys = model.tabs.map(t => t.key);
      assert.ok(keys.includes('overview'), 'Overview tab must exist');
      assert.ok(keys.includes('claude'), 'Claude tab must exist');
      assert.ok(keys.includes('codex'), 'Codex tab must exist even when scoped to Claude');
    });
  });
});
