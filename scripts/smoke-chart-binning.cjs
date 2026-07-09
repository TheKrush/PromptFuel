#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makePoint(dateKey, totalTokens, model = 'claude-sonnet-4-20250514') {
  const inputTokens = Math.floor(totalTokens * 0.5);
  const outputTokens = Math.floor(totalTokens * 0.4);
  const cacheCreationTokens = Math.floor(totalTokens * 0.06);
  const cacheReadTokens = Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens);
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens: cacheCreationTokens + cacheReadTokens,
    cacheCreationTokens,
    cacheReadTokens,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    models: totalTokens > 0 ? [{
      label: 'Sonnet 4',
      model,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cacheReadInputTokens: cacheReadTokens,
      assistantMessages: 1
    }] : []
  };
}

function makeScopedModelPoint(dateKey, totalTokens, options = {}) {
  const inputTokens = Math.floor(totalTokens * 0.5);
  const outputTokens = Math.floor(totalTokens * 0.4);
  const cacheCreationTokens = Math.floor(totalTokens * 0.06);
  const cacheReadTokens = Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens);
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens: cacheCreationTokens + cacheReadTokens,
    cacheCreationTokens,
    cacheReadTokens,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    sourcePointCount: options.sourcePointCount,
    isEmpty: options.isEmpty,
    models: options.includeModels === false ? [] : [{
      label: options.label || options.model || 'Model',
      model: options.model || 'model',
      pricingModel: options.pricingModel,
      provider: options.provider,
      providerLabel: options.providerLabel,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cacheReadInputTokens: cacheReadTokens,
      assistantMessages: totalTokens > 0 ? 1 : 0,
      apiEquivalentCostUsd: options.apiEquivalentCostUsd ?? 0
    }]
  };
}

function makeRangeChart(providerLabel, source, allPoints, rangeViews) {
  const ranges = ['1D', '1W', '1M', '1Y', 'ALL'].map(key => ({
    key,
    label: key,
    available: Boolean(rangeViews[key]),
    active: key === '1M'
  }));
  const maxTotalTokens = allPoints.reduce((max, point) => Math.max(max, Number(point.totalTokens || 0)), 0);
  return {
    available: true,
    title: 'Token trend',
    providerLabel,
    rangeLabel: '1M / daily bins',
    points: allPoints,
    maxTotalTokens,
    source,
    ranges,
    rangeViews
  };
}

