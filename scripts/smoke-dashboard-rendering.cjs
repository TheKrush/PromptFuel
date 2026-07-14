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
    'globalThis.__combinedDashboardTest = { selectCombinedHistoryChartRange: selectCombinedHistoryChartRange, selectCombinedHistoryMetricCardsRange: selectCombinedHistoryMetricCardsRange, renderHistoryChart: renderHistoryChart, renderCombinedHistoryLegend: renderCombinedHistoryLegend, renderUsageHistorySection: renderUsageHistorySection, renderUsageMetricCard: renderUsageMetricCard, renderApiEstimateStrip: renderApiEstimateStrip, renderDashboardForSources: renderDashboardForSources, renderGlanceList: renderGlanceList, renderGlanceWindowCells: renderGlanceWindowCells, renderQuotaIssuesSection: renderQuotaIssuesSection, quotaIssuesForProviders: quotaIssuesForProviders, dashboardAggregateProviders: dashboardAggregateProviders, scopeProvidersByTab: scopeProvidersByTab, scopeTodayByTab: scopeTodayByTab, scopeDetailsByTab: scopeDetailsByTab, setCombinedHistoryRange: function(range) { currentCombinedHistoryRange = range; }, setClaudeHistoryRange: function(range) { currentClaudeHistoryRange = range; }, setCodexHistoryRange: function(range) { currentCodexHistoryRange = range; }, setProviderTab: function(tab) { currentUsageProviderTab = tab; }, computeSourceBreakdown: computeSourceBreakdown, formatSourceBreakdownLines: formatSourceBreakdownLines, selectClaudeHistoryMetricCardsRange: selectClaudeHistoryMetricCardsRange, selectCodexHistoryMetricCardsRange: selectCodexHistoryMetricCardsRange, usageCardsByKey: usageCardsByKey }; })();'
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
  assert.match(sandbox.__combinedDashboardTest.renderCombinedHistoryLegend(fallbackCombinedChart), /usage-history-legend/, 'combined fallback renders a provider legend when model stacks are unavailable');

  const selectedProviders = [
    { provider: 'claude', label: 'Claude', windows: [] },
    { provider: 'codex', label: 'Codex', windows: [] }
  ];
  const claudeHistoryCardKeys = ['historyActivity', 'historyTokens', 'historyInputOutput', 'historyCache', 'historyApiEquivalent'];
  const codexHistoryCardKeys = ['codexHistoryActivity', 'codexHistoryTokens', 'codexHistoryInputOutput', 'codexHistoryCache', 'codexHistoryApiEquivalent'];
  const glanceHtml = sandbox.__combinedDashboardTest.renderGlanceList([
    {
      provider: 'claude',
      label: 'Claude',
      windows: [
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 84, resetIso: '2026-06-04T12:00:00.000Z', health: 'missing' },
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
  const expectedGlanceColumns = ['provider', '7d-label', '7d-bar', '7d-percent', '7d-reset', '5h-label', '5h-bar', '5h-percent', '5h-reset'];
  assert.equal(glanceRowCount(glanceHtml), 2, 'At-a-glance fixture renders one row per provider/source');
  assert.deepEqual(glanceRowColumns(glanceHtml)[0], expectedGlanceColumns, 'At-a-glance rows render the shared window structure without a status column');
  assert.deepEqual(glanceRowColumns(glanceHtml)[1], expectedGlanceColumns, 'At-a-glance rows keep the window structure when a window is missing');
  assert.match(glanceHtml, /usage-glance-col-7d-bar/, 'At-a-glance markup includes stable 7d bar column class');
  assert.match(glanceHtml, /usage-glance-col-5h-reset/, 'At-a-glance markup includes stable 5h reset column class');
  assert.match(glanceHtml, /data-glance-col="7d-bar"[^>]*>[\s\S]*?usage-progress/, 'progress bar markup stays inside the 7d bar cell');
  assert.match(glanceHtml, /data-glance-col="5h-bar"[^>]*>[\s\S]*?usage-progress/, 'progress bar markup stays inside the 5h bar cell');
  assert.doesNotMatch(glanceHtml, /data-glance-col="status"|usage-glance-badge/, 'At-a-glance omits the redundant provider-status column');
  assert.doesNotMatch(glanceHtml, /usage-glance-row[^>]*\b(?:degraded|warning|missing|stale)\b/, 'provider rows never inherit child-window health classes');
  assert.doesNotMatch(glanceHtml, /source-chip quota-health|>Missing<|>Stale<|>current<|>partial</i, 'At-a-glance rows contain only measurements, never health or provider-status presentation');
  assert.match(glanceHtml, /data-glance-col="7d-label">7d<\/span>/, '7d label cell contains only the fixed window label');
  assert.match(glanceHtml, /data-glance-col="5h-label">5h<\/span>/, '5h label cell contains only the fixed window label');
  assert.match(glanceHtml, /data-glance-col="5h-percent">84%<\/span>/, 'window percentage remains free of an appended marker');
  const cachedWindowHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(
    { key: 'fiveHour', label: '5h', available: true, remainingPercent: 84, freshness: 'cached' },
    '5h'
  );
  const staleWindowHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(
    { key: 'sevenDay', label: '7d', available: true, remainingPercent: 42, health: 'stale' },
    '7d'
  );
  const liveWindowHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(
    { key: 'sevenDay', label: '7d', available: true, remainingPercent: 42, freshness: 'live' },
    '7d'
  );
  const missingSevenDayHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(undefined, '7d');
  const missingFiveHourHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(undefined, '5h');
  assert.match(missingSevenDayHtml, /data-glance-col="7d-label">7d<\/span>/, 'missing 7d object retains the fixed label');
  assert.match(missingFiveHourHtml, /data-glance-col="5h-label">5h<\/span>/, 'missing 5h object retains the fixed label');
  assert.doesNotMatch(missingSevenDayHtml + missingFiveHourHtml, /source-chip quota-health|tabindex=|aria-label=/, 'missing windows remain ordinary, non-focusable measurement cells');
  assert.doesNotMatch(cachedWindowHtml, /quota-health/, 'fresh cached windows render no health chip');
  assert.match(cachedWindowHtml, /data-glance-col="5h-label">5h<\/span>/, 'cached window label cell remains label-only');
  assert.match(cachedWindowHtml, /data-glance-col="5h-percent">84%<\/span>/, 'cached percentage has no marker');
  assert.doesNotMatch(cachedWindowHtml, /Cached quota value|freshness|provenance/i, 'fresh cached windows expose no provenance health treatment');
  assert.doesNotMatch(staleWindowHtml, /source-chip quota-health|tabindex=|aria-label=/, 'stale windows remain ordinary, non-focusable measurement cells');
  assert.match(staleWindowHtml, /data-glance-col="7d-label">7d<\/span>/, 'stale window label cell remains label-only');
  assert.match(staleWindowHtml, /data-glance-col="7d-percent">42%<\/span>/, 'stale percentage has no marker');
  assert.doesNotMatch(liveWindowHtml, /quota-health|tabindex=|aria-label=/, 'live windows remain normal and non-focusable');
  assert.doesNotMatch(cachedWindowHtml + staleWindowHtml + liveWindowHtml, />[!CS⚠▲△]<|%[!CS⚠▲△]/, 'window labels and values contain no state glyphs or letters');

  const healthyIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection([{
    provider: 'codex', label: 'Codex', windows: [
      { key: 'sevenDay', label: '7d', available: true, remainingPercent: 42, freshness: 'cached' },
      { key: 'fiveHour', label: '5h', available: true, remainingPercent: 84 }
    ]
  }]);
  assert.equal(healthyIssuesHtml, '', 'healthy visible windows render no Quota issues heading, container, or spacing');
  const freshCarriedStaleModel = buildUsageDashboardModel({
    states: [{
      provider: 'claude',
      stale: true,
      lastUpdatedEpochMs: Date.now(),
      sevenDay: { usedPercentage: 20, sourceUpdatedEpochMs: Date.now() - 60_000 },
      fiveHour: { usedPercentage: 35, sourceUpdatedEpochMs: Date.now() - 60_000 }
    }]
  });
  assert.equal(
    sandbox.__combinedDashboardTest.renderQuotaIssuesSection(freshCarriedStaleModel.providers),
    '',
    'fresh per-window timestamps suppress stale issues carried at provider level'
  );
  const timestampLessModel = buildUsageDashboardModel({
    states: [{
      provider: 'claude',
      stale: false,
      lastUpdatedEpochMs: Date.now(),
      sevenDay: { usedPercentage: 20, sourceUpdatedEpochMs: Date.now() - 60_000 },
      fiveHour: { usedPercentage: 35 }
    }]
  });
  const timestampLessIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection(timestampLessModel.providers);
  assert.match(timestampLessIssuesHtml, /Claude[\s\S]*5h[\s\S]*>Stale<[\s\S]*Quota value is stale\./, 'a timestamp-less numeric window renders one Stale issue with no fabricated age');
  assert.doesNotMatch(timestampLessIssuesHtml, /Last updated/, 'timestamp-less issue details do not borrow provider-level update time');
  assert.doesNotMatch(
    sandbox.__combinedDashboardTest.renderGlanceList(timestampLessModel.providers),
    /source-chip quota-health|>Stale<|tabindex=|aria-label=/,
    'timestamp-less health remains outside the At-a-glance measurement grid'
  );
  const missingIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection([{
    provider: 'codex', label: 'Codex', windows: [
      { key: 'sevenDay', label: '7d', available: true, remainingPercent: 34 },
      { key: 'fiveHour', label: '5h', available: false, health: 'missing', healthDetail: 'Live quota unavailable.' }
    ]
  }]);
  assert.match(missingIssuesHtml, /Quota issues[\s\S]*Codex[\s\S]*5h[\s\S]*>Missing<[\s\S]*Live quota unavailable\./, 'one missing window renders one concise, accessible issue row');
  assert.match(missingIssuesHtml, /class="quota-issue-state missing">Missing<\//, 'one missing window renders a plain Missing state cell');
  assert.doesNotMatch(missingIssuesHtml, /source-chip|tabindex=|aria-label=/, 'Quota issues state text is neither a chip nor a focus target');

  const provenanceModel = buildUsageDashboardModel({
    states: [{
      provider: 'codex',
      sourceKind: 'localSession',
      source: 'local Codex session snapshot',
      stale: false,
      lastUpdatedEpochMs: Date.now(),
      fiveHour: {
        usedPercentage: 30,
        resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
        sourceKind: 'localSession',
        sourceUpdatedEpochMs: Date.now() - 60_000
      },
      sevenDay: {
        usedPercentage: 0,
        resetsAtEpochSeconds: Math.floor(Date.now() / 1000) + 86_400,
        sourceKind: 'authenticated',
        sourceUpdatedEpochMs: Date.now()
      },
      authenticatedWindows: {
        fiveHour: { observation: 'malformed', availability: 'cached', lastLiveEpochMs: Date.now() - 60_000 },
        sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: Date.now() }
      }
    }],
    enabledProviders: ['codex']
  });
  const provenanceProvider = provenanceModel.providers[0];
  const provenanceFiveHour = provenanceProvider.windows.find(window => window.key === 'fiveHour');
  const provenanceSevenDay = provenanceProvider.windows.find(window => window.key === 'sevenDay');
  assert.ok(provenanceFiveHour, 'provenance fixture keeps the retained local-session 5h window in the dashboard model');
  assert.ok(provenanceSevenDay, 'provenance fixture keeps the independent live authenticated 7d window in the dashboard model');
  assert.equal(provenanceFiveHour.available, true, 'retained local-session 5h value remains numerically available');
  assert.equal(provenanceFiveHour.remainingPercent, 70, 'retained local-session 5h value keeps its numeric percentage');
  assert.equal(provenanceFiveHour.freshness, undefined, 'retained local-session 5h value has no authenticated freshness');
  assert.equal(provenanceFiveHour.warning, undefined, 'retained local-session 5h value has no authenticated warning');
  assert.equal(provenanceSevenDay.remainingPercent, 100, 'live authenticated 7d value remains independently available');
  assert.equal(provenanceSevenDay.freshness, 'live', 'live authenticated 7d value remains independently live');
  assert.equal(provenanceSevenDay.warning, undefined, 'live authenticated 7d value remains unmarked');

  const provenanceFiveHourHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(provenanceFiveHour, '5h');
  const provenanceSevenDayHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(provenanceSevenDay, '7d');
  const provenanceRowHtml = sandbox.__combinedDashboardTest.renderGlanceList(provenanceModel.providers);
  assert.match(provenanceFiveHourHtml, /70%/, 'real glance-window renderer keeps the retained local-session 5h numeric value visible');
  assert.doesNotMatch(provenanceFiveHourHtml, /quota-health/, 'real glance-window renderer does not mark retained local-session 5h');
  assert.doesNotMatch(provenanceFiveHourHtml, /Cached value|Stale cached value|live window/i, 'retained local-session 5h emits no cached or failed-live accessible/title wording');
  assert.match(provenanceSevenDayHtml, /100%/, 'real glance-window renderer keeps the independent live authenticated 7d numeric value visible');
  assert.doesNotMatch(provenanceSevenDayHtml, /quota-health/, 'real glance-window renderer leaves live authenticated 7d normal');
  assert.doesNotMatch(provenanceRowHtml, /Cached value|Stale cached value|live window/i, 'real glance-row renderer does not attach authenticated fallback wording to the retained local-session value');

  ['localSession', 'statusLine', 'hook'].forEach(function(sourceKind) {
    const sourceModel = buildUsageDashboardModel({
      states: [{
        provider: 'codex',
        sourceKind: sourceKind,
        source: sourceKind + ' fixture',
        stale: false,
        sevenDay: { usedPercentage: 20, sourceKind: sourceKind },
        fiveHour: { usedPercentage: 40, sourceKind: sourceKind }
      }],
      enabledProviders: ['codex']
    });
    const sourceHtml = sandbox.__combinedDashboardTest.renderGlanceList(sourceModel.providers);
    assert.doesNotMatch(sourceHtml, /quota-health/, sourceKind + ' provenance does not create a health chip');
  });

  const freshSnapshotHtml = sandbox.__combinedDashboardTest.renderGlanceList([{
    provider: 'codex',
    label: 'Codex WATCHER',
    machineLabel: 'WATCHER',
    windows: [
      { key: 'sevenDay', label: '7d', available: true, remainingPercent: 55 },
      { key: 'fiveHour', label: '5h', available: true, remainingPercent: 80 }
    ]
  }]);
  assert.doesNotMatch(freshSnapshotHtml, /quota-health|snapshot|imported/i, 'fresh imported values render without a health chip or provenance marker');
  assert.equal(sandbox.__combinedDashboardTest.renderQuotaIssuesSection([{
    provider: 'codex', label: 'Codex WATCHER', machineLabel: 'WATCHER', windows: [
      { key: 'sevenDay', label: '7d', available: true, remainingPercent: 55 },
      { key: 'fiveHour', label: '5h', available: true, remainingPercent: 80, freshness: 'cached' }
    ]
  }]), '', 'fresh imported or cached values create no issue section');

  const partialModel = buildUsageDashboardModel({
    states: [{
      provider: 'codex',
      source: 'live authenticated refresh',
      stale: true,
      authenticatedStatus: 'success',
      sevenDay: { usedPercentage: 66, sourceKind: 'authenticated' },
      authenticatedWindows: {
        sevenDay: { observation: 'valid', availability: 'cached', lastLiveEpochMs: Date.now() },
        fiveHour: { observation: 'absent', availability: 'unavailable' }
      }
    }],
    enabledProviders: ['codex']
  });
  const partialProvider = partialModel.providers[0];
  const partialHtml = sandbox.__combinedDashboardTest.renderGlanceList(partialModel.providers);
  assert.equal(partialProvider.stale, false, 'one live authenticated window prevents provider-wide stale presentation');
  assert.equal(partialProvider.status, 'partial', 'live plus unavailable sibling uses partial provider status');
  assert.equal(partialProvider.windows.find(window => window.key === 'sevenDay').freshness, 'live', 'valid authenticated success normalizes 7d presentation to live');
  const missingLocalFiveHour = partialProvider.windows.find(window => window.key === 'fiveHour');
  assert.equal(missingLocalFiveHour.available, false, 'missing local 5h remains unavailable in the dashboard model');
  assert.equal(missingLocalFiveHour.remainingPercent, undefined, 'missing local 5h has no synthetic percentage');
  assert.equal(missingLocalFiveHour.level, undefined, 'missing local 5h has no quota color level');
  assert.equal(missingLocalFiveHour.resetIso, undefined, 'missing local 5h has no fabricated reset timestamp');
  assert.doesNotMatch(partialHtml, /data-glance-col="status"|>partial<|>stale<|>current</, 'provider status words are omitted');
  assert.match(partialHtml, /data-glance-col="7d-percent">34%<\/span>/, 'live 7d value has no cached or stale marker');
  assert.match(partialHtml, /data-glance-col="5h-percent">\u2014<\/span>/, 'missing local 5h renders an em dash rather than a synthetic percentage');
  assert.match(partialHtml, /data-glance-col="5h-bar"[^>]*>[\s\S]*?usage-progress-fill" style="width:0%"/, 'missing local 5h renders an empty neutral progress bar');
  assert.doesNotMatch(partialHtml, /data-glance-col="5h-percent">100%<\/span>/, 'missing local 5h has no synthetic percentage');
  assert.match(partialHtml, /data-glance-col="5h-reset"><\/span>/, 'missing 5h has no reset countdown or health decoration');
  assert.doesNotMatch(partialHtml, /source-chip quota-health|tabindex=|aria-label=/, 'At-a-glance does not retain health-only focus targets');
  const missingSnapshotFiveHourHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(
    { key: 'fiveHour', label: '5h', available: false },
    '5h'
  );
  const missingLocalFiveHourHtml = sandbox.__combinedDashboardTest.renderGlanceWindowCells(missingLocalFiveHour, '5h');
  assert.doesNotMatch(missingLocalFiveHourHtml, /level-(?:purple|blue|green|yellow|orange|red)/, 'missing local 5h has no colored fill');
  assert.equal(missingLocalFiveHourHtml, missingSnapshotFiveHourHtml, 'missing local and snapshot 5h windows share the same presentation');
  const overviewPartialIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection(
    sandbox.__combinedDashboardTest.scopeProvidersByTab(partialModel.providers, 'overview')
  );
  const providerPartialIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection(
    sandbox.__combinedDashboardTest.scopeProvidersByTab(partialModel.providers, 'codex')
  );
  assert.match(overviewPartialIssuesHtml, /quota-issue-state missing">Missing<[\s\S]*Live quota unavailable\./, 'Overview places the missing-window issue below the measurement grid');
  assert.match(providerPartialIssuesHtml, /quota-issue-state missing">Missing</, 'Codex tab keeps its own missing issue');
  const glanceStaleHtml = sandbox.__combinedDashboardTest.renderGlanceList([
    {
      provider: 'claude',
      label: 'Claude',
      windows: [
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 30, resetIso: '2026-06-05T12:00:00.000Z', health: 'stale' },
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
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 55, health: 'stale' },
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 80, health: 'stale' }
      ]
    }
  ]);
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[0], expectedGlanceColumns, 'stale Claude row keeps the window slot structure');
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[1], expectedGlanceColumns, 'Codex current row keeps the window slot structure alongside a stale row');
  assert.deepEqual(glanceRowColumns(glanceStaleHtml)[2], expectedGlanceColumns, 'Codex imported row keeps the window slot structure');
  assert.doesNotMatch(glanceStaleHtml, /source-chip quota-health|>Stale</, 'stale windows do not decorate At-a-glance rows');
  const staleIssuesHtml = sandbox.__combinedDashboardTest.renderQuotaIssuesSection([
    {
      provider: 'claude', label: 'Claude', windows: [
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 30, health: 'stale', healthDetail: 'Last updated 5d ago.' },
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 60 }
      ]
    },
    {
      provider: 'codex', label: 'Codex WATCHER', windows: [
        { key: 'sevenDay', label: '7d', available: true, remainingPercent: 55, health: 'stale', healthDetail: 'Last updated 5d ago.' },
        { key: 'fiveHour', label: '5h', available: true, remainingPercent: 80, health: 'stale', healthDetail: 'Last updated 5d ago.' }
      ]
    }
  ]);
  assert.equal((staleIssuesHtml.match(/quota-issue-state stale/g) || []).length, 3, 'stale windows create one independent plain Stale state each');
  assert.match(staleIssuesHtml, /Codex WATCHER[\s\S]*7d[\s\S]*>Stale<[\s\S]*Codex WATCHER[\s\S]*5h[\s\S]*>Stale</, 'stale rows retain provider order and seven-day before five-hour ordering');
  assert.doesNotMatch(staleIssuesHtml, /source-chip|tabindex=|aria-label=/, 'Stale issue states stay plain visible text without chip behavior');
  assert.doesNotMatch(staleIssuesHtml, /snapshot|imported|cached|remote/i, 'stale issue details never expose provenance');
  const claudeScopedIssues = sandbox.__combinedDashboardTest.renderQuotaIssuesSection(
    sandbox.__combinedDashboardTest.scopeProvidersByTab([
      { provider: 'claude', label: 'Claude', windows: [{ key: 'sevenDay', label: '7d', health: 'stale', healthDetail: 'Quota value is stale.' }] },
      { provider: 'codex', label: 'Codex', windows: [{ key: 'fiveHour', label: '5h', health: 'missing', healthDetail: 'Live quota unavailable.' }] }
    ], 'claude')
  );
  assert.match(claudeScopedIssues, /Claude[\s\S]*Stale/, 'Claude tab includes its scoped issue');
  assert.doesNotMatch(claudeScopedIssues, /Codex|Missing/, 'Claude tab does not leak Codex issues');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  const combinedHistorySectionHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
  const combinedOneMonthCards = sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(undefined, selectedCombinedChart, '1M');
  const combinedOneMonthTokens = metricCardByKey(combinedOneMonthCards, 'combinedHistoryTokens');
  const combinedOneMonthApi = metricCardByKey(combinedOneMonthCards, 'combinedHistoryApiEquivalent');
  const overviewTodayMessages = metricCardByKey(model.today.overviewCards, 'overviewTodayMessages');
  assert.match(combinedHistorySectionHtml, /usage-metric-card/, 'combined history renders metric cards');
  assert.match(combinedHistorySectionHtml, /usage-section-provider-grid combined/, 'dashboard history uses the combined provider grid');
  assert.equal(sectionProviderCardCount(combinedHistorySectionHtml), 1, 'Overview below At-a-glance renders exactly one aggregate card set');
  assert.match(combinedHistorySectionHtml, /usage-today-inline/, 'history section renders the Today card section');
  assertDetailLineLabels(overviewTodayMessages, ['Claude', 'Codex'], 'Today overview card carries provider breakdown detailLines');
  assert.doesNotMatch(combinedHistorySectionHtml, /data-history-layout/, 'combined history section has no layout toggle controls');
  assert.doesNotMatch(combinedHistorySectionHtml, />Merged</, 'combined history section has no Merged button');
  assert.doesNotMatch(combinedHistorySectionHtml, />Separate</, 'combined history section has no Separate button');
  assert.doesNotMatch(combinedHistorySectionHtml, /usage-section-provider-title">Claude</, 'combined history does not require a separate Claude comparison card');
  assert.doesNotMatch(combinedHistorySectionHtml, /usage-section-provider-title">Codex</, 'combined history does not require a separate Codex comparison card');
  assert.equal(combinedOneMonthTokens.value, '4.0K', 'combined history cards show combined displayed token totals including cache');
  assertDetailLineLabels(combinedOneMonthTokens, ['Claude', 'Codex'], 'combined history card carries provider token attribution');
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
  assert.match(oneProviderCacheHtml, /usage-metric-card/, 'combined history cache fixture renders metric cards');
  assert.equal(oneProviderCacheCard.detail, 'Claude 300 · Codex 0', 'combined history cache fallback detail is the old provider attribution');
  assert.equal(oneProviderCacheCard.detailLines, undefined, 'combined history cache does not force detailLines when only one provider contributes');
  assert.equal(combinedOneMonthApi.available, true, 'combined history API-equivalent uses per-model selected-range pricing');
  assert.ok(combinedOneMonthApi.value.startsWith('$'), 'combined history API-equivalent has a computed value');
  assertDetailLineLabels(combinedOneMonthApi, ['Claude', 'Codex'], 'combined history API-equivalent carries provider cost attribution');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1D');
  const combinedOneDayHistorySectionHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
  const selectedCombinedOneDayChart = sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(model.details.combinedHistoryChart, '1D');
  const combinedOneDayApiCard = metricCardByKey(
    sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(undefined, selectedCombinedOneDayChart, '1D'),
    'combinedHistoryApiEquivalent'
  );
  const oneDayApiHtml = firstApiEstimateStrip(combinedOneDayHistorySectionHtml, '1D API-equivalent');
  const oneMonthApiHtml = firstApiEstimateStrip(combinedHistorySectionHtml, '1M API-equivalent');
  assert.equal(combinedOneDayApiCard.available, true, 'Overview 1D API-equivalent is available through range cards');
  assert.equal(combinedOneDayApiCard.detailLines.length, 2, 'Overview 1D API-equivalent carries one source line per provider');
  assert.match(oneDayApiHtml, /usage-api-estimate-strip/, 'Overview 1D API-equivalent footer renders structurally');
  assert.match(oneMonthApiHtml, /usage-api-estimate-strip/, 'Overview 1M API-equivalent footer renders structurally');
  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
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
  assert.match(escapedApiHtml, /data-usage-tip-id="usage-tip-\d+"/, 'API-equivalent tooltip uses the custom tooltip payload lane');
  assert.match(escapedApiHtml, /aria-label="1D API-equivalent: Estimated &lt;combined&gt; &quot;cost&quot;; not actual billing"/, 'API-equivalent tooltip note is escaped as an ARIA fallback');
  assert.doesNotMatch(escapedApiHtml, /title="/, 'API-equivalent tooltip does not rely on native title placement');
  assert.match(escapedApiHtml, /Claude: &lt;b&gt;\$57\.34&lt;\/b&gt;<br>Codex: \$114 &amp; fees/, 'API-equivalent detailLines are escaped and br-joined');
  assert.doesNotMatch(visibleTextFromHtml(escapedApiHtml), /Claude \$57\.34 \| Codex \$114/, 'API-equivalent detailLines suppress fallback detail text');

  assert.equal(combinedOneMonthTokens.detailLines.some(line => line.includes('stale')), false, 'stale context remains outside per-line breakdown data');

  const partialApiModel = buildUsageDashboardModel({
    states: [],
    claudeUsageHistory: makeClaudeHistory(),
    codexCorrelatedHistory: withoutModelStacks(makeCodexHistory()),
    enabledProviders: ['claude', 'codex']
  });
  const partialCombinedChart = sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(partialApiModel.details.combinedHistoryChart, '1M');
  const partialCombinedApiCard = metricCardByKey(
    sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(undefined, partialCombinedChart, '1M'),
    'combinedHistoryApiEquivalent'
  );
  assert.equal(partialCombinedApiCard.available, false, 'partial provider API-equivalent does not expose a partial combined value');
  assert.equal(partialCombinedApiCard.detailLines, undefined, 'partial provider API-equivalent does not emit provider dollar detailLines');
  sandbox.__combinedDashboardTest.setProviderTab('codex');
  sandbox.__combinedDashboardTest.setCodexHistoryRange('1M');
  const partialCodexDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(partialApiModel.details, 'codex');
  const partialCodexHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    partialCodexDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(partialApiModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(partialApiModel.providers, 'codex')
  );
  const partialCodexCards = sandbox.__combinedDashboardTest.selectCodexHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(partialCodexDetails.cards, codexHistoryCardKeys),
    partialCodexDetails.codexHistoryChart,
    '1M'
  );
  const partialCodexApiHtml = firstApiEstimateStrip(partialCodexHtml, '1M API-equivalent');
  assert.match(partialCodexApiHtml, /usage-api-estimate-strip/, 'provider API footer renders structurally');
  assert.equal(metricCardByKey(partialCodexCards, 'codexHistoryApiEquivalent').available, false, 'provider API footer stays unavailable when source model data is incomplete');
  sandbox.__combinedDashboardTest.setProviderTab('overview');
  ['1W', '1M', '1Y', 'ALL'].forEach(range => {
    sandbox.__combinedDashboardTest.setCombinedHistoryRange(range);
    const rangeHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(model.details, model.today, selectedProviders);
    const rangeChart = sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(model.details.combinedHistoryChart, range);
    const rangeApiCard = metricCardByKey(
      sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(undefined, rangeChart, range),
      'combinedHistoryApiEquivalent'
    );
    assert.equal(rangeApiCard.available, true, `combined ${range} API-equivalent is available`);
    assert.equal(sectionProviderCardCount(rangeHtml), 1, `combined ${range} range re-render keeps one aggregate card set`);
  });

  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  ['overview', 'claude', 'codex'].forEach(tabKey => {
    sandbox.__combinedDashboardTest.setProviderTab(tabKey);
    const providers = sandbox.__combinedDashboardTest.scopeProvidersByTab(selectedProviders, tabKey);
    const scopedToday = sandbox.__combinedDashboardTest.scopeTodayByTab(model.today, tabKey);
    const scopedDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(model.details, tabKey);
    const tabHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(scopedDetails, scopedToday, providers);
    assert.equal(sectionProviderCardCount(tabHtml), 1, `${tabKey} below At-a-glance renders exactly one aggregate card set`);
    assert.match(tabHtml, /usage-api-estimate-strip/, `${tabKey} 1M API-equivalent footer renders structurally`);
    assert.match(tabHtml, /usage-model-distribution/, `${tabKey} live history path renders model distribution content`);
    if (tabKey === 'overview') {
      assert.ok(scopedDetails.modelDistribution?.segments.some(segment => segment.provider === 'claude'), 'Overview model distribution includes Claude segments');
      assert.ok(scopedDetails.codexModelDistribution?.segments.some(segment => segment.provider === 'codex'), 'Overview model distribution includes Codex segments');
    } else if (tabKey === 'claude') {
      assert.ok(scopedDetails.modelDistribution?.segments.every(segment => segment.provider === 'claude'), 'Claude provider tab distribution excludes Codex models');
      assert.equal(scopedDetails.codexModelDistribution, undefined, 'Claude provider tab omits Codex distribution data');
    } else {
      assert.ok(scopedDetails.codexModelDistribution?.segments.every(segment => segment.provider === 'codex'), 'Codex provider tab distribution excludes Claude models');
      assert.equal(scopedDetails.modelDistribution, undefined, 'Codex provider tab omits Claude distribution data');
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
  const claudeLocalOneDayDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(claudeLocalRangeModel.details, 'claude');
  const claudeLocalOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    claudeLocalOneDayDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(claudeLocalRangeModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(claudeLocalRangeModel.providers, 'claude')
  );
  const claudeLocalOneDayCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(claudeLocalOneDayDetails.cards, claudeHistoryCardKeys),
    claudeLocalOneDayDetails.historyChart,
    '1D'
  );
  assertDetailLineLabels(metricCardByKey(claudeLocalOneDayCards, 'historyTokens'), ['Local'], 'Claude 1D local-only token card has source detailLines');
  const claudeLocalOneDayApi = firstApiEstimateStrip(claudeLocalOneDayHtml, '1D API-equivalent');
  assert.match(claudeLocalOneDayApi, /usage-api-estimate-strip/, 'Claude 1D local-only API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(claudeLocalOneDayCards, 'historyApiEquivalent'), ['Local'], 'Claude 1D local-only API card has source detailLines');

  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1M');
  const claudeLocalOneMonthDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(claudeLocalRangeModel.details, 'claude');
  const claudeLocalOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    claudeLocalOneMonthDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(claudeLocalRangeModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(claudeLocalRangeModel.providers, 'claude')
  );
  const claudeLocalOneMonthCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(claudeLocalOneMonthDetails.cards, claudeHistoryCardKeys),
    claudeLocalOneMonthDetails.historyChart,
    '1M'
  );
  assertDetailLineLabels(metricCardByKey(claudeLocalOneMonthCards, 'historyTokens'), ['Local'], 'Claude 1M local-only token card has source detailLines');
  const claudeLocalOneMonthApi = firstApiEstimateStrip(claudeLocalOneMonthHtml, '1M API-equivalent');
  assert.match(claudeLocalOneMonthApi, /usage-api-estimate-strip/, 'Claude 1M local-only API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(claudeLocalOneMonthCards, 'historyApiEquivalent'), ['Local'], 'Claude 1M local-only API card has source detailLines');

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
  const overviewOneDayDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'overview');
  const overviewOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    overviewOneDayDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'overview'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'overview')
  );
  const overviewOneDayCards = sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(
    undefined,
    sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(overviewOneDayDetails.combinedHistoryChart, '1D'),
    '1D'
  );
  assertDetailLineLabels(metricCardByKey(overviewOneDayCards, 'combinedHistoryTokens'), ['Claude', 'Codex'], 'Overview 1D token card remains provider-level');
  const overviewOneDayApi = firstApiEstimateStrip(overviewOneDayHtml, '1D API-equivalent');
  assert.match(overviewOneDayApi, /usage-api-estimate-strip/, 'Overview 1D API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(overviewOneDayCards, 'combinedHistoryApiEquivalent'), ['Claude', 'Codex'], 'Overview 1D API footer remains provider-level');

  sandbox.__combinedDashboardTest.setCombinedHistoryRange('1M');
  const overviewOneMonthDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'overview');
  const overviewOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    overviewOneMonthDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'overview'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'overview')
  );
  const overviewOneMonthCards = sandbox.__combinedDashboardTest.selectCombinedHistoryMetricCardsRange(
    undefined,
    sandbox.__combinedDashboardTest.selectCombinedHistoryChartRange(overviewOneMonthDetails.combinedHistoryChart, '1M'),
    '1M'
  );
  assertDetailLineLabels(metricCardByKey(overviewOneMonthCards, 'combinedHistoryTokens'), ['Claude', 'Codex'], 'Overview 1M token card remains provider-level');
  const overviewOneMonthApi = firstApiEstimateStrip(overviewOneMonthHtml, '1M API-equivalent');
  assert.match(overviewOneMonthApi, /usage-api-estimate-strip/, 'Overview 1M API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(overviewOneMonthCards, 'combinedHistoryApiEquivalent'), ['Claude', 'Codex'], 'Overview 1M API footer remains provider-level');

  sandbox.__combinedDashboardTest.setProviderTab('claude');
  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1D');
  const claudeRemoteOneDayDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'claude');
  const claudeRemoteOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    claudeRemoteOneDayDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'claude')
  );
  const claudeRemoteOneDayCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(claudeRemoteOneDayDetails.cards, claudeHistoryCardKeys),
    claudeRemoteOneDayDetails.historyChart,
    '1D'
  );
  const claudeRemoteOneDayApi = firstApiEstimateStrip(claudeRemoteOneDayHtml, '1D API-equivalent');
  assert.match(claudeRemoteOneDayApi, /usage-api-estimate-strip/, 'Claude 1D local+remote API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(claudeRemoteOneDayCards, 'historyApiEquivalent'), ['Local', 'WATCHER'], 'Claude 1D API card uses source labels with configured alias');

  sandbox.__combinedDashboardTest.setClaudeHistoryRange('1M');
  const claudeRemoteOneMonthDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'claude');
  const claudeRemoteOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    claudeRemoteOneMonthDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'claude'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'claude')
  );
  const claudeRemoteOneMonthCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(claudeRemoteOneMonthDetails.cards, claudeHistoryCardKeys),
    claudeRemoteOneMonthDetails.historyChart,
    '1M'
  );
  const claudeRemoteOneMonthApi = firstApiEstimateStrip(claudeRemoteOneMonthHtml, '1M API-equivalent');
  assert.match(claudeRemoteOneMonthApi, /usage-api-estimate-strip/, 'Claude 1M local+remote API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(claudeRemoteOneMonthCards, 'historyApiEquivalent'), ['Local', 'WATCHER'], 'Claude 1M API card uses source labels with configured alias');

  sandbox.__combinedDashboardTest.setProviderTab('codex');
  sandbox.__combinedDashboardTest.setCodexHistoryRange('1D');
  const codexRemoteOneDayDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'codex');
  const codexRemoteOneDayHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    codexRemoteOneDayDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'codex')
  );
  const codexRemoteOneDayCards = sandbox.__combinedDashboardTest.selectCodexHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(codexRemoteOneDayDetails.cards, codexHistoryCardKeys),
    codexRemoteOneDayDetails.codexHistoryChart,
    '1D'
  );
  assertDetailLineLabels(metricCardByKey(codexRemoteOneDayCards, 'codexHistoryTokens'), ['Local', 'WATCHER'], 'Codex 1D token card uses source labels with configured alias');
  const codexRemoteOneDayApi = firstApiEstimateStrip(codexRemoteOneDayHtml, '1D API-equivalent');
  assert.match(codexRemoteOneDayApi, /usage-api-estimate-strip/, 'Codex 1D local+remote API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(codexRemoteOneDayCards, 'codexHistoryApiEquivalent'), ['Local', 'WATCHER'], 'Codex 1D API card uses source labels with configured alias');

  sandbox.__combinedDashboardTest.setCodexHistoryRange('1M');
  const codexRemoteOneMonthDetails = sandbox.__combinedDashboardTest.scopeDetailsByTab(remoteAliasModel.details, 'codex');
  const codexRemoteOneMonthHtml = sandbox.__combinedDashboardTest.renderUsageHistorySection(
    codexRemoteOneMonthDetails,
    sandbox.__combinedDashboardTest.scopeTodayByTab(remoteAliasModel.today, 'codex'),
    sandbox.__combinedDashboardTest.scopeProvidersByTab(remoteAliasModel.providers, 'codex')
  );
  const codexRemoteOneMonthCards = sandbox.__combinedDashboardTest.selectCodexHistoryMetricCardsRange(
    sandbox.__combinedDashboardTest.usageCardsByKey(codexRemoteOneMonthDetails.cards, codexHistoryCardKeys),
    codexRemoteOneMonthDetails.codexHistoryChart,
    '1M'
  );
  assertDetailLineLabels(metricCardByKey(codexRemoteOneMonthCards, 'codexHistoryTokens'), ['Local', 'WATCHER'], 'Codex 1M token card uses source labels with configured alias');
  const codexRemoteOneMonthApi = firstApiEstimateStrip(codexRemoteOneMonthHtml, '1M API-equivalent');
  assert.match(codexRemoteOneMonthApi, /usage-api-estimate-strip/, 'Codex 1M local+remote API footer renders structurally');
  assertDetailLineLabels(metricCardByKey(codexRemoteOneMonthCards, 'codexHistoryApiEquivalent'), ['Local', 'WATCHER'], 'Codex 1M API card uses source labels with configured alias');

  var claudeCardKeys = claudeHistoryCardKeys;
  var codexCardKeys = codexHistoryCardKeys;
  ['1D', '1M'].forEach(function(rk) {
    var claudeCards = sandbox.__combinedDashboardTest.selectClaudeHistoryMetricCardsRange(
      sandbox.__combinedDashboardTest.usageCardsByKey(model.details.cards, claudeCardKeys), model.details.historyChart, rk);
    claudeCards.forEach(function(card) {
      if (card && card.key && card.key.indexOf('ApiEquivalent') < 0) {
        assert.ok(Array.isArray(card.detailLines), 'Claude ' + rk + ' ' + card.key + ' has source detailLines');
        assert.ok(card.detailLines.length >= 1, 'Claude ' + rk + ' ' + card.key + ' has at least one source detailLine');
        assert.equal(String(card.detailLines[0]).split(':')[0], 'Local', 'Claude ' + rk + ' ' + card.key + ' first detailLine is Local source');
      }
    });
    var codexCards = sandbox.__combinedDashboardTest.selectCodexHistoryMetricCardsRange(
      sandbox.__combinedDashboardTest.usageCardsByKey(model.details.cards, codexCardKeys), model.details.codexHistoryChart, rk);
    codexCards.forEach(function(card) {
      if (card && card.key && card.key.indexOf('ApiEquivalent') < 0) {
        assert.ok(Array.isArray(card.detailLines), 'Codex ' + rk + ' ' + card.key + ' has source detailLines');
        assert.ok(card.detailLines.length >= 1, 'Codex ' + rk + ' ' + card.key + ' has at least one source detailLine');
        assert.equal(String(card.detailLines[0]).split(':')[0], 'Local', 'Codex ' + rk + ' ' + card.key + ' first detailLine is Local source');
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
  assert.doesNotMatch(r2Html, /usage-history-legend/, 'R2 Claude-only fallback does not render a two-provider legend');
  assert.equal(r2OneProviderHistoryModel.details.historyChart.available, true, 'R2 one-provider-history keeps available Claude history data');
  assert.equal(r2OneProviderHistoryModel.details.historyChart.points.reduce((sum, point) => sum + point.totalTokens, 0), 3000);
  assert.equal(r2OneProviderHistoryModel.details.combinedHistoryChart, undefined, 'R2 Claude-only fallback does not build a two-provider chart');

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
  assert.doesNotMatch(r2CodexHtml, /usage-history-legend/, 'R2 Codex-only fallback does not render a two-provider legend');
  assert.equal(r2CodexOnlyHistoryModel.details.codexHistoryChart.available, true, 'R2 Codex-only fallback keeps available Codex history data');
  assert.equal(r2CodexOnlyHistoryModel.details.codexHistoryChart.points.reduce((sum, point) => sum + point.totalTokens, 0), 1000);
  assert.equal(r2CodexOnlyHistoryModel.details.combinedHistoryChart, undefined, 'R2 Codex-only fallback does not build a two-provider chart');

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
  assert.equal(zeroHistoryModel.details.modelDistribution.available, false, 'zero Claude history has no model distribution');
  assert.equal(zeroHistoryModel.details.codexModelDistribution.available, false, 'zero Codex history has no model distribution');

  const combinedDistributionHtml = combinedHistorySectionHtml;
  assert.match(combinedDistributionHtml, /usage-model-distribution/, 'Overview live path renders model distribution content');
  assert.match(combinedDistributionHtml, /usage-section-provider-grid combined/, 'model distribution uses the combined provider grid');
  const claudeDistributionSegment = model.details.modelDistribution.segments.find(segment => segment.provider === 'claude');
  const codexDistributionSegment = model.details.codexModelDistribution.segments.find(segment => segment.provider === 'codex');
  assert.ok(claudeDistributionSegment, 'model distribution includes Claude segment data');
  assert.ok(codexDistributionSegment, 'model distribution includes Codex segment data');
  assert.equal(claudeDistributionSegment.providerLabel, 'Claude');
  assert.equal(codexDistributionSegment.providerLabel, 'Codex');
  assert.equal(claudeDistributionSegment.inputRatePerMillionUsd, 3, 'known Claude model distribution segment carries configured input rate');
  assert.equal(claudeDistributionSegment.outputRatePerMillionUsd, 15, 'known Claude model distribution segment carries configured output rate');
  assert.equal(typeof claudeDistributionSegment.apiEquivalentCostUsd, 'number', 'known Claude model distribution segment carries estimated API-equivalent cost');
  assert.equal(codexDistributionSegment.apiEquivalentCostUsd, undefined, 'unknown Codex model distribution pricing is unavailable as data');
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
  assert.doesNotMatch(styles, /\.usage-glance-row\.stale|\.usage-glance-badge|\.usage-glance-window\.(?:degraded|warning|freshness|missing|stale)/, 'provider-wide and full-window health styles are removed');
  assert.doesNotMatch(styles, /\.source-chip\.quota-health/, 'Quota issues remove the obsolete health-chip CSS');
  assert.match(styles, /\.quota-issue-state\{[^}]*text-align:left[^}]*white-space:nowrap/, 'Quota issue state remains compact, left-aligned text');
  assert.match(styles, /\.quota-issue-state\.missing\{[^}]*inputValidation-error/, 'Missing state uses a subtle theme-aware text color');
  assert.match(styles, /\.quota-issue-state\.stale\{[^}]*inputValidation-warning/, 'Stale state uses a subtle theme-aware text color');
  assert.doesNotMatch(styles, /\.quota-issue-state(?:\.missing|\.stale)?\{[^}]*(?:border|background|border-radius|padding)/, 'Quota issue state text has no chip border, fill, radius, or padding');
  assert.doesNotMatch(styles, /\.quota-issue-state[^\{]*:focus/, 'Quota issue state has no chip-specific focus styling');
  assert.match(styles, /\.source-chip\{[^}]*padding:[^}]*border-radius:[^}]*border:/, 'shared source-chip styling remains available to other dashboard surfaces');
  assert.match(scriptSource, /source-chip ' \+ cfg\.cls[\s\S]*tabindex="0"/, 'other dashboard source chips retain their interactive markup');
  assert.match(styles, /\.usage-glance-win-label\{[^}]*white-space:nowrap[^}]*overflow:hidden/, 'fixed quota-label cells contain their non-wrapping labels');
  assert.match(styles, /\.usage-glance-list\{[^}]*grid-template-columns:minmax\(80px,160px\) 22px/, 'At-a-glance restores one shared aligned measurement grid');
  assert.match(styles, /\.usage-glance-row\{[^}]*display:contents/, 'provider rows participate in the shared aligned grid without wrapper columns');
  assert.doesNotMatch(styles, /usage-glance-reset-text|usage-glance-window/, 'At-a-glance has no chip-placement wrapper or reset-text styling');
  assert.match(styles, /\.quota-issue-row\{[^}]*grid-template-columns:[^}]*minmax\(0,1fr\)/, 'Quota issues reserve the flexible column for wrapping details');
  assert.match(styles, /\.quota-issue-details\{[^}]*overflow-wrap:anywhere/, 'Quota issue details wrap safely at narrow widths');

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

function firstApiEstimateStrip(html, label) {
  const pattern = /<div class="usage-api-estimate-strip[^"]*"[^>]*>[\s\S]*?<\/div>/;
  const match = String(html || '').match(pattern);
  assert.ok(match, `${label} API estimate strip exists`);
  return match[0];
}

function metricCardByKey(cards, key) {
  const card = (cards || []).find(item => item.key === key);
  assert.ok(card, `${key} metric card exists`);
  return card;
}

function assertDetailLineLabels(card, labels, message) {
  const actual = (card.detailLines || []).map(line => String(line).split(':')[0]);
  assert.equal(actual.length, labels.length, message);
  labels.forEach((label, index) => {
    assert.equal(actual[index], label, message);
  });
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
