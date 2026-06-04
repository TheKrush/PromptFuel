#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixtureDateKeys = [localDateKey(-1), localDateKey(0)];
const fixtureRangeLabel = `${fixtureDateKeys[0]} to ${fixtureDateKeys[1]}`;

function tokenParts(totalTokens, inputRatio) {
  const inputTokens = Math.floor(totalTokens * inputRatio);
  const cacheCreationInputTokens = Math.floor(totalTokens * 0.06);
  const cacheReadInputTokens = Math.floor(totalTokens * 0.04);
  const outputTokens = Math.max(0, totalTokens - inputTokens - cacheCreationInputTokens - cacheReadInputTokens);
  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}

function localDateKey(offsetDays = 0, anchorDate = new Date()) {
  const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeClaudeHistory() {
  const parts = tokenParts(3000, 0.6);
  return {
    available: true,
    rangeLabel: fixtureRangeLabel,
    totalDays: 2,
    activeDays: 2,
    days: [
      makeClaudeDay(fixtureDateKeys[0], 1000, [
        ['claude-sonnet-4-20250514', 500],
        ['claude-opus-4-20250514', 300],
        ['claude-haiku-4-20250514', 200]
      ]),
      makeClaudeDay(fixtureDateKeys[1], 2000, [
        ['claude-sonnet-4-20250514', 900],
        ['claude-opus-4-20250514', 700],
        ['claude-haiku-4-20250514', 400]
      ])
    ],
    assistantMessages: 3,
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    cacheCreationInputTokens: parts.cacheCreationInputTokens,
    cacheReadInputTokens: parts.cacheReadInputTokens,
    totalTokens: 3000,
    modelUsage: [
      {
        model: 'claude-sonnet-4-20250514',
        assistantMessages: 3,
        inputTokens: parts.inputTokens,
        outputTokens: parts.outputTokens,
        cacheCreationInputTokens: parts.cacheCreationInputTokens,
        cacheReadInputTokens: parts.cacheReadInputTokens,
        totalTokens: 3000
      }
    ],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 3,
    recordsMatched: 3,
    fileReadErrors: 0
  };
}

function makeClaudeDay(dateKey, totalTokens, modelTotals) {
  const parts = tokenParts(totalTokens, 0.6);
  return {
    available: true,
    dateKey,
    dateLabel: dateKey,
    totalTokens,
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    cacheCreationInputTokens: parts.cacheCreationInputTokens,
    cacheReadInputTokens: parts.cacheReadInputTokens,
    assistantMessages: 1,
    models: ['claude-sonnet-4-20250514'],
    modelUsage: makeModelUsage(modelTotals || [['claude-sonnet-4-20250514', totalTokens]], 0.6),
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 1,
    recordsMatched: 1,
    fileReadErrors: 0
  };
}

function makeCodexHistory() {
  const parts = tokenParts(1000, 0.5);
  return {
    available: true,
    rangeLabel: fixtureRangeLabel,
    totalDays: 2,
    activeDays: 2,
    days: [
      makeCodexDay(fixtureDateKeys[0], 400, [
        ['gpt-5-codex-20260517', 220],
        ['gpt-5.4-codex-20260517', 180]
      ]),
      makeCodexDay(fixtureDateKeys[1], 600, [
        ['gpt-5-codex-20260517', 220],
        ['gpt-5.4-codex-20260517', 180],
        ['gpt-5.3-codex-20260517', 100],
        ['gpt-5.2-codex-20260517', 100]
      ])
    ],
    assistantMessages: 2,
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    cacheCreationInputTokens: parts.cacheCreationInputTokens,
    cacheReadInputTokens: parts.cacheReadInputTokens,
    reasoningOutputTokens: 25,
    totalTokens: 1000,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 4,
    recordsMatched: 2,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0,
    skippedTokenCountOutsideTurn: 0,
    skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0,
    modelUsage: [
      {
        model: 'gpt-5-codex-20260517',
        assistantMessages: 2,
        inputTokens: parts.inputTokens,
        outputTokens: parts.outputTokens,
        cacheCreationInputTokens: parts.cacheCreationInputTokens,
        cacheReadInputTokens: parts.cacheReadInputTokens,
        reasoningOutputTokens: 25,
        totalTokens: 1000
      }
    ]
  };
}

function makeZeroClaudeHistory() {
  return {
    available: true,
    rangeLabel: fixtureRangeLabel,
    totalDays: 2,
    activeDays: 0,
    days: fixtureDateKeys.map(makeZeroClaudeDay),
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 2,
    recordsMatched: 2,
    fileReadErrors: 0
  };
}

function makeZeroClaudeDay(dateKey) {
  return {
    available: true,
    dateKey,
    dateLabel: dateKey,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    assistantMessages: 0,
    models: [],
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 1,
    recordsMatched: 1,
    fileReadErrors: 0
  };
}

function makeZeroCodexHistory() {
  return {
    available: true,
    rangeLabel: fixtureRangeLabel,
    totalDays: 2,
    activeDays: 0,
    days: fixtureDateKeys.map(makeZeroCodexDay),
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 2,
    recordsMatched: 2,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0,
    skippedTokenCountOutsideTurn: 0,
    skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0,
    modelUsage: []
  };
}

function makeZeroCodexDay(dateKey) {
  return {
    available: true,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: 0,
    correlatedTurns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    models: [],
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 1,
    recordsMatched: 1,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

function withoutModelStacks(history) {
  return {
    ...history,
    modelUsage: [],
    days: history.days.map(day => ({ ...day, models: [], modelUsage: [] }))
  };
}

function withoutCache(history) {
  return {
    ...history,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    days: history.days.map(day => ({
      ...day,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      modelUsage: day.modelUsage.map(model => ({
        ...model,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      }))
    })),
    modelUsage: history.modelUsage.map(model => ({
      ...model,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0
    }))
  };
}

function makeCodexDay(dateKey, totalTokens, modelTotals) {
  const parts = tokenParts(totalTokens, 0.5);
  return {
    available: true,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: 1,
    correlatedTurns: 1,
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    cacheCreationInputTokens: parts.cacheCreationInputTokens,
    cacheReadInputTokens: parts.cacheReadInputTokens,
    reasoningOutputTokens: 10,
    totalTokens,
    models: ['gpt-5-codex-20260517'],
    modelUsage: makeModelUsage(modelTotals || [['gpt-5-codex-20260517', totalTokens]], 0.5, 10),
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 2,
    recordsMatched: 1,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

function makeModelUsage(modelTotals, inputRatio, reasoningOutputTokens = 0) {
  return modelTotals.map(([model, totalTokens]) => {
    const parts = tokenParts(totalTokens, inputRatio);
    return {
      model,
      assistantMessages: 1,
      inputTokens: parts.inputTokens,
      outputTokens: parts.outputTokens,
      cacheCreationInputTokens: parts.cacheCreationInputTokens,
      cacheReadInputTokens: parts.cacheReadInputTokens,
      reasoningOutputTokens,
      totalTokens
    };
  });
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { initModelPricingFromCsv } = require(path.join(repoRoot, 'out', 'modelPricing.js'));
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));
  const { createCanonicalUsageFixture } = require(path.join(repoRoot, 'out', 'test', 'fixtures', 'canonicalUsageFixture.js'));
  initModelPricingFromCsv(fs.readFileSync(path.join(repoRoot, 'data', 'model-pricing-estimates.csv'), 'utf8'));
  const model = buildUsageDashboardModel({ states: [], claudeUsageHistory: makeClaudeHistory(), codexCorrelatedHistory: makeCodexHistory(), enabledProviders: ['claude', 'codex'] });
  assert.ok(model.details.historyChart.available, 'Claude split chart remains available');
  assert.ok(model.details.codexHistoryChart.available, 'Codex split chart remains available');
  assert.ok(model.details.combinedHistoryChart.available, 'combined chart is available when both providers have history');
  assert.equal(model.details.combinedHistoryChart.source.confidence, 'mixedDayBucket', 'combined source confidence stays mixed');

  const combinedOneMonth = model.details.combinedHistoryChart.rangeViews['1M'];
  const activeCombinedPoint = combinedOneMonth.points.find(point => point.dateKey === fixtureDateKeys[1]);
  assert.ok(activeCombinedPoint, 'combined range view keeps active shared date');
  assert.equal(activeCombinedPoint.totalTokens, 2600, 'combined shared bin sums Claude and Codex displayed tokens including cache');
  assert.deepEqual(
    activeCombinedPoint.providerSegments.map(segment => segment.provider),
    ['claude', 'codex'],
    'combined shared bin preserves provider attribution'
  );
  assert.equal(
    activeCombinedPoint.providerSegments.find(segment => segment.provider === 'codex').sourceConfidence,
    'correlatedDayBucket',
    'Codex segment remains correlated in combined bins'
  );

  const claudeOnlyModel = buildUsageDashboardModel({ states: [], claudeUsageHistory: makeClaudeHistory(), enabledProviders: ['claude'] });
  assert.equal(claudeOnlyModel.details.combinedHistoryChart, undefined, 'single-provider history does not build combined chart');
  assert.equal(
    claudeOnlyModel.details.todayOverviewCards.find(card => card.key === 'overviewTodayTokens').detailLines,
    undefined,
    'single-provider Today aggregate does not emit redundant provider detailLines'
  );

  const webviewScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__combinedDashboardTest = { selectCombinedHistoryChartRange: selectCombinedHistoryChartRange, selectCombinedHistoryMetricCardsRange: selectCombinedHistoryMetricCardsRange, renderHistoryChart: renderHistoryChart, renderCombinedHistoryLegend: renderCombinedHistoryLegend, renderUsageHistorySection: renderUsageHistorySection, renderUsageMetricCard: renderUsageMetricCard, renderApiEstimateStrip: renderApiEstimateStrip, renderDashboardForSources: renderDashboardForSources, renderGlanceList: renderGlanceList, dashboardAggregateProviders: dashboardAggregateProviders, scopeProvidersByTab: scopeProvidersByTab, scopeTodayByTab: scopeTodayByTab, scopeDetailsByTab: scopeDetailsByTab, setCombinedHistoryRange: function(range) { currentCombinedHistoryRange = range; }, setClaudeHistoryRange: function(range) { currentClaudeHistoryRange = range; }, setCodexHistoryRange: function(range) { currentCodexHistoryRange = range; }, setProviderTab: function(tab) { currentUsageProviderTab = tab; }, computeSourceBreakdown: computeSourceBreakdown, formatSourceBreakdownLines: formatSourceBreakdownLines, selectClaudeHistoryMetricCardsRange: selectClaudeHistoryMetricCardsRange, selectCodexHistoryMetricCardsRange: selectCodexHistoryMetricCardsRange, usageCardsByKey: usageCardsByKey }; })();'
  );
  const fakeElements = {};
  const fakeElementForId = id => {
    if (!fakeElements[id]) {
      fakeElements[id] = {
        value: '',
        className: '',
        disabled: false,
        textContent: '',
        innerHTML: '',
        addEventListener: () => undefined,
        classList: {
          add: () => undefined,
          remove: () => undefined
        }
      };
    }
    return fakeElements[id];
  };
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      getElementById: id => fakeElementForId(id),
      querySelector: () => fakeElementForId('__query'),
      querySelectorAll: () => []
    },
    window: {
      addEventListener: () => undefined
    },
    setTimeout: () => undefined
  };
  vm.runInNewContext(instrumentedScript, sandbox);
  assert.equal(typeof sandbox.__combinedDashboardTest.renderDashboardForSources, 'function', 'renderDashboardForSources exists');
  assert.deepEqual(
    Array.from(sandbox.__combinedDashboardTest.dashboardAggregateProviders([{ provider: 'claude' }, { provider: 'codex' }, { provider: 'claude' }])),
    ['claude', 'codex'],
    'dashboardAggregateProviders derives unique aggregate providers from selected rows'
  );
  assert.match(
    webviewScript,
    /function renderUsageDashboardSections[\s\S]*scopeProvidersByTab[\s\S]*scopeTodayByTab[\s\S]*scopeDetailsByTab[\s\S]*renderDashboardForSources/,
    'renderUsageDashboardSections builds one context and enters renderDashboardForSources'
  );

  const selectedCombinedChart = sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(model.details.combinedHistoryChart, '1M');
  const combinedHtml = sandbox.__combinedDashboardTest.renderHistoryChart(selectedCombinedChart, 'combined', '1M', selectedCombinedChart.source);
  assert.match(combinedHtml, /usage-history-bar-fill stacked/, 'combined chart renders model-stacked history bars when model attribution exists');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment claude model/, 'combined model-stacked bars do not use aggregate Claude provider classes');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment codex model/, 'combined model-stacked bars do not use aggregate Codex provider classes');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment[^"]*\b(?:claude|codex)\b[^"]*\bmodel\b/, 'combined model-stacked bars have no provider styling class on model segments');
  assert.match(combinedHtml, /background-color:var\(--vscode-charts-blue,#4f8fd6\)/, 'combined stacked bars use shared model-series colors');
  assert.match(combinedHtml, /data-history-provider="combined"/, 'combined range controls share one range state');
  assert.equal(sandbox.__combinedDashboardTest.renderCombinedHistoryLegend(selectedCombinedChart), '', 'combined model-stacked bars omit redundant provider-level legend');

  const fallbackCombinedChart = {
    ...selectedCombinedChart,
    points: selectedCombinedChart.points.map(point => ({ ...point, models: [] }))
  };
  const fallbackCombinedHtml = sandbox.__combinedDashboardTest.renderHistoryChart(fallbackCombinedChart, 'combined', '1M', fallbackCombinedChart.source);
  assert.match(fallbackCombinedHtml, /usage-history-bar-fill combined/, 'combined chart falls back to provider bars without model attribution');
  assert.match(fallbackCombinedHtml, /usage-history-bar-segment claude/, 'combined fallback keeps Claude provider segment color');
  assert.match(fallbackCombinedHtml, /usage-history-bar-segment codex/, 'combined fallback keeps Codex provider segment color');
  assert.match(visibleTextFromHtml(sandbox.__combinedDashboardTest.renderCombinedHistoryLegend(fallbackCombinedChart)), /Claude/, 'combined fallback keeps provider legend when model stacks are unavailable');
  assert.doesNotMatch(visibleTextFromHtml(sandbox.__combinedDashboardTest.renderCombinedHistoryLegend(fallbackCombinedChart)), /correlated/i, 'combined fallback legend does not show visible correlated wording');

  const selectedProviders = [
    { provider: 'claude', label: 'Claude', windows: [] },
    { provider: 'codex', label: 'Codex', windows: [] }
  ];
  const glanceHtml = sandbox.__combinedDashboardTest.renderGlanceList([
    {
      provider: 'claude',
      label: 'Claude',
      windows: [
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 84, resetIso: '2026-06-04T12:00:00.000Z' },
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 42, resetIso: '2026-06-05T12:00:00.000Z' }
      ]
    },
    {
      provider: 'codex',
      label: 'Codex snapshot',
      machineLabel: 'snapshot',
      windows: [
        { key: 'fiveHour', label: '5h', available: false }
      ]
    }
  ]);
  const expectedGlanceColumns = ['provider', '7d-label', '7d-bar', '7d-percent', '7d-reset', '5h-label', '5h-bar', '5h-percent', '5h-reset', 'status'];
  assert.equal(glanceRowCount(glanceHtml), 2, 'At-a-glance fixture renders one row per provider/source');
  assert.deepEqual(glanceRowColumns(glanceHtml)[0], expectedGlanceColumns, 'At-a-glance rows render the shared ten-column structure');
  assert.deepEqual(glanceRowColumns(glanceHtml)[1], expectedGlanceColumns, 'At-a-glance rows keep the ten-column structure when a window is missing');
  assert.match(glanceHtml, /usage-glance-col-7d-bar/, 'At-a-glance markup includes stable 7d bar column class');
  assert.match(glanceHtml, /usage-glance-col-5h-reset/, 'At-a-glance markup includes stable 5h reset column class');
  assert.match(visibleTextFromHtml(glanceHtml), /Claude7d42%.*5h84%.*current/, 'At-a-glance fixture keeps provider, window values, and current status visible');
  assert.match(visibleTextFromHtml(glanceHtml), /Codex snapshot5h—snapshot/, 'At-a-glance fixture keeps unavailable window text and snapshot status visible');
  assert.match(glanceHtml, /data-glance-col="7d-bar"[^>]*>[\s\S]*?usage-progress/, 'progress bar markup stays inside the 7d bar cell');
  assert.match(glanceHtml, /data-glance-col="5h-bar"[^>]*>[\s\S]*?usage-progress/, 'progress bar markup stays inside the 5h bar cell');
  assert.match(glanceHtml, /data-glance-col="status">[^<]+<\/div>/, 'status text is inside the status cell');
  const glanceStaleHtml = sandbox.__combinedDashboardTest.renderGlanceList([
    {
      provider: 'claude',
      label: 'Claude',
      stale: true,
      windows: [
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 30, resetIso: '2026-06-05T12:00:00.000Z' },
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 60, resetIso: '2026-06-04T12:00:00.000Z' }
      ]
    },
    {
      provider: 'codex',
      label: 'Codex',
      windows: [
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 55, resetIso: '2026-06-05T18:00:00.000Z' },
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 80, resetIso: '2026-06-04T18:00:00.000Z' }
      ]
    },
    {
      provider: 'codex',
      label: 'Codex snapshot',
      machineLabel: 'snapshot',
      windows: [
        { key: 'sevenDay', label: '7d', available: false },
        { key: 'fiveHour', label: '5h', available: false }
      ]
    }
  ]);
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[0], expectedGlanceColumns, 'stale Claude row keeps the ten-column slot structure');
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[1], expectedGlanceColumns, 'Codex current row keeps the ten-column slot structure alongside a stale row');
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[2], expectedGlanceColumns, 'Codex snapshot row keeps the ten-column slot structure');
  assert.match(glanceStaleHtml, /usage-glance-row stale/, 'stale row renders the stale modifier class');
  assert.match(visibleTextFromHtml(glanceStaleHtml), /Claude.*30%.*stale/, 'stale Claude row keeps window values and stale badge visible');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  const combinedHistorySectionHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
  assert.match(combinedHistorySectionHtml, /usage-metric-card/, 'combined history renders metric cards');
  assert.match(combinedHistorySectionHtml, /usage-section-provider-grid combined/, 'dashboard history uses the combined provider grid');
  assert.equal(sectionProviderCardCount(combinedHistorySectionHtml), 1, 'Overview below At-a-glance renders exactly one aggregate card set');
  assert.match(combinedHistorySectionHtml, /usage-today-inline/, 'history section renders the Today card section');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /Today1D Messages\/Turns/, 'Today section uses 1D range-card labels');
  assert.match(combinedHistorySectionHtml, /Today[\s\S]*?Claude: 1<br>Codex: 1/, 'Today section uses range-card provider breakdown detailLines');
  assert.doesNotMatch(combinedHistorySectionHtml, /data-history-layout/, 'combined history section has no layout toggle controls');
  assert.doesNotMatch(combinedHistorySectionHtml, />Merged</, 'combined history section has no Merged button');
  assert.doesNotMatch(combinedHistorySectionHtml, />Separate</, 'combined history section has no Separate button');
  assert.doesNotMatch(combinedHistorySectionHtml, /usage-section-provider-title">Claude</, 'combined history does not require a separate Claude comparison card');
  assert.doesNotMatch(combinedHistorySectionHtml, /usage-section-provider-title">Codex</, 'combined history does not require a separate Codex comparison card');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /4\.0K/, 'combined history cards show combined displayed token totals including cache');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /Claude: 3\.0K Codex: 1\.0K/, 'combined history cards show line-based provider displayed-token attribution');
  assert.match(combinedHistorySectionHtml, /Claude: 3\.0K<br>Codex: 1\.0K/, 'combined history provider attribution renders with br-separated detail lines');
  const oneProviderCacheModel = buildUsageDashboardModel({
    states: [],
    claudeUsageHistory: makeClaudeHistory(),
    codexCorrelatedHistory: withoutCache(makeCodexHistory()),
    enabledProviders: ['claude', 'codex']
  });
  const oneProviderCacheHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(oneProviderCacheModel.details, oneProviderCacheModel.today, selectedProviders);
  const oneProviderCacheChart = sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(oneProviderCacheModel.details.combinedHistoryChart, '1M');
  const oneProviderCacheCard = sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(undefined, oneProviderCacheChart, '1M')
    .find(card => card.key === 'combinedHistoryCache');
  assert.match(visibleTextFromHtml(oneProviderCacheHtml), /1M cache300Claude 300 · Codex 0/, 'combined history cache keeps old provider attribution when only one provider has cache tokens');
  assert.equal(oneProviderCacheCard.detail, 'Claude 300 · Codex 0', 'combined history cache fallback detail is the old provider attribution');
  assert.equal(oneProviderCacheCard.detailLines, undefined, 'combined history cache does not force detailLines when only one provider contributes');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /\$0\.05/, 'combined history API-equivalent uses per-model selected-range pricing');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /Claude: \$0\.05 Codex: \$0\.01/, 'combined history API-equivalent shows line-based provider cost attribution');
  assert.match(combinedHistorySectionHtml, /Claude: \$0\.05<br>Codex: \$0\.01/, 'combined history API-equivalent renders provider cost attribution with br-separated detail lines');
  assert.match(combinedHistorySectionHtml, /<div class="usage-api-estimate-strip[^"]*"[^>]*title="[^"]*not actual billing[^"]*"[^>]*>1M API-equivalent:/, 'Overview 1M API-equivalent footer carries an estimate tooltip');
  assert.doesNotMatch(visibleTextFromHtml(combinedHistorySectionHtml), /not actual billing/i, 'API-equivalent footer does not show redundant visible billing-note text');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1D');
  const combinedOneDayHistorySectionHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
  assert.match(combinedOneDayHistorySectionHtml, /<div class="usage-api-estimate-strip[^"]*"[^>]*title="[^"]*not actual billing[^"]*"[^>]*>1D API-equivalent:/, 'Overview 1D API-equivalent footer carries an estimate tooltip through range cards');
  const oneDayApiHtml = firstApiEstimateStrip(combinedOneDayHistorySectionHtml, '1D API-equivalent');
  const oneMonthApiHtml = firstApiEstimateStrip(combinedHistorySectionHtml, '1M API-equivalent');
  assert.match(oneDayApiHtml, /title="1D API-equivalent estimate; fallback pricing used; not actual billing\."/i, 'Overview 1D fallback API-equivalent tooltip uses standardized wording');
  assert.match(oneMonthApiHtml, /title="1M API-equivalent estimate; fallback pricing used; not actual billing\."/i, 'Overview 1M fallback API-equivalent tooltip uses standardized wording');
  assert.match(oneDayApiHtml, /Claude: \$[0-9.]+<br>Codex: \$[0-9.]+/, 'Overview 1D API-equivalent renders one br-separated provider breakdown');
  assert.equal(countOccurrences(visibleTextFromHtml(oneDayApiHtml), /Claude: \$/g), 1, 'Overview 1D API-equivalent includes Claude breakdown exactly once');
  assert.equal(countOccurrences(visibleTextFromHtml(oneDayApiHtml), /Codex: \$/g), 1, 'Overview 1D API-equivalent includes Codex breakdown exactly once');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  assert.doesNotMatch(visibleTextFromHtml(combinedHistorySectionHtml), /correlated/i, 'combined history has no visible correlated chart label text');
  assert.doesNotMatch(combinedHistorySectionHtml, /\(stale\)/, 'combined history detail lines do not add stale markers');

  const escapedMetricHtml = sandbox.__combinedDashboardTest.renderUsageMetricCard({
    key: 'escaped',
    label: 'Escaped',
    value: '2',
    detailLines: ['Claude: <b>1</b>', 'Codex: A & B'],
    available: true
  });
  assert.match(escapedMetricHtml, /Claude: &lt;b&gt;1&lt;\/b&gt;<br>Codex: A &amp; B/, 'detailLines are escaped individually before br joining');
  assert.doesNotMatch(escapedMetricHtml, /Claude: <b>1<\/b>/, 'detailLines do not render raw HTML');

  const detailLinePriorityHtml = sandbox.__combinedDashboardTest.renderUsageMetricCard({
    key: 'detailLinePriority',
    label: 'Detail priority',
    value: '1',
    detail: 'Fallback detail',
    detailLines: ['Local: 1'],
    available: true
  });
  assert.match(visibleTextFromHtml(detailLinePriorityHtml), /Local: 1/, 'detailLines render when fallback detail is also present');
  assert.doesNotMatch(visibleTextFromHtml(detailLinePriorityHtml), /Fallback detail/, 'detailLines suppress fallback detail to avoid duplicate visible detail');

  const escapedApiHtml = sandbox.__combinedDashboardTest.renderApiEstimateStrip({
    key: 'escapedApiEquivalent',
    label: '1D API-equivalent',
    value: '$171',
    detail: 'Claude $57.34 | Codex $114',
    detailLines: ['Claude: <b>$57.34</b>', 'Codex: $114 & fees'],
    detailTooltip: 'Estimated <combined> "cost"; not actual billing',
    available: true
  });
  assert.match(escapedApiHtml, /title="Estimated &lt;combined&gt; &quot;cost&quot;; not actual billing"/, 'API-equivalent tooltip is escaped as an attribute');
  assert.match(escapedApiHtml, /Claude: &lt;b&gt;\$57\.34&lt;\/b&gt;<br>Codex: \$114 &amp; fees/, 'API-equivalent detailLines are escaped and br-joined');
  assert.doesNotMatch(visibleTextFromHtml(escapedApiHtml), /Claude \$57\.34 \| Codex \$114/, 'API-equivalent detailLines suppress fallback detail text');

  const staleProviderHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, [
    { provider: 'claude', label: 'Claude', stale: true, windows: [] },
    { provider: 'codex', label: 'Codex', windows: [] }
  ]);
  assert.match(staleProviderHtml, /Claude: 3\.0K<br>Codex: 1\.0K/, 'stale selected provider rows still leave aggregate breakdown values visible');
  assert.doesNotMatch(staleProviderHtml, /\(stale\)/, 'stale context remains outside per-line breakdown text');

  const partialApiModel = buildUsageDashboardModel({
    states: [],
    claudeUsageHistory: makeClaudeHistory(),
    codexCorrelatedHistory: withoutModelStacks(makeCodexHistory()),
    enabledProviders: ['claude', 'codex']
  });
  const partialApiHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(partialApiModel.details, partialApiModel.today, selectedProviders);
  assert.match(visibleTextFromHtml(partialApiHtml), /1M API-equivalent: Unavailable/, 'partial provider API-equivalent does not expose a partial combined value');
  assert.match(visibleTextFromHtml(partialApiHtml), /Estimate requires per-model token data from all providers/, 'partial provider API-equivalent keeps explanatory unavailable detail');
  assert.doesNotMatch(visibleTextFromHtml(partialApiHtml), /Partial/, 'partial provider API-equivalent no longer renders partial estimate copy');
  assert.doesNotMatch(partialApiHtml, /Claude: \$0\.[0-9]+<br>Codex:/, 'partial provider API-equivalent does not emit fake per-provider dollar detailLines');
  sandbox.__combinedDashboardTest.setProviderTab('codex');
  sandbox.__combinedDashboardTest.setCodexHistoryRange('1M');
  const partialCodexHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(partialApiModel.details, 'codex'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(partialApiModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(partialApiModel.providers, 'codex')
  );
  const partialCodexApiHtml = firstApiEstimateStrip(partialCodexHtml, '1M API-equivalent');
  assert.match(visibleTextFromHtml(partialCodexApiHtml), /1M API-equivalent: Unavailable/, 'provider API footer stays unavailable when source model data is incomplete');
  assert.match(visibleTextFromHtml(partialCodexApiHtml), /No token data to estimate API-equivalent cost/, 'provider API footer keeps explanatory unavailable detail');
  assert.doesNotMatch(visibleTextFromHtml(partialCodexApiHtml), /Local: \$/, 'provider API footer does not emit fake partial source dollar detailLines');
  assert.doesNotMatch(visibleTextFromHtml(partialCodexApiHtml), /Codex: \$/, 'provider API footer does not fall back to provider-style dollar detailLines when unavailable');
  sandbox.__combinedDashboardTest.setProviderTab('overview');
  ['1W', '1M', '1Y', 'ALL'].forEach(range => {
    sandbox.__combinedDashboardTest.setCombinedHistoryRange(range);
    const rangeHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
    const rangeText = visibleTextFromHtml(rangeHtml);
    assert.match(rangeText, /\$0\.05/, `combined ${range} API-equivalent is available`);
    assert.equal(sectionProviderCardCount(rangeHtml), 1, `combined ${range} range re-render keeps one aggregate card set`);
  });

  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  ['overview', 'claude', 'codex'].forEach(tabKey => {
    sandbox.__combinedDashboardTest.setProviderTab(tabKey);
    const providers = sandbox.__combinedDashboardTest.scopeProvidersByTab(selectedProviders, tabKey);
    const scopedToday = sandbox.__combinedDashboardTest.scopeTodayByTab(model.today, tabKey);
    const scopedDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(model.details, tabKey);
    const tabHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(scopedDetails, scopedToday, providers);
    const tabText = visibleTextFromHtml(tabHtml);
    assert.equal(sectionProviderCardCount(tabHtml), 1, `${tabKey} below At-a-glance renders exactly one aggregate card set`);
    assert.match(tabHtml, /<div class="usage-api-estimate-strip[^"]*"[^>]*title="[^"]*not actual billing[^"]*"[^>]*>1M API-equivalent:/i, `${tabKey} 1M API-equivalent footer carries an estimate tooltip`);
    assert.match(tabHtml, /usage-model-distribution/, `${tabKey} live history path renders model distribution content`);
    if (tabKey === 'overview') {
      assert.match(tabText, /Claude\s+sonnet-4/, 'Overview live model distribution labels Claude models with provider attribution');
      assert.match(tabText, /Codex\s+gpt-5-codex/, 'Overview live model distribution labels Codex models with provider attribution');
    } else if (tabKey === 'claude') {
      assert.match(tabText, /sonnet-4/, 'Claude provider tab live path renders Claude model distribution');
      assert.doesNotMatch(tabText, /gpt-5-codex/, 'Claude provider tab live distribution excludes Codex models');
    } else {
      assert.match(tabText, /gpt-5-codex/, 'Codex provider tab live path renders Codex model distribution');
      assert.doesNotMatch(tabText, /sonnet-4/, 'Codex provider tab live distribution excludes Claude models');
    }

    sandbox.__combinedDashboardTest.renderDashboardForSources({
      tabKey,
      label: tabKey === 'overview' ? 'Overview' : tabKey === 'claude' ? 'Claude' : 'Codex',
      providers,
      today: scopedToday,
      details: scopedDetails
    });
    assert.equal(glanceRowCount(fakeElements.usageDashboardCards.innerHTML), providers.length, `${tabKey} At-a-glance row count matches selected providers`);
    assert.equal(sectionProviderCardCount(fakeElements.usageDetails.innerHTML), 1, `${tabKey} renderer entry keeps one below-glance aggregate set`);
    assert.match(fakeElements.usageDetails.innerHTML, /usage-model-distribution/, `${tabKey} renderer entry uses live model distribution path`);
  });

  const claudeLocalRangeModel = buildUsageDashboardModel({
    states: [],
    claudeTodayUsage: makeClaudeDay(fixtureDateKeys[1], 2000),
    claudeUsageHistory: makeClaudeHistory(),
    enabledProviders: ['claude']
  });
  sandbox.__combinedDashboardTest.setProviderTab('claude');
  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1D');
  const claudeLocalOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(claudeLocalRangeModel.details, 'claude'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(claudeLocalRangeModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(claudeLocalRangeModel.providers, 'claude')
  );
  const claudeLocalOneDayTokens = metricCardHtmlByLabel(claudeLocalOneDayHtml, '1D tokens');
  assert.match(claudeLocalOneDayTokens, /Local: /, 'Claude 1D local-only rendered token card shows Local source detail');
  assertMetricDetailNotBlank(claudeLocalOneDayTokens, 'Claude 1D local-only token card detail is not blank');
  const claudeLocalOneDayApi = firstApiEstimateStrip(claudeLocalOneDayHtml, '1D API-equivalent');
  assert.match(claudeLocalOneDayApi, /Local: \$[0-9.]+/, 'Claude 1D local-only API footer shows Local source detail');
  assert.doesNotMatch(visibleTextFromHtml(claudeLocalOneDayApi), /Claude: \$/, 'Claude 1D local-only API footer does not show provider-style detail');
  assert.doesNotMatch(visibleTextFromHtml(claudeLocalOneDayApi), /not actual billing/i, 'Claude 1D API footer does not show visible billing-note text');

  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1M');
  const claudeLocalOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(claudeLocalRangeModel.details, 'claude'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(claudeLocalRangeModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(claudeLocalRangeModel.providers, 'claude')
  );
  const claudeLocalOneMonthTokens = metricCardHtmlByLabel(claudeLocalOneMonthHtml, '1M tokens');
  assert.match(claudeLocalOneMonthTokens, /Local: /, 'Claude 1M local-only rendered token card shows Local source detail');
  assertMetricDetailNotBlank(claudeLocalOneMonthTokens, 'Claude 1M local-only token card detail is not blank');
  const claudeLocalOneMonthApi = firstApiEstimateStrip(claudeLocalOneMonthHtml, '1M API-equivalent');
  assert.match(claudeLocalOneMonthApi, /Local: \$[0-9.]+/, 'Claude 1M local-only API footer shows Local source detail');
  assert.doesNotMatch(visibleTextFromHtml(claudeLocalOneMonthApi), /Claude: \$/, 'Claude 1M local-only API footer does not show provider-style detail');

  const remoteFixture = createCanonicalUsageFixture();
  const remoteAliasModel = buildUsageDashboardModel({
    states: remoteFixture.states,
    claudeTodayUsage: remoteFixture.claudeToday,
    claudeUsageHistory: remoteFixture.claudeHistory,
    codexCorrelatedHistory: remoteFixture.codexHistory,
    codexTodayUsage: remoteFixture.codexToday,
    enabledProviders: ['claude', 'codex'],
    remoteUsage: remoteFixture.remoteProjection,
    aliasMap: { 'vm-source': 'WATCHER', workstation: 'WATCHER' }
  });

  sandbox.__combinedDashboardTest.setProviderTab('overview');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1D');
  const overviewOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'overview'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'overview'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'overview')
  );
  const overviewOneDayTokens = metricCardHtmlByLabel(overviewOneDayHtml, '1D tokens');
  assert.match(overviewOneDayTokens, /Claude: /, 'Overview 1D rendered token card remains provider-level for Claude');
  assert.match(overviewOneDayTokens, /Codex: /, 'Overview 1D rendered token card remains provider-level for Codex');
  assert.doesNotMatch(overviewOneDayTokens, /Local: /, 'Overview 1D rendered token card does not switch to source-level Local detail');
  assert.doesNotMatch(overviewOneDayTokens, /WATCHER: /, 'Overview 1D rendered token card does not switch to remote source alias detail');
  const overviewOneDayApi = firstApiEstimateStrip(overviewOneDayHtml, '1D API-equivalent');
  assert.match(overviewOneDayApi, /Claude: \$[0-9.]+<br>Codex: \$[0-9.]+/, 'Overview 1D API footer remains provider-level');
  assert.doesNotMatch(overviewOneDayApi, /Local: \$/, 'Overview 1D API footer does not switch to source-level Local detail');
  assert.doesNotMatch(overviewOneDayApi, /WATCHER: \$/, 'Overview 1D API footer does not switch to remote source alias detail');

  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  const overviewOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'overview'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'overview'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'overview')
  );
  const overviewOneMonthTokens = metricCardHtmlByLabel(overviewOneMonthHtml, '1M tokens');
  assert.match(overviewOneMonthTokens, /Claude: /, 'Overview 1M rendered token card remains provider-level for Claude');
  assert.match(overviewOneMonthTokens, /Codex: /, 'Overview 1M rendered token card remains provider-level for Codex');
  assert.doesNotMatch(overviewOneMonthTokens, /Local: /, 'Overview 1M rendered token card does not switch to source-level Local detail');
  assert.doesNotMatch(overviewOneMonthTokens, /WATCHER: /, 'Overview 1M rendered token card does not switch to remote source alias detail');
  const overviewOneMonthApi = firstApiEstimateStrip(overviewOneMonthHtml, '1M API-equivalent');
  assert.match(overviewOneMonthApi, /Claude: \$[0-9.]+<br>Codex: \$[0-9.]+/, 'Overview 1M API footer remains provider-level');
  assert.doesNotMatch(overviewOneMonthApi, /Local: \$/, 'Overview 1M API footer does not switch to source-level Local detail');
  assert.doesNotMatch(overviewOneMonthApi, /WATCHER: \$/, 'Overview 1M API footer does not switch to remote source alias detail');

  sandbox.__combinedDashboardTest.setProviderTab('claude');
  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1D');
  const claudeRemoteOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'claude'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'claude')
  );
  const claudeRemoteOneDayApi = firstApiEstimateStrip(claudeRemoteOneDayHtml, '1D API-equivalent');
  assert.match(claudeRemoteOneDayApi, /Local: \$[0-9.]+<br>WATCHER: \$[0-9.]+/, 'Claude 1D local+remote API footer shows source detail with configured alias');
  assert.doesNotMatch(claudeRemoteOneDayApi, /Snapshot: \$/, 'Claude 1D API footer does not use generic Snapshot when alias exists');
  assert.doesNotMatch(visibleTextFromHtml(claudeRemoteOneDayApi), /Claude: \$/, 'Claude 1D API footer does not show provider-style detail');

  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1M');
  const claudeRemoteOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'claude'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'claude')
  );
  const claudeRemoteOneMonthApi = firstApiEstimateStrip(claudeRemoteOneMonthHtml, '1M API-equivalent');
  assert.match(claudeRemoteOneMonthApi, /Local: \$[0-9.]+<br>WATCHER: \$[0-9.]+/, 'Claude 1M local+remote API footer shows source detail with configured alias');
  assert.doesNotMatch(claudeRemoteOneMonthApi, /Snapshot: \$/, 'Claude 1M API footer does not use generic Snapshot when alias exists');
  assert.doesNotMatch(visibleTextFromHtml(claudeRemoteOneMonthApi), /Claude: \$/, 'Claude 1M API footer does not show provider-style detail');

  sandbox.__combinedDashboardTest.setProviderTab('codex');
  sandbox.__combinedDashboardTest.setCodexHistoryRange('1D');
  const codexRemoteOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'codex'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'codex')
  );
  const codexRemoteOneDayTokens = metricCardHtmlByLabel(codexRemoteOneDayHtml, '1D tokens');
  assert.match(codexRemoteOneDayTokens, /Local: /, 'Codex 1D local+remote rendered token card shows Local source detail');
  assert.match(codexRemoteOneDayTokens, /WATCHER: /, 'Codex 1D local+remote rendered token card shows configured remote alias');
  assert.doesNotMatch(codexRemoteOneDayTokens, /Snapshot: /, 'Codex 1D rendered token card does not use generic Snapshot when alias exists');
  assert.doesNotMatch(codexRemoteOneDayTokens, /Codex: /, 'Codex 1D rendered token card does not use provider-style detail');
  assertMetricDetailNotBlank(codexRemoteOneDayTokens, 'Codex 1D local+remote token card detail is not blank');
  const codexRemoteOneDayApi = firstApiEstimateStrip(codexRemoteOneDayHtml, '1D API-equivalent');
  assert.match(codexRemoteOneDayApi, /Local: \$[0-9.]+<br>WATCHER: \$[0-9.]+/, 'Codex 1D local+remote API footer shows source detail with configured alias');
  assert.doesNotMatch(codexRemoteOneDayApi, /Snapshot: \$/, 'Codex 1D API footer does not use generic Snapshot when alias exists');
  assert.doesNotMatch(visibleTextFromHtml(codexRemoteOneDayApi), /Codex: \$/, 'Codex 1D API footer does not show provider-style detail');

  sandbox.__combinedDashboardTest.setCodexHistoryRange('1M');
  const codexRemoteOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'codex'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'codex')
  );
  const codexRemoteOneMonthTokens = metricCardHtmlByLabel(codexRemoteOneMonthHtml, '1M tokens');
  assert.match(codexRemoteOneMonthTokens, /Local: /, 'Codex 1M local+remote rendered token card shows Local source detail');
  assert.match(codexRemoteOneMonthTokens, /WATCHER: /, 'Codex 1M local+remote rendered token card shows same configured remote alias');
  assert.doesNotMatch(codexRemoteOneMonthTokens, /Snapshot: /, 'Codex 1M rendered token card does not use generic Snapshot when alias exists');
  assert.doesNotMatch(codexRemoteOneMonthTokens, /Codex: /, 'Codex 1M rendered token card does not use provider-style detail');
  assertMetricDetailNotBlank(codexRemoteOneMonthTokens, 'Codex 1M local+remote token card detail is not blank');
  const codexRemoteOneMonthApi = firstApiEstimateStrip(codexRemoteOneMonthHtml, '1M API-equivalent');
  assert.match(codexRemoteOneMonthApi, /Local: \$[0-9.]+<br>WATCHER: \$[0-9.]+/, 'Codex 1M local+remote API footer shows source detail with configured alias');
  assert.doesNotMatch(codexRemoteOneMonthApi, /Snapshot: \$/, 'Codex 1M API footer does not use generic Snapshot when alias exists');
  assert.doesNotMatch(visibleTextFromHtml(codexRemoteOneMonthApi), /Codex: \$/, 'Codex 1M API footer does not show provider-style detail');

  var claudeCardKeys = ['historyActivity', 'historyTokens', 'historyInputOutput', 'historyCache', 'historyApiEquivalent'];
  var codexCardKeys = ['codexHistoryActivity', 'codexHistoryTokens', 'codexHistoryInputOutput', 'codexHistoryCache', 'codexHistoryApiEquivalent'];
  ['1D', '1M'].forEach(function(rk) {
    var claudeCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
      sandbox.__combinedDashboardTest.usageCardsByKey(model.details.cards, claudeCardKeys), model.details.historyChart, rk);
    claudeCards.forEach(function(card) {
      if (card && card.key && card.key.indexOf('ApiEquivalent') < 0) {
        assert.ok(Array.isArray(card.detailLines), 'Claude ' + rk + ' ' + card.key + ' has source detailLines');
        assert.ok(card.detailLines.length >= 1, 'Claude ' + rk + ' ' + card.key + ' has at least one source detailLine');
        assert.match(card.detailLines[0], /^Local:/, 'Claude ' + rk + ' ' + card.key + ' first detailLine is Local source');
      }
    });
    var codexCards = sandbox.__combinedDashboardTest.selectCodexHistoryMetricCardsRange(
      sandbox.__combinedDashboardTest.usageCardsByKey(model.details.cards, codexCardKeys), model.details.codexHistoryChart, rk);
    codexCards.forEach(function(card) {
      if (card && card.key && card.key.indexOf('ApiEquivalent') < 0) {
        assert.ok(Array.isArray(card.detailLines), 'Codex ' + rk + ' ' + card.key + ' has source detailLines');
        assert.ok(card.detailLines.length >= 1, 'Codex ' + rk + ' ' + card.key + ' has at least one source detailLine');
        assert.match(card.detailLines[0], /^Local:/, 'Codex ' + rk + ' ' + card.key + ' first detailLine is Local source');
      }
    });
  });
  assert.equal(typeof sandbox.__combinedDashboardTest.computeSourceBreakdown, 'function', 'computeSourceBreakdown helper exists');
  assert.equal(typeof sandbox.__combinedDashboardTest.formatSourceBreakdownLines, 'function', 'formatSourceBreakdownLines helper exists');
  assert.equal(
    sandbox.__combinedDashboardTest.computeSourceBreakdown(undefined, []),
    undefined,
    'computeSourceBreakdown returns undefined for null chart'
  );
  assert.equal(
    sandbox.__combinedDashboardTest.formatSourceBreakdownLines(undefined, function(t) { return t; }),
    undefined,
    'formatSourceBreakdownLines returns undefined for null breakdown'
  );
  assert.deepEqual(
    sandbox.__combinedDashboardTest.formatSourceBreakdownLines(
      [{ label: 'Local', totals: { totalTokens: 100 } }, { label: 'Snapshot', totals: { totalTokens: 200 } }],
      function(t) { return String(t.totalTokens); }
    ),
    ['Local: 100', 'Snapshot: 200'],
    'formatSourceBreakdownLines returns correct multi-entry format'
  );
  assert.deepEqual(
    sandbox.__combinedDashboardTest.formatSourceBreakdownLines(
      [{ label: 'Local', totals: { totalTokens: 100 } }],
      function(t) { return String(t.totalTokens); }
    ),
    ['Local: 100'],
    'formatSourceBreakdownLines returns correct single-entry format'
  );

  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  const r2OneProviderHistoryModel = buildUsageDashboardModel({
    states: [],
    claudeUsageHistory: withoutModelStacks(makeClaudeHistory()),
    enabledProviders: ['claude', 'codex']
  });
  sandbox.__combinedDashboardTest.setProviderTab('overview');
  const r2Html = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(r2OneProviderHistoryModel.details, 'overview'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(r2OneProviderHistoryModel.today, 'overview'),
    selectedProviders
  );
  assert.equal(sectionProviderCardCount(r2Html), 1, 'R2 one-provider-history Overview renders exactly one below-glance set');
  assert.match(r2Html, /usage-section-provider-grid combined/, 'R2 one-provider-history Overview still uses the combined aggregate container');
  assert.match(r2Html, /usage-section-provider-title">Claude</, 'R2 Claude-only fallback labels the aggregate card as Claude');
  assert.doesNotMatch(visibleTextFromHtml(r2Html), /Claude \+ Codex/, 'R2 Claude-only fallback does not label single-provider history as both providers');
  assert.doesNotMatch(r2Html, /usage-history-legend/, 'R2 Claude-only fallback does not render a two-provider legend');
  assert.match(visibleTextFromHtml(r2Html), /3\.0K/, 'R2 one-provider-history Overview keeps the available history data visible');
  assert.doesNotMatch(visibleTextFromHtml(r2Html), /No Codex history data is available yet/, 'R2 one-provider-history Overview suppresses unavailable sibling provider card copy');

  const r2CodexOnlyHistoryModel = buildUsageDashboardModel({
    states: [],
    codexCorrelatedHistory: withoutModelStacks(makeCodexHistory()),
    enabledProviders: ['claude', 'codex']
  });
  const r2CodexHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(r2CodexOnlyHistoryModel.details, 'overview'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(r2CodexOnlyHistoryModel.today, 'overview'),
    selectedProviders
  );
  assert.equal(sectionProviderCardCount(r2CodexHtml), 1, 'R2 Codex-only fallback renders exactly one below-glance set');
  assert.match(r2CodexHtml, /usage-section-provider-grid combined/, 'R2 Codex-only fallback keeps the combined aggregate container');
  assert.match(r2CodexHtml, /usage-section-provider-title">Codex</, 'R2 Codex-only fallback labels the aggregate card as Codex');
  assert.doesNotMatch(visibleTextFromHtml(r2CodexHtml), /Claude \+ Codex/, 'R2 Codex-only fallback does not label single-provider history as both providers');
  assert.doesNotMatch(r2CodexHtml, /usage-history-legend/, 'R2 Codex-only fallback does not render a two-provider legend');
  assert.match(visibleTextFromHtml(r2CodexHtml), /1\.0K/, 'R2 Codex-only fallback keeps the available history data visible');
  assert.doesNotMatch(visibleTextFromHtml(r2CodexHtml), /No Claude history data is available yet/, 'R2 Codex-only fallback suppresses unavailable sibling provider card copy');

  const zeroHistoryModel = buildUsageDashboardModel({
    states: [],
    claudeUsageHistory: makeZeroClaudeHistory(),
    codexCorrelatedHistory: makeZeroCodexHistory(),
    enabledProviders: ['claude', 'codex']
  });
  assert.ok(zeroHistoryModel.details.historyChart.available, 'available zero Claude history chart remains available');
  assert.ok(zeroHistoryModel.details.codexHistoryChart.available, 'available zero Codex history chart remains available');
  assert.ok(zeroHistoryModel.details.combinedHistoryChart.available, 'available zero combined history chart remains available');
  const zeroHistoryHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    sandbox.__combinedDashboardTest.scopeDetailsByTab(zeroHistoryModel.details, 'overview'),
    sandbox.__combinedDashboardTest.scopeTodayByTab(zeroHistoryModel.today, 'overview'),
    selectedProviders
  );
  assert.equal(sectionProviderCardCount(zeroHistoryHtml), 1, 'available zero history Overview renders one aggregate set');
  assert.match(zeroHistoryHtml, /usage-history-chart/, 'available zero history renders the chart frame');
  assert.doesNotMatch(visibleTextFromHtml(zeroHistoryHtml), /History unavailable/, 'available zero history does not render the unavailable state');
  assert.match(visibleTextFromHtml(zeroHistoryHtml), /No combined model distribution is available for this range/, 'missing live model distribution renders the explicit unavailable state');

  const combinedDistributionHtml = combinedHistorySectionHtml;
  assert.match(combinedDistributionHtml, /usage-model-distribution/, 'Overview live path renders model distribution content');
  assert.match(combinedDistributionHtml, /usage-section-provider-grid combined/, 'model distribution uses the combined provider grid');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /Provider Model Tokens Share Est\. API Cost Rate \/ 1M/, 'combined model distribution renders table-like column headers');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /Claude\s+sonnet-4/, 'combined model distribution labels Claude models with provider attribution');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /Codex\s+gpt-5-codex/, 'combined model distribution labels Codex models with provider attribution');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /\$3 in \/ \$15 out/, 'known Claude model distribution row shows configured rate text');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /\$[0-9.]+/, 'known model distribution row shows estimated API-equivalent cost');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /gpt-5-codex[\s\S]*—/, 'unknown model distribution pricing renders unavailable dash');
  assert.doesNotMatch(visibleTextFromHtml(combinedDistributionHtml), /correlated/i, 'combined model distribution has no visible correlated title text');
  const combinedDistributionColors = modelDistributionSwatchColors(combinedDistributionHtml);
  const combinedBarColors = historyBarSegmentColors(combinedHtml);
  assert.ok(combinedDistributionColors.length > 6, 'combined model distribution fixture renders more than the old six-color palette');
  assert.equal(
    new Set(combinedDistributionColors).size,
    combinedDistributionColors.length,
    'combined model distribution does not repeat visible segment colors'
  );
  assert.deepEqual(
    combinedBarColors.slice(-combinedDistributionColors.length),
    combinedDistributionColors,
    'combined stacked bar colors align with combined Model Distribution palette order'
  );

  const panelSource = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanel.ts'), 'utf8');
  assert.doesNotMatch(panelSource, /promptFuel\.usage\.historyLayout/, 'workspaceState history layout key is removed');
  assert.doesNotMatch(panelSource, /workspaceState\.update\(USAGE_HISTORY_LAYOUT_STATE_KEY/, 'layout changes no longer persist to workspaceState');

  const scriptSource = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  assert.doesNotMatch(scriptSource, /command: 'setUsageHistoryLayout'/, 'webview no longer posts layout changes');
  assert.doesNotMatch(scriptSource, /data-history-layout/, 'webview has no history layout controls');
  assert.doesNotMatch(scriptSource, />Merged</, 'webview has no visible Merged button label');
  assert.doesNotMatch(scriptSource, />Separate</, 'webview has no visible Separate button label');
  assert.doesNotMatch(scriptSource, /currentHistoryLayout/, 'webview has no mutable history layout state');
  assert.doesNotMatch(scriptSource, /renderHistoryLayoutToggle/, 'webview has no history layout toggle renderer');
  assert.doesNotMatch(scriptSource, /renderUsageModelDistributionSection/, 'dead standalone model distribution renderer is removed');

  const viewSource = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanelView.ts'), 'utf8');
  assert.match(viewSource, /data-provider-tab="overview"[\s\S]*>Overview<\/button>/, 'existing Overview tab still renders');
  assert.match(viewSource, /data-provider-tab="claude"[\s\S]*>Claude<\/button>/, 'existing Claude tab still renders');
  assert.match(viewSource, /data-provider-tab="codex"[\s\S]*>Codex<\/button>/, 'existing Codex tab still renders');

  const repoSources = [
    scriptSource,
    panelSource,
    viewSource,
    fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'usageDashboardModel.ts'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(repoSources, /SourceUsageViewModel/, 'no SourceUsageViewModel source-tab machinery was added');
  assert.doesNotMatch(repoSources, /UsageDashboardTabViewModel/, 'no UsageDashboardTabViewModel source-tab machinery was added');

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  assert.doesNotMatch(styles, /usage-history-layout-toggle/, 'layout toggle styles are removed');
  assert.doesNotMatch(styles, /usage-segment/, 'layout segment styles are removed');
  assert.match(styles, /usage-history-bar-segment\.codex:not\(\.model\)[\s\S]*repeating-linear-gradient/, 'Codex fallback provider bars use hatch treatment');
  assert.doesNotMatch(styles, /usage-history-bar-segment\.codex\{[\s\S]*repeating-linear-gradient/, 'Codex model bars are not targeted by the provider hatch selector');
  assert.match(styles, /usage-history-legend-swatch\.codex[\s\S]*repeating-linear-gradient/, 'Codex legend swatch uses hatch treatment');
  assert.doesNotMatch(styles, /\.usage-glance-row\.stale > \.usage-glance-cell\{[^}]*\bborder-style:dashed/, 'stale glance cell rule does not use bare border-style which creates unwanted side borders');
  assert.match(styles, /\.usage-glance-row\.stale > \.usage-glance-cell\{[^}]*border-top-style:dashed/, 'stale glance rows target only top and bottom border sides');

  console.log('PASS: usage dashboard rendering smoke tests passed.');
}

function sectionProviderCardCount(html) {
  return (String(html || '').match(/<section class="usage-section-provider-card/g) || []).length;
}

function glanceRowCount(html) {
  return (String(html || '').match(/class="usage-glance-row/g) || []).length;
}

function glanceRowColumns(html) {
  return String(html || '')
    .split('<div class="usage-glance-row')
    .slice(1)
    .map(rowHtml => Array.from(rowHtml.matchAll(/data-glance-col="([^"]+)"/g)).map(match => match[1]));
}

function countOccurrences(text, pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function firstApiEstimateStrip(html, label) {
  const pattern = new RegExp(`<div class="usage-api-estimate-strip[^"]*"[^>]*>${label}:[\\s\\S]*?<\\/div>`);
  const match = String(html || '').match(pattern);
  assert.ok(match, `${label} API-equivalent strip exists`);
  return match[0];
}

function metricCardHtmlByLabel(html, label) {
  const cards = String(html || '').match(/<section class="usage-metric-card[\s\S]*?<\/section>/g) || [];
  const match = cards.find(card => visibleTextFromHtml(card).startsWith(label));
  assert.ok(match, `${label} metric card exists`);
  return match;
}

function assertMetricDetailNotBlank(cardHtml, message) {
  assert.doesNotMatch(String(cardHtml || ''), /<div class="usage-metric-detail"[^>]*>\s*<\/div>/, message);
}

function visibleTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function modelDistributionSwatchColors(html) {
  return Array.from(String(html || '').matchAll(/usage-model-swatch" style="background:([^"]+)"/g))
    .map(match => match[1]);
}

function historyBarSegmentColors(html) {
  return Array.from(String(html || '').matchAll(/usage-history-bar-segment[^"]*" style="[^"]*background-color:([^";]+)[^"]*"/g))
    .map(match => match[1]);
}

main();