function makeClaudeHistory(days) {
  return {
    available: true,
    rangeLabel: '2026-05-01 to 2026-05-17',
    totalDays: 17,
    activeDays: days.length,
    days: days.map(point => ({
      available: point.totalTokens > 0,
      dateKey: point.dateKey,
      dateLabel: point.dateKey,
      totalTokens: point.totalTokens,
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      cacheCreationInputTokens: point.cacheCreationTokens,
      cacheReadInputTokens: point.cacheReadTokens,
      assistantMessages: point.assistantMessages,
      models: point.models.map(model => model.model),
      modelUsage: point.models.map(model => ({
        model: model.model,
        assistantMessages: model.assistantMessages,
        inputTokens: point.inputTokens,
        outputTokens: point.outputTokens,
        cacheCreationInputTokens: point.cacheCreationTokens,
        cacheReadInputTokens: point.cacheReadTokens,
        totalTokens: model.totalTokens
      })),
      filesFound: 1,
      filesInspected: 1,
      recordsRead: point.assistantMessages,
      recordsMatched: point.assistantMessages,
      fileReadErrors: 0
    })),
    assistantMessages: days.reduce((sum, point) => sum + point.assistantMessages, 0),
    inputTokens: days.reduce((sum, point) => sum + point.inputTokens, 0),
    outputTokens: days.reduce((sum, point) => sum + point.outputTokens, 0),
    cacheCreationInputTokens: days.reduce((sum, point) => sum + point.cacheCreationTokens, 0),
    cacheReadInputTokens: days.reduce((sum, point) => sum + point.cacheReadTokens, 0),
    totalTokens: days.reduce((sum, point) => sum + point.totalTokens, 0),
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: days.length,
    recordsMatched: days.length,
    fileReadErrors: 0
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));
  const webviewScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');

  const sourcePoints = [
    makePoint('2026-01-10', 70),
    makePoint('2026-04-30', 30),
    makePoint('2026-05-15', 50),
    makePoint('2026-05-17', 100)
  ];
  const model = buildUsageDashboardModel({
    states: [{ provider: 'claude', source: 'local statusLine/hook state', stale: false, lastUpdatedEpochMs: Date.now() }],
    claudeUsageHistory: makeClaudeHistory(sourcePoints),
    enabledProviders: ['claude']
  });
  assert.ok(model.details.historyChart.rangeViews, 'single-provider Claude chart includes precomputed range views');
  assert.equal(
    model.details.historyChart.ranges.find(range => range.key === '1D').available,
    true,
    '1D is available through the normal history range controls'
  );
  assert.deepEqual(
    model.details.historyChart.ranges.filter(range => range.available).map(range => range.key),
    ['1D', '1W', '1M', '1Y', 'ALL'],
    'day-level-only history charts expose 1D plus the longer ranges'
  );
  assert.equal(model.details.codexHistoryChart, undefined, 'single-provider Claude mode does not create Codex chart');

  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__usageHistoryTest = { selectClaudeHistoryChartRange: selectClaudeHistoryChartRange, selectCombinedHistoryChartRange: selectCombinedHistoryChartRange, selectClaudeModelDistributionRange: selectClaudeModelDistributionRange, selectCodexModelDistributionRange: selectCodexModelDistributionRange, selectCombinedModelDistributionRange: selectCombinedModelDistributionRange, renderHistoryChart: renderHistoryChart }; })();'
  );
  const fakeElement = {
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
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      getElementById: () => fakeElement,
      querySelector: () => fakeElement,
      querySelectorAll: () => []
    },
    window: {
      addEventListener: () => undefined
    },
    setTimeout: () => undefined
  };
  vm.runInNewContext(instrumentedScript, sandbox);
  const selectedChart = sandbox.__usageHistoryTest.selectClaudeHistoryChartRange(model.details.historyChart, '1D');
  const chartHtml = sandbox.__usageHistoryTest.renderHistoryChart(selectedChart, 'claude', '1D', selectedChart.source);
  assert.equal(selectedChart.key, '1D', '1D selection stays on the normal 1D range');
  assert.match(chartHtml, /data-usage-history-range="1D"/, 'rendered range controls include visible 1D');
  assert.match(chartHtml, /data-usage-history-range="1W"/, 'rendered range controls include 1W');
  assert.match(chartHtml, /data-usage-history-range="1M"/, 'rendered range controls include 1M');
  assert.match(chartHtml, /data-usage-history-range="1Y"/, 'rendered range controls include 1Y');
  assert.match(chartHtml, /data-usage-history-range="ALL"/, 'rendered range controls include ALL');

  const remoteDistribution = {
    available: true,
    title: 'Model distribution',
    rangeLabel: '1M / 30d',
    totalTokens: 23000,
    segments: [{
      label: 'sonnet-4',
      model: 'claude-sonnet-4-20250514',
      totalTokens: 23000,
      assistantMessages: 0,
      percent: 1,
      percentLabel: '100%'
    }],
    source: { confidence: 'snapshotOnly', label: 'Remote snapshot model distribution' }
  };
  const remoteHistoryWithoutModelStacks = {
    available: true,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    ranges: [
      { key: '1M', label: '1M', available: true, active: true }
    ],
    points: [{
      dateKey: '2026-05-19',
      label: '05-19',
      totalTokens: 23000,
      inputTokens: 12000,
      outputTokens: 8000,
      cacheTokens: 3500,
      cacheCreationTokens: 3000,
      cacheReadTokens: 500,
      assistantMessages: 0,
      models: []
    }],
    maxTotalTokens: 23000,
    source: { confidence: 'snapshotOnly', label: 'Remote snapshot history buckets' }
  };
  const selectedRemoteClaudeDistribution = sandbox.__usageHistoryTest.selectClaudeModelDistributionRange(remoteDistribution, remoteHistoryWithoutModelStacks, '1M');
  assert.equal(selectedRemoteClaudeDistribution.available, false, 'remote Claude provider distribution is unavailable when selected history buckets have no model stacks');
  assert.equal(selectedRemoteClaudeDistribution.totalTokens, 0, 'remote Claude provider distribution reports zero tokens when selected history buckets have no model stacks');
  assert.match(selectedRemoteClaudeDistribution.unavailableReason, /No Claude model distribution is available for this range/, 'remote Claude provider distribution reports the selected-range unavailable reason');
  const selectedRemoteCodexDistribution = sandbox.__usageHistoryTest.selectCodexModelDistributionRange({
    ...remoteDistribution,
    segments: [{ ...remoteDistribution.segments[0], label: 'gpt-5-5', model: 'gpt-5-5' }]
  }, remoteHistoryWithoutModelStacks, '1M');
  assert.equal(selectedRemoteCodexDistribution.available, false, 'remote Codex provider distribution is unavailable when selected history buckets have no model stacks');
  assert.equal(selectedRemoteCodexDistribution.totalTokens, 0, 'remote Codex provider distribution reports zero tokens when selected history buckets have no model stacks');
  assert.match(selectedRemoteCodexDistribution.unavailableReason, /No Codex model distribution is available for this range/, 'remote Codex provider distribution reports the selected-range unavailable reason');

  const rangeScopedSource = { confidence: 'trusted', label: 'Local trusted history' };
  const claudeOldPoint = makeScopedModelPoint('2026-05-09', 100, {
    provider: 'claude',
    providerLabel: 'Claude',
    model: 'claude-old',
    label: 'Old Claude'
  });
  const claudeWeekPoint = makeScopedModelPoint('2026-05-16', 7, {
    provider: 'claude',
    providerLabel: 'Claude',
    model: 'claude-week',
    label: 'Week Claude'
  });
  const claudeNewPoint = makeScopedModelPoint('2026-05-17', 10, {
    provider: 'claude',
    providerLabel: 'Claude',
    model: 'claude-new',
    label: 'New Claude'
  });
  const claudeRangeChart = makeRangeChart('Claude', rangeScopedSource, [claudeOldPoint, claudeWeekPoint, claudeNewPoint], {
    '1D': { rangeLabel: '1D / today (day-level)', points: [claudeNewPoint], maxTotalTokens: 10 },
    '1W': { rangeLabel: '1W / daily bins', points: [claudeWeekPoint, claudeNewPoint], maxTotalTokens: 10 },
    '1M': { rangeLabel: '1M / daily bins', points: [claudeOldPoint, claudeWeekPoint, claudeNewPoint], maxTotalTokens: 100 },
    'ALL': { rangeLabel: 'ALL / monthly bins (12M loaded)', points: [claudeOldPoint, claudeWeekPoint, claudeNewPoint], maxTotalTokens: 100 }
  });
  const claudeAllHistoryDistribution = {
    available: true,
    title: 'Model distribution',
    providerLabel: 'Claude',
    rangeLabel: 'ALL / monthly bins (12M loaded)',
    totalTokens: 117,
    segments: [
      { label: 'Old Claude', model: 'claude-old', provider: 'claude', totalTokens: 100, percent: 100 / 117, percentLabel: '85%' },
      { label: 'New Claude', model: 'claude-new', provider: 'claude', totalTokens: 10, percent: 10 / 117, percentLabel: '9%' },
      { label: 'Week Claude', model: 'claude-week', provider: 'claude', totalTokens: 7, percent: 7 / 117, percentLabel: '6%' }
    ],
    source: rangeScopedSource
  };
  const selectedClaude1DDistribution = sandbox.__usageHistoryTest.selectClaudeModelDistributionRange(claudeAllHistoryDistribution, claudeRangeChart, '1D');
  assert.ok(selectedClaude1DDistribution.available, 'Claude provider distribution stays available for a selected range with model stacks');
  assert.equal(selectedClaude1DDistribution.totalTokens, 10, 'Claude 1D distribution uses only selected-range tokens');
  assert.deepEqual(Array.from(selectedClaude1DDistribution.segments, segment => segment.model), ['claude-new'], 'Claude 1D distribution excludes older model rows outside the selected range');
  const selectedClaude1WDistribution = sandbox.__usageHistoryTest.selectClaudeModelDistributionRange(claudeAllHistoryDistribution, claudeRangeChart, '1W');
  assert.ok(selectedClaude1WDistribution.available, 'Claude provider distribution stays available for a 1W range with model stacks');
  assert.equal(selectedClaude1WDistribution.totalTokens, 17, 'Claude 1W distribution uses only selected-range tokens');
  assert.deepEqual(Array.from(selectedClaude1WDistribution.segments, segment => segment.model), ['claude-new', 'claude-week'], 'Claude 1W distribution excludes older model rows outside the selected range');

  const codexOldPoint = makeScopedModelPoint('2026-05-16', 100, {
    provider: 'codex',
    providerLabel: 'Codex',
    model: 'gpt-5.5-old',
    label: 'Old Codex'
  });
  const codexNewPoint = makeScopedModelPoint('2026-05-17', 10, {
    provider: 'codex',
    providerLabel: 'Codex',
    model: 'gpt-5.5-new',
    label: 'New Codex'
  });
  const codexRangeChart = makeRangeChart('Codex', rangeScopedSource, [codexOldPoint, codexNewPoint], {
    '1D': { rangeLabel: '1D / today (day-level)', points: [codexNewPoint], maxTotalTokens: 10 },
    '1M': { rangeLabel: '1M / daily bins', points: [codexOldPoint, codexNewPoint], maxTotalTokens: 100 },
    'ALL': { rangeLabel: 'ALL / monthly bins (12M loaded)', points: [codexOldPoint, codexNewPoint], maxTotalTokens: 100 }
  });
  const codexAllHistoryDistribution = {
    available: true,
    title: 'Model distribution',
    providerLabel: 'Codex',
    rangeLabel: 'ALL / monthly bins (12M loaded)',
    totalTokens: 110,
    segments: [
      { label: 'Old Codex', model: 'gpt-5.5-old', provider: 'codex', totalTokens: 100, percent: 100 / 110, percentLabel: '91%' },
      { label: 'New Codex', model: 'gpt-5.5-new', provider: 'codex', totalTokens: 10, percent: 10 / 110, percentLabel: '9%' }
    ],
    source: rangeScopedSource
  };
  const selectedCodex1DDistribution = sandbox.__usageHistoryTest.selectCodexModelDistributionRange(codexAllHistoryDistribution, codexRangeChart, '1D');
  assert.ok(selectedCodex1DDistribution.available, 'Codex provider distribution stays available for a selected range with model stacks');
  assert.equal(selectedCodex1DDistribution.totalTokens, 10, 'Codex 1D distribution uses only selected-range tokens');
  assert.deepEqual(Array.from(selectedCodex1DDistribution.segments, segment => segment.model), ['gpt-5.5-new'], 'Codex 1D distribution excludes older model rows outside the selected range');

  const bucketOnlySelectedPoint = makeScopedModelPoint('2026-05-17', 10, {
    provider: 'claude',
    providerLabel: 'Claude',
    includeModels: false,
    sourcePointCount: 1
  });
  const missingStacksChart = makeRangeChart('Claude', rangeScopedSource, [claudeOldPoint, bucketOnlySelectedPoint], {
    '1D': { rangeLabel: '1D / today (day-level)', points: [bucketOnlySelectedPoint], maxTotalTokens: 10 },
    '1M': { rangeLabel: '1M / daily bins', points: [claudeOldPoint, bucketOnlySelectedPoint], maxTotalTokens: 100 },
    'ALL': { rangeLabel: 'ALL / monthly bins (12M loaded)', points: [claudeOldPoint, bucketOnlySelectedPoint], maxTotalTokens: 100 }
  });
  const unavailableSelectedDistribution = sandbox.__usageHistoryTest.selectClaudeModelDistributionRange(claudeAllHistoryDistribution, missingStacksChart, '1D');
  assert.equal(unavailableSelectedDistribution.available, false, 'selected range with no model stacks does not fall back to all-history distribution');
  assert.equal(unavailableSelectedDistribution.totalTokens, 0, 'selected range with no model stacks reports zero total tokens');
  assert.match(unavailableSelectedDistribution.unavailableReason, /No Claude model distribution is available for this range/, 'selected range with no model stacks reports an unavailable reason');

  const combinedOldPoint = makeScopedModelPoint('2026-05-16', 100, {
    provider: 'claude',
    providerLabel: 'Claude',
    model: 'claude-old',
    label: 'Old Claude'
  });
  const combinedClaudeNewPoint = makeScopedModelPoint('2026-05-17', 4, {
    provider: 'claude',
    providerLabel: 'Claude',
    model: 'claude-new',
    label: 'New Claude'
  });
  const combinedCodexNewPoint = makeScopedModelPoint('2026-05-17', 6, {
    provider: 'codex',
    providerLabel: 'Codex',
    model: 'gpt-5.5-new',
    label: 'New Codex'
  });
  const combinedBaseChart = makeRangeChart('Claude + Codex', { confidence: 'mixedDayBucket', label: 'Mixed history' }, [combinedOldPoint, combinedClaudeNewPoint, combinedCodexNewPoint], {
    '1D': { rangeLabel: '1D / today (day-level)', points: [combinedClaudeNewPoint, combinedCodexNewPoint], maxTotalTokens: 6 },
    '1M': { rangeLabel: '1M / daily bins', points: [combinedOldPoint, combinedClaudeNewPoint, combinedCodexNewPoint], maxTotalTokens: 100 },
    'ALL': { rangeLabel: 'ALL / monthly bins (12M loaded)', points: [combinedOldPoint, combinedClaudeNewPoint, combinedCodexNewPoint], maxTotalTokens: 100 }
  });
  const selectedCombinedChart = sandbox.__usageHistoryTest.selectCombinedHistoryChartRange(combinedBaseChart, '1D');
  const selectedCombinedDistribution = sandbox.__usageHistoryTest.selectCombinedModelDistributionRange({ combinedHistoryChart: combinedBaseChart }, selectedCombinedChart, '1D');
  assert.ok(selectedCombinedDistribution.available, 'combined distribution remains available for selected-range model stacks');
  assert.equal(selectedCombinedDistribution.totalTokens, 10, 'combined distribution uses only selected-range tokens');
  assert.deepEqual(
    Array.from(selectedCombinedDistribution.segments, segment => segment.model),
    ['gpt-5.5-new', 'claude-new'],
    'combined distribution remains scoped to the selected range instead of all-history'
  );

  const noProviderModel = buildUsageDashboardModel({ states: [], enabledProviders: [] });
  assert.equal(noProviderModel.details.historyChart, undefined, 'no-provider model omits Claude chart');
  assert.equal(noProviderModel.details.codexHistoryChart, undefined, 'no-provider model omits Codex chart');

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  assert.match(styles, /usage-history-bars[\s\S]*display:grid/, 'history bars use bounded grid rendering');
  assert.match(styles, /grid-template-columns:repeat\(var\(--history-bin-count,30\),minmax\(0,1fr\)\)/, 'history grid is driven by bounded bin count');
  assert.match(styles, /usage-history-bars[\s\S]*overflow:hidden/, 'history chart does not rely on horizontal scrolling');
  assert.doesNotMatch(styles, /usage-history-bars[\s\S]{0,220}overflow-x:auto/, 'history bars do not use horizontal scroll');
  assert.match(styles, /usage-history-bar\.empty/, 'empty bins have dedicated faint styling');

  const panelScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  assert.match(panelScript, /chart\.ariaLabel \|\| 'Token trend chart'/, 'chart aria label uses bin-granularity metadata');
  assert.match(panelScript, /chart\.axisLabel \|\| chart\.granularityLabel/, 'axis label reflects bin granularity');
  assert.match(panelScript, /normalizeAvailableHistoryRange/, 'stale 1D selection state falls back to an available range');
  assert.match(panelScript, /filter\(function\(r\) \{ return r && r\.available; \}\)/, 'range renderer hides unavailable 1D controls');
  assert.match(panelScript, /range\.available && chart\.available && chart\.points && chart\.points\.length/, 'selection mapping preserves unavailable ranges');
  assert.match(panelScript, /role="img"/, 'chart bars expose an ARIA image role');
  assert.match(panelScript, /remoteTodayCodex/, 'Today card routing includes remoteTodayCodex prefix check');
  assert.match(panelScript, /c\.key\.indexOf\('remoteTodayCodex'\) !== 0/, 'claudeCards filter excludes remoteTodayCodex keys');
  assert.match(panelScript, /c\.key\.indexOf\('remoteTodayCodex'\) === 0/, 'codexCards filter includes remoteTodayCodex keys');

  console.log('PASS: chart binning smoke tests passed.');
}

main();
