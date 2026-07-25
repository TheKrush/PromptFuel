import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { buildTodayOverviewFromCharts } from '../panel/dashboard/today';
import { buildClaudeHistoryChart, buildCodexHistoryChart, buildCombinedHistoryChart } from '../panel/dashboard/historyChart';
import { formatUsd } from '../panel/dashboard/format';
import { estimateAggregateCostUsd } from '../providers/pricing';
import type { ClaudeTodayUsageBucket } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../providers/codexCorrelatedDayBucketScanner';
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

function unavailableClaudeToday(): ClaudeTodayUsageBucket {
  return {
    ...claudeToday(),
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
    modelUsage: []
  };
}

function unavailableCodexToday(): CodexCorrelatedDayBucket {
  return {
    ...codexToday(),
    models: ['gpt-5-codex-20260517', 'o3'],
    modelUsage: []
  };
}

// Converts a Today usage bucket into a single production-shaped UsageHistoryPoint so the
// chart-fallback fixture below can be built by the real buildClaudeHistoryChart /
// buildCodexHistoryChart builders (via their remoteHistoryPoints argument) instead of a
// hand-assembled object literal. `models` intentionally omits label/provider/pricing fields —
// buildClaudeHistoryChart/buildCodexHistoryChart compute those for real (via
// normalizeRemoteHistoryPointModels -> modelPricingFields), exactly as production does for
// snapshot-sourced points.
function historyPointFromBucket(bucket: ClaudeTodayUsageBucket | CodexCorrelatedDayBucket): UsageHistoryPoint {
  // buildUsageHistoryRangeViews() anchors its 1D bin to the real local "today" (default
  // anchorDateKey), not to whatever fixed dateKey a fixture bucket carries. The point's
  // dateKey must match that real anchor day or it falls outside the 1D bin and
  // rangeViews['1D'].activeBinCount stays 0.
  const todayKey = localDateKey(new Date());
  return {
    dateKey: todayKey,
    label: todayKey,
    totalTokens: bucket.totalTokens,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheTokens: bucket.cacheCreationInputTokens + bucket.cacheReadInputTokens,
    cacheCreationTokens: bucket.cacheCreationInputTokens,
    cacheReadTokens: bucket.cacheReadInputTokens,
    assistantMessages: bucket.assistantMessages,
    models: (bucket.modelUsage ?? []).map(model => ({
      label: model.model,
      model: model.model,
      totalTokens: model.totalTokens,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cacheCreationInputTokens: model.cacheCreationInputTokens,
      cacheReadInputTokens: model.cacheReadInputTokens,
      assistantMessages: model.assistantMessages
    }))
  };
}

