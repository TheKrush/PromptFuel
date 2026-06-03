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
    false,
    '1D is hidden from day-level-only history chart range controls'
  );
  assert.deepEqual(
    model.details.historyChart.ranges.filter(range => range.available).map(range => range.key),
    ['1W', '1M', '1Y', 'ALL'],
    'day-level-only history charts expose only useful non-1D ranges'
  );
  assert.equal(model.details.codexHistoryChart, undefined, 'single-provider Claude mode does not create Codex chart');

  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__usageHistoryTest = { selectClaudeHistoryChartRange: selectClaudeHistoryChartRange, selectClaudeModelDistributionRange: selectClaudeModelDistributionRange, selectCodexModelDistributionRange: selectCodexModelDistributionRange, renderHistoryChart: renderHistoryChart }; })();'
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
  assert.equal(selectedChart.key, '1M', 'stale 1D selection falls back to 1M');
  assert.doesNotMatch(chartHtml, /data-usage-history-range="1D"/, 'rendered range controls do not include visible 1D');
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
  assert.ok(selectedRemoteClaudeDistribution.available, 'remote bucket-model distribution remains available when history buckets have no model stacks');
  assert.equal(selectedRemoteClaudeDistribution.segments[0].model, 'claude-sonnet-4-20250514', 'remote bucket-model segment is preserved');
  const selectedRemoteCodexDistribution = sandbox.__usageHistoryTest.selectCodexModelDistributionRange({
    ...remoteDistribution,
    segments: [{ ...remoteDistribution.segments[0], label: 'gpt-5-5', model: 'gpt-5-5' }]
  }, remoteHistoryWithoutModelStacks, '1M');
  assert.ok(selectedRemoteCodexDistribution.available, 'remote Codex bucket-model distribution remains available when history buckets have no model stacks');
  assert.equal(selectedRemoteCodexDistribution.segments[0].model, 'gpt-5-5', 'remote Codex bucket-model segment is preserved');

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
