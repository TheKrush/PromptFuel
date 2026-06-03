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
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));
  const { buildPromptFuelPanelScript } = require(path.join(repoRoot, 'out', 'panel', 'promptFuelPanelScript.js'));

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

  const webviewScript = buildPromptFuelPanelScript();
  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__layoutToggleTest = { selectCombinedHistoryChartRange: selectCombinedHistoryChartRange, selectClaudeHistoryMetricCardsRange: selectClaudeHistoryMetricCardsRange, renderHistoryChart: renderHistoryChart, renderHistoryLayoutToggle: renderHistoryLayoutToggle, renderCombinedHistoryLegend: renderCombinedHistoryLegend, renderUsageHistorySection: renderUsageHistorySection, renderUsageModelDistributionSection: renderUsageModelDistributionSection, usageCardsByKey: usageCardsByKey, setHistoryLayout: function(layout) { currentHistoryLayout = layout; }, setCombinedHistoryRange: function(range) { currentCombinedHistoryRange = range; } }; })();'
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

  const selectedCombinedChart = sandbox.__layoutToggleTest.selectCombinedHistoryChartRange(model.details.combinedHistoryChart, '1M');
  const combinedHtml = sandbox.__layoutToggleTest.renderHistoryChart(selectedCombinedChart, 'combined', '1M', selectedCombinedChart.source);
  assert.match(combinedHtml, /usage-history-bar-fill stacked/, 'combined chart renders model-stacked history bars when model attribution exists');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment claude model/, 'combined model-stacked bars do not use aggregate Claude provider classes');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment codex model/, 'combined model-stacked bars do not use aggregate Codex provider classes');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment[^"]*\b(?:claude|codex)\b[^"]*\bmodel\b/, 'combined model-stacked bars have no provider styling class on model segments');
  assert.match(combinedHtml, /background-color:var\(--vscode-charts-blue,#4f8fd6\)/, 'combined stacked bars use shared model-series colors');
  assert.match(combinedHtml, /data-history-provider="combined"/, 'combined range controls share one range state');
  assert.match(sandbox.__layoutToggleTest.renderHistoryLayoutToggle(false, 'combined'), /disabled/, 'toggle renders disabled when combined is unavailable');
  assert.match(sandbox.__layoutToggleTest.renderHistoryLayoutToggle(true, 'combined'), /aria-pressed="true">Merged/, 'merged toggle state can render active');
  assert.equal(sandbox.__layoutToggleTest.renderCombinedHistoryLegend(selectedCombinedChart), '', 'combined model-stacked bars omit redundant provider-level legend');

  const fallbackCombinedChart = {
    ...selectedCombinedChart,
    points: selectedCombinedChart.points.map(point => ({ ...point, models: [] }))
  };
  const fallbackCombinedHtml = sandbox.__layoutToggleTest.renderHistoryChart(fallbackCombinedChart, 'combined', '1M', fallbackCombinedChart.source);
  assert.match(fallbackCombinedHtml, /usage-history-bar-fill combined/, 'combined chart falls back to provider bars without model attribution');
  assert.match(fallbackCombinedHtml, /usage-history-bar-segment claude/, 'combined fallback keeps Claude provider segment color');
  assert.match(fallbackCombinedHtml, /usage-history-bar-segment codex/, 'combined fallback keeps Codex provider segment color');
  assert.match(visibleTextFromHtml(sandbox.__layoutToggleTest.renderCombinedHistoryLegend(fallbackCombinedChart)), /Claude/, 'combined fallback keeps provider legend when model stacks are unavailable');
  assert.doesNotMatch(visibleTextFromHtml(sandbox.__layoutToggleTest.renderCombinedHistoryLegend(fallbackCombinedChart)), /correlated/i, 'combined fallback legend does not show visible correlated wording');

  sandbox.__layoutToggleTest.setHistoryLayout('combined');
  const combinedHistorySectionHtml = sandbox.__layoutToggleTest.renderUsageHistorySection(model.details, []);
  assert.match(combinedHistorySectionHtml, /usage-metric-card/, 'combined history renders metric cards');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /4\.0K/, 'combined history cards show combined displayed token totals including cache');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /Claude 3\.0K · Codex 1\.0K/, 'combined history cards show provider displayed-token attribution');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /\$0\.05/, 'combined history API-equivalent uses per-model selected-range pricing');
  assert.match(visibleTextFromHtml(combinedHistorySectionHtml), /Claude \$0\.05 .* Codex \$0\.01/, 'combined history API-equivalent shows provider cost attribution');
  assert.doesNotMatch(visibleTextFromHtml(combinedHistorySectionHtml), /correlated/i, 'combined history has no visible correlated chart label text');
  ['1W', '1M', '1Y', 'ALL'].forEach(range => {
    sandbox.__layoutToggleTest.setCombinedHistoryRange(range);
    const rangeHtml = sandbox.__layoutToggleTest.renderUsageHistorySection(model.details, []);
    const rangeText = visibleTextFromHtml(rangeHtml);
    assert.match(rangeText, /\$0\.05/, `combined ${range} API-equivalent is available`);
  });

  const combinedDistributionHtml = sandbox.__layoutToggleTest.renderUsageModelDistributionSection(model.details);
  assert.match(combinedDistributionHtml, /usage-model-distribution/, 'combined view renders model distribution content');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /Claude · sonnet-4/, 'combined model distribution labels Claude models with provider attribution');
  assert.match(visibleTextFromHtml(combinedDistributionHtml), /Codex · gpt-5-codex/, 'combined model distribution labels Codex models with provider attribution');
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

  sandbox.__layoutToggleTest.setHistoryLayout('split');
  const selectedSplitClaudeChart = sandbox.__layoutToggleTest.selectCombinedHistoryChartRange(model.details.historyChart, '1M');
  const splitClaudeChartHtml = sandbox.__layoutToggleTest.renderHistoryChart(selectedSplitClaudeChart, 'claude', '1M', selectedSplitClaudeChart.source);
  assert.match(splitClaudeChartHtml, /usage-history-bar-fill stacked/, 'split Claude chart renders model-stacked bars when model attribution exists');
  assert.doesNotMatch(splitClaudeChartHtml, /usage-history-bar-segment codex/, 'split Claude stacked bars do not add Codex provider hatch');
  const splitClaudeCards = sandbox.__layoutToggleTest.selectClaudeHistoryMetricCardsRange(
    sandbox.__layoutToggleTest.usageCardsByKey(model.details.cards, ['historyRange', 'historyTokens', 'historyActivity', 'historyCache']),
    model.details.historyChart,
    '1M'
  );
  const splitHistorySectionHtml = sandbox.__layoutToggleTest.renderUsageHistorySection(model.details, splitClaudeCards);
  assert.match(splitHistorySectionHtml, /usage-section-provider-title">Claude</, 'split view renders Claude provider card');
  assert.match(splitHistorySectionHtml, /usage-section-provider-title">Codex</, 'split view renders Codex provider card');
  assert.match(splitHistorySectionHtml, /usage-metric-card/, 'split view still renders provider-specific metric cards');
  const splitDistributionHtml = sandbox.__layoutToggleTest.renderUsageModelDistributionSection(model.details);
  assert.deepEqual(
    historyBarSegmentColors(splitClaudeChartHtml).slice(-3),
    modelDistributionSwatchColors(splitDistributionHtml).slice(0, 3),
    'split stacked bar colors align with split Model Distribution palette order'
  );

  const panelSource = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanel.ts'), 'utf8');
  assert.match(panelSource, /promptFuel\.usage\.historyLayout/, 'workspaceState key is present');
  assert.match(panelSource, /workspaceState\.update\(USAGE_HISTORY_LAYOUT_STATE_KEY/, 'layout changes persist to workspaceState');
  assert.match(panelSource, /usageWorkspaceState\?\.get<string>\(USAGE_HISTORY_LAYOUT_STATE_KEY\)/, 'layout reads from workspaceState');

  const scriptSource = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanelScript.ts'), 'utf8');
  assert.match(scriptSource, /command: 'setUsageHistoryLayout'/, 'webview posts layout changes');
  assert.match(scriptSource, /currentHistoryLayout = 'combined'/, 'Combined is the webview default');

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  assert.match(styles, /usage-history-bar-segment\.codex:not\(\.model\)[\s\S]*repeating-linear-gradient/, 'Codex fallback provider bars use hatch treatment');
  assert.doesNotMatch(styles, /usage-history-bar-segment\.codex\{[\s\S]*repeating-linear-gradient/, 'Codex model bars are not targeted by the provider hatch selector');
  assert.match(styles, /usage-history-legend-swatch\.codex[\s\S]*repeating-linear-gradient/, 'Codex legend swatch uses hatch treatment');

  console.log('PASS: usage dashboard layout toggle smoke tests passed.');
}

function visibleTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
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