function chartForTodayBucket(bucket: ClaudeTodayUsageBucket | CodexCorrelatedDayBucket): UsageDashboardHistoryChart {
  const isClaude = !('correlatedTurns' in bucket);
  const point = historyPointFromBucket(bucket);
  return isClaude
    ? buildClaudeHistoryChart(undefined, [point])
    : buildCodexHistoryChart(undefined, [point]);
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

function overviewApiCard(model: ReturnType<typeof buildUsageDashboardModel>) {
  const card = model.today.overviewCards?.find(item => item.key === 'overviewTodayApiEquivalent');
  assert.ok(card, 'Overview Today API-equivalent card must exist');
  return card;
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

  it('keeps an estimable Codex Overview contribution when Claude is unavailable', () => {
    const model = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: unavailableClaudeToday(),
      codexTodayUsage: codexToday(),
      enabledProviders: ['claude', 'codex']
    });
    const overview = overviewApiCard(model);
    const codex = model.today.cards.find(card => card.key === 'codexTodayApiEquivalent');
    const claude = model.today.cards.find(card => card.key === 'todayApiEquivalent');

    assert.ok(codex);
    assert.ok(claude);
    assert.equal(overview.available, true, 'Overview remains available from Codex contribution');
    assert.equal(overview.value, codex.value, 'Overview partial total equals the valid Codex contribution');
    assert.match(overview.detail ?? '', /Partial estimate.*Claude/, 'Overview labels missing Claude coverage as partial');
    assert.match(overview.detailTooltip ?? '', /partial: unavailable from Claude/i, 'Overview tooltip discloses unavailable Claude coverage');
    assert.equal(claude.available, false, 'Claude provider card remains unavailable');
  });

  it('marks a fully estimable Overview API-equivalent as complete', () => {
    const claude = claudeToday();
    const codex = codexToday();
    const model = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: claude,
      codexTodayUsage: codex,
      enabledProviders: ['claude', 'codex']
    });
    const expected = estimateAggregateCostUsd((claude.modelUsage ?? []).map(item => ({
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheCreationInputTokens: item.cacheCreationInputTokens,
      cacheReadInputTokens: item.cacheReadInputTokens
    })), true).costUsd + estimateAggregateCostUsd((codex.modelUsage ?? []).map(item => ({
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheCreationInputTokens: item.cacheCreationInputTokens,
      cacheReadInputTokens: item.cacheReadInputTokens
    })), false).costUsd;
    const overview = overviewApiCard(model);

    assert.equal(overview.available, true);
    assert.equal(overview.value, formatUsd(expected), 'Overview complete total equals both provider estimates');
    assert.doesNotMatch(overview.detail ?? '', /Partial estimate/, 'fully estimable Overview is not marked partial');
  });

  it('keeps the Overview API-equivalent unavailable when no provider is estimable', () => {
    const model = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: unavailableClaudeToday(),
      codexTodayUsage: unavailableCodexToday(),
      enabledProviders: ['claude', 'codex']
    });
    const overview = overviewApiCard(model);

    assert.equal(overview.available, false);
    assert.equal(overview.value, 'Unavailable');
  });

  it('drops malformed estimates without poisoning a valid Overview contribution', () => {
    const malformedClaude = claudeToday();
    const malformedModel = malformedClaude.modelUsage?.[0];
    assert.ok(malformedModel, 'Claude fixture includes model usage');
    malformedClaude.modelUsage = [{
      ...malformedModel,
      inputTokens: Number.NaN
    }];
    const model = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: malformedClaude,
      codexTodayUsage: codexToday(),
      enabledProviders: ['claude', 'codex']
    });
    const overview = overviewApiCard(model);
    const codex = model.today.cards.find(card => card.key === 'codexTodayApiEquivalent');

    assert.ok(codex);
    assert.equal(overview.available, true);
    assert.equal(overview.value, codex.value, 'malformed Claude cost does not alter valid Codex total');
    assert.doesNotMatch(`${overview.value} ${overview.detail}`, /NaN/, 'Overview never renders malformed estimate values');
    assert.match(overview.detail ?? '', /Partial estimate.*Claude/);
  });

  it('keeps all direct Today and chart-fallback Overview cards in parity', () => {
    const scenarios = [
      { label: 'complete', claude: claudeToday(), codex: codexToday(), available: true, partial: false },
      { label: 'partial', claude: unavailableClaudeToday(), codex: codexToday(), available: true, partial: true },
      { label: 'unavailable', claude: unavailableClaudeToday(), codex: unavailableCodexToday(), available: false, partial: false }
    ];

    for (const scenario of scenarios) {
      const direct = buildUsageDashboardModel({
        states: [claudeState(), codexState()],
        claudeTodayUsage: scenario.claude,
        codexTodayUsage: scenario.codex,
        enabledProviders: ['claude', 'codex']
      }).today.overviewCards;
      const fallback = buildTodayOverviewFromCharts(
        chartForTodayBucket(scenario.claude),
        chartForTodayBucket(scenario.codex),
        true,
        true
      );

      assert.ok(direct, `${scenario.label} direct Today Overview cards exist`);
      assert.ok(fallback, `${scenario.label} chart fallback Overview cards exist`);
      assert.equal(direct.length, 5, `${scenario.label} direct Today has five Overview cards`);
      assert.equal(fallback.length, 5, `${scenario.label} chart fallback has five Overview cards`);
      // `source` is intentionally stripped: provenance differs by design between the direct
      // path (Today day-bucket source) and the chart-fallback path (1D-history source), and
      // both are asserted separately below. `detailTooltip` is NOT stripped — it is
      // byte-identical across both paths for all three scenarios and deepEqual should cover it.
      assert.deepEqual(
        fallback.map(({ source: _source, ...card }) => card),
        direct.map(({ source: _source, ...card }) => card),
        `${scenario.label} all Overview card semantics match across paths`
      );
      assert.deepEqual(
        fallback.map(card => card.source?.label),
        Array(5).fill('Today — combined'),
        `${scenario.label} chart fallback preserves its 1D-history provenance label`
      );
      assert.deepEqual(
        fallback.map(card => card.source?.detail),
        Array(5).fill('Claude and Codex today usage from 1D history bins.'),
        `${scenario.label} chart fallback preserves its 1D-history provenance detail`
      );
      assert.equal(
        fallback.find(card => card.key === 'overviewTodayApiEquivalent')?.available,
        scenario.available,
        `${scenario.label} chart fallback API-equivalent availability matches direct Today`
      );
      assert.equal(
        /Partial estimate/.test(fallback.find(card => card.key === 'overviewTodayApiEquivalent')?.detail ?? ''),
        scenario.partial,
        `${scenario.label} chart fallback partial disclosure is expected`
      );
    }
  });

  it('keeps chart-derived Today partial when a prepared 1D provider card rejects incomplete model coverage', () => {
    const incompleteClaude = claudeToday();
    const incompleteModel = incompleteClaude.modelUsage?.[0];
    assert.ok(incompleteModel, 'Claude fixture includes model usage');
    incompleteClaude.modelUsage = [{
      ...incompleteModel,
      inputTokens: 500,
      totalTokens: 500
    }];
    const fallback = buildTodayOverviewFromCharts(
      chartForTodayBucket(incompleteClaude),
      chartForTodayBucket(codexToday()),
      true,
      true
    );
    const apiCard = fallback?.find(card => card.key === 'overviewTodayApiEquivalent');

    assert.equal(apiCard?.available, true);
    assert.match(apiCard?.detail ?? '', /Partial estimate.*Claude/);
    assert.match(apiCard?.detailTooltip ?? '', /partial: unavailable from Claude: model\/token data unavailable/i);
  });

  it('pins the exact direct-path two-provider Overview source label and detail', () => {
    const direct = buildUsageDashboardModel({
      states: [claudeState(), codexState()],
      claudeTodayUsage: claudeToday(),
      codexTodayUsage: codexToday(),
      enabledProviders: ['claude', 'codex']
    }).today.overviewCards;

    assert.ok(direct, 'two-provider direct Today Overview cards exist');
    assert.deepEqual(
      direct.map(card => card.source?.label),
      Array(5).fill('Today — combined'),
      'direct Today two-provider Overview source label is pinned exactly'
    );
    assert.deepEqual(
      direct.map(card => card.source?.detail),
      Array(5).fill('Combined Today usage from enabled Claude and Codex sources.'),
      'direct Today two-provider Overview source detail is pinned exactly'
    );
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
