#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const webviewScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__chartTooltipTest = { renderHistoryChart: renderHistoryChart, renderClaudeModelDistribution: renderClaudeModelDistribution, resetHistoryTooltipPayloads: resetHistoryTooltipPayloads, getPayloads: function() { return historyTooltipPayloads; }, positionHistoryTooltipSource: String(positionHistoryTooltip), bindHistoryTooltipControlsSource: String(bindHistoryTooltipControls), closestHistoryTooltipTargetSource: String(closestHistoryTooltipTarget), renderHistoryTooltipContentSource: String(renderHistoryTooltipContent) }; })();'
  );
  const fakeElement = {
    value: '',
    className: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    firstChild: null,
    style: {},
    addEventListener: () => undefined,
    appendChild: () => undefined,
    removeChild: () => undefined,
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    classList: {
      add: () => undefined,
      remove: () => undefined
    }
  };
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      body: { appendChild: () => undefined },
      documentElement: { clientWidth: 320, clientHeight: 240 },
      createElement: () => ({ ...fakeElement }),
      getElementById: () => fakeElement,
      querySelector: () => fakeElement,
      querySelectorAll: () => []
    },
    window: {
      innerWidth: 320,
      innerHeight: 240,
      addEventListener: () => undefined
    },
    setTimeout: () => undefined
  };
  vm.runInNewContext(instrumentedScript, sandbox);

  const combinedChart = {
    available: true,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    ranges: [{ key: '1M', label: '1M', available: true, active: true }],
    maxTotalTokens: 3000,
    source: { confidence: 'mixedDayBucket', label: 'Mixed Claude trusted and Codex correlated history' },
    points: [{
      dateKey: '2026-05-17',
      label: 'May 17',
      totalTokens: 3000,
      inputTokens: 1600,
      outputTokens: 1400,
      cacheTokens: 120,
      cacheCreationTokens: 70,
      cacheReadTokens: 50,
      assistantMessages: 5,
      sourcePointCount: 2,
      models: [
        { label: 'Claude - Sonnet 4', model: 'claude-sonnet-4-20250514', totalTokens: 2000, assistantMessages: 3 },
        { label: '<img src=x onerror=alert(1)>Codex', model: 'gpt-5-codex', totalTokens: 1000, assistantMessages: 2 }
      ],
      providerSegments: [
        { provider: 'claude', label: 'Claude', totalTokens: 2000, inputTokens: 1000, outputTokens: 1000, cacheTokens: 80, cacheCreationTokens: 50, cacheReadTokens: 30, assistantMessages: 3 },
        { provider: 'codex', label: 'Codex', totalTokens: 1000, inputTokens: 600, outputTokens: 400, cacheTokens: 40, cacheCreationTokens: 20, cacheReadTokens: 20, assistantMessages: 2 }
      ]
    }]
  };

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const combinedHtml = sandbox.__chartTooltipTest.renderHistoryChart(combinedChart, 'combined', '1M', combinedChart.source);
  assert.match(combinedHtml, /data-history-tip-id="history-tip-1"/, 'history bars carry a bespoke tooltip payload id');
  assert.match(combinedHtml, /tabindex="0"/, 'history bars are keyboard focusable');
  assert.match(combinedHtml, /aria-label="/, 'history bars keep an ARIA fallback');
  assert.doesNotMatch(combinedHtml, /usage-history-bar[^>]*title="/, 'history bars do not rely on native title tooltip UX');
  assert.doesNotMatch(combinedHtml, /<img src=x onerror=alert\(1\)>/, 'unsafe model text is not emitted as raw HTML');
  assert.match(combinedHtml, /&lt;img src=x onerror=alert\(1\)&gt;Codex/, 'unsafe model text is escaped in ARIA fallback');

  const payloads = sandbox.__chartTooltipTest.getPayloads();
  const payload = payloads['history-tip-1'];
  assert.equal(payload.provider, 'combined', 'payload records combined mode');
  assert.equal(payload.binLabel, '2026-05-17', 'payload includes a date/bin header');
  assert.equal(payload.totalTokens, 3000, 'payload includes total tokens');
  assert.equal(payload.activity, 5, 'payload includes message/turn count');
  assert.equal(payload.sourceText, 'Claude trusted usage + Codex correlated usage', 'combined payload uses safe provider trust wording');
  assert.deepEqual(payload.providerRows.map(row => row.label), ['Claude', 'Codex'], 'combined payload includes provider attribution');
  assert.deepEqual(payload.providerRows.map(row => row.tokens), [2000, 1000], 'combined payload includes provider token totals');
  assert.equal(payload.showProviderSwatches, false, 'combined model-stacked tooltip omits provider swatches while preserving provider totals');
  assert.equal(payload.topModels.length, 2, 'payload includes top models');
  assert.equal(payload.topModels[0].color, 'var(--vscode-charts-blue,#4f8fd6)', 'top model swatch uses shared model-series palette');
  assert.equal(payload.topModels[1].color, 'var(--vscode-charts-yellow,#c79538)', 'second model swatch uses shared model-series palette');
  assert.match(combinedHtml, /usage-history-bar-fill stacked/, 'model-attributed combined bins render stacked fills');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment claude model/, 'combined stacked fills do not use aggregate Claude provider classes');
  assert.doesNotMatch(combinedHtml, /usage-history-bar-segment codex model/, 'combined stacked fills do not use aggregate Codex provider classes');
  assert.match(payload.topModels[0].label, /^Claude/, 'combined tooltip model labels keep provider attribution');
  assert.match(payload.topModels[1].label, /Codex$/, 'combined tooltip model labels keep Codex attribution');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const fallbackCombinedChart = {
    ...combinedChart,
    points: [{
      ...combinedChart.points[0],
      models: []
    }]
  };
  sandbox.__chartTooltipTest.renderHistoryChart(fallbackCombinedChart, 'combined', '1M', fallbackCombinedChart.source);
  const fallbackPayload = sandbox.__chartTooltipTest.getPayloads()['history-tip-1'];
  assert.equal(fallbackPayload.showProviderSwatches, true, 'combined provider-bar fallback keeps provider swatches');
  assert.deepEqual(fallbackPayload.providerRows.map(row => row.label), ['Claude', 'Codex'], 'combined provider-bar fallback keeps provider totals');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const unattributedChart = {
    available: true,
    title: 'Token trend',
    rangeLabel: '1W / daily bins',
    ranges: [{ key: '1W', label: '1W', available: true, active: true }],
    maxTotalTokens: 1200,
    source: { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' },
    points: [{
      dateKey: '2026-05-18',
      label: 'May 18',
      totalTokens: 1200,
      inputTokens: 700,
      outputTokens: 500,
      cacheTokens: 40,
      cacheCreationTokens: 20,
      cacheReadTokens: 20,
      assistantMessages: 2,
      sourcePointCount: 1,
      models: []
    }]
  };
  const unattributedHtml = sandbox.__chartTooltipTest.renderHistoryChart(unattributedChart, 'claude', '1W', unattributedChart.source);
  assert.match(unattributedHtml, /class="usage-history-bar-fill" style="height:100%"/, 'unattributed bins fall back to the existing total bar fill');
  assert.doesNotMatch(unattributedHtml, /usage-history-bar-fill stacked/, 'unattributed bins do not render empty stacked wrappers');

  const partialAttributionChart = {
    ...unattributedChart,
    points: [{
      ...unattributedChart.points[0],
      models: [{ label: 'Sonnet 4', model: 'claude-sonnet-4-20250514', totalTokens: 600, assistantMessages: 1 }]
    }]
  };
  const partialAttributionHtml = sandbox.__chartTooltipTest.renderHistoryChart(partialAttributionChart, 'claude', '1W', partialAttributionChart.source);
  assert.match(partialAttributionHtml, /class="usage-history-bar-fill" style="height:100%"/, 'partial model attribution falls back to total bar height');
  assert.doesNotMatch(partialAttributionHtml, /usage-history-bar-fill stacked/, 'partial model attribution does not render misleading partial stacks');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const splitDistribution = {
    available: true,
    title: 'Model distribution',
    providerLabel: 'Claude',
    rangeLabel: '1M / 30d',
    totalTokens: 3000,
    source: { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' },
    segments: [
      { label: 'Sonnet 4', model: 'claude-sonnet-4-20250514', totalTokens: 2400, assistantMessages: 6, percent: 0.8, percentLabel: '80%' },
      { label: '<img src=x onerror=alert(1)>Model', model: '<img src=x onerror=alert(1)>raw', totalTokens: 600, assistantMessages: 2, percent: 0.2, percentLabel: '20%' }
    ]
  };
  const splitDistributionHtml = sandbox.__chartTooltipTest.renderClaudeModelDistribution(splitDistribution, splitDistribution.source);
  assert.match(splitDistributionHtml, /class="usage-model-donut"[^>]*>/, 'split model donut renders without a native wrapper title');
  assert.doesNotMatch(splitDistributionHtml, /class="usage-model-donut"[^>]*title="/, 'model donut wrapper does not rely on native title tooltip UX');
  assert.match(splitDistributionHtml, /class="usage-model-donut-segment"[^>]*data-model-tip-id="model-tip-1"/, 'donut segments carry bespoke model tooltip payload ids');
  assert.match(splitDistributionHtml, /class="usage-model-donut-segment"[^>]*tabindex="0"/, 'donut segments are keyboard focusable');
  assert.match(splitDistributionHtml, /class="usage-model-row"[^>]*data-model-tip-id="model-tip-3"/, 'legend rows carry bespoke model tooltip payload ids');
  assert.match(splitDistributionHtml, /class="usage-model-row"[^>]*tabindex="0"/, 'legend rows are keyboard focusable');
  assert.match(splitDistributionHtml, /aria-label="/, 'model distribution targets keep ARIA fallback labels');
  assert.doesNotMatch(splitDistributionHtml, /<title>/, 'model donut SVG segments do not rely on SVG title tooltip UX');
  assert.doesNotMatch(splitDistributionHtml, /usage-model-row[^>]*title="/, 'model legend rows do not rely on native title tooltip UX');
  assert.doesNotMatch(splitDistributionHtml, /usage-model-name[^>]*title="/, 'model legend labels do not rely on native title tooltip UX');
  assert.doesNotMatch(splitDistributionHtml, /<img src=x onerror=alert\(1\)>/, 'unsafe model distribution text is not emitted as raw HTML');
  assert.match(splitDistributionHtml, /&lt;img src=x onerror=alert\(1\)&gt;Model/, 'unsafe model distribution text is escaped in visible fallback');

  const splitPayloads = sandbox.__chartTooltipTest.getPayloads();
  const splitDonutPayload = splitPayloads['model-tip-1'];
  const splitLegendPayload = splitPayloads['model-tip-3'];
  assert.equal(splitDonutPayload.kind, 'modelDistribution', 'model donut payload is routed through the bespoke tooltip renderer');
  assert.equal(splitDonutPayload.providerLabel, 'Claude', 'split payload includes provider attribution');
  assert.equal(splitDonutPayload.label, 'Sonnet 4', 'split payload includes model label');
  assert.equal(splitDonutPayload.totalTokens, 2400, 'split payload includes token total');
  assert.equal(splitDonutPayload.percentLabel, '80%', 'split payload includes share');
  assert.equal(splitDonutPayload.activity, 6, 'split payload includes activity count');
  assert.equal(splitDonutPayload.activityLabel, 'Assistant messages', 'split payload labels Claude activity as assistant messages');
  assert.equal(splitDonutPayload.color, 'var(--vscode-charts-blue,#4f8fd6)', 'split payload uses matching model-series swatch color');
  assert.equal(splitLegendPayload.color, splitDonutPayload.color, 'legend payload color matches the donut color for the same segment');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const combinedDistribution = {
    available: true,
    title: 'Model distribution',
    rangeLabel: '1W / daily bins',
    totalTokens: 4000,
    source: { confidence: 'mixedDayBucket', label: 'Mixed Claude trusted and Codex correlated history' },
    segments: [
      { label: 'Claude - Sonnet 4', model: 'Claude - claude-sonnet-4-20250514', totalTokens: 2500, assistantMessages: 5, percent: 0.625, percentLabel: '63%' },
      { label: 'Codex - gpt-5-codex', model: 'Codex - gpt-5-codex', totalTokens: 1500, assistantMessages: 3, percent: 0.375, percentLabel: '38%' }
    ]
  };
  const combinedDistributionHtml = sandbox.__chartTooltipTest.renderClaudeModelDistribution(combinedDistribution, combinedDistribution.source);
  assert.match(combinedDistributionHtml, /data-model-tip-id="model-tip-1"/, 'combined model donut uses bespoke tooltip payload ids');
  assert.match(combinedDistributionHtml, /data-model-tip-id="model-tip-4"/, 'combined model legend uses bespoke tooltip payload ids');
  assert.doesNotMatch(combinedDistributionHtml, /<title>/, 'combined model donut SVG avoids SVG title tooltip UX');
  assert.doesNotMatch(combinedDistributionHtml, /usage-model-row[^>]*title="/, 'combined model legend avoids native title tooltip UX');
  const combinedPayloads = sandbox.__chartTooltipTest.getPayloads();
  assert.equal(combinedPayloads['model-tip-1'].providerLabel, 'Claude', 'combined payload infers Claude provider attribution');
  assert.equal(combinedPayloads['model-tip-2'].providerLabel, 'Codex', 'combined payload infers Codex provider attribution');
  assert.equal(combinedPayloads['model-tip-2'].activityLabel, 'Correlated turns', 'combined Codex payload labels activity as correlated turns');

  const positionSource = sandbox.__chartTooltipTest.positionHistoryTooltipSource;
  assert.match(positionSource, /getBoundingClientRect/, 'tooltip positions from bar geometry');
  assert.match(positionSource, /anchorRect\.left \+ \(anchorRect\.width - tipRect\.width\) \/ 2/, 'tooltip anchors near the bar center');
  assert.match(positionSource, /top < margin/, 'tooltip flips below near the top edge');
  assert.match(positionSource, /viewportWidth - margin/, 'tooltip clamps horizontally inside panel edges');
  assert.match(positionSource, /viewportHeight - tipRect\.height - margin/, 'tooltip clamps vertically inside panel edges');

  const bindSource = sandbox.__chartTooltipTest.bindHistoryTooltipControlsSource;
  assert.match(bindSource, /mouseover/, 'tooltip opens on hover');
  assert.match(bindSource, /focusin/, 'tooltip opens on keyboard focus');
  assert.match(bindSource, /Escape/, 'tooltip supports keyboard dismissal');
  const closestSource = sandbox.__chartTooltipTest.closestHistoryTooltipTargetSource;
  assert.match(closestSource, /data-model-tip-id/, 'tooltip target lookup recognizes model distribution targets');
  const renderTooltipSource = sandbox.__chartTooltipTest.renderHistoryTooltipContentSource;
  assert.match(renderTooltipSource, /renderModelDistributionTooltipContent/, 'single tooltip shell dispatches model distribution payloads');
  assert.match(renderTooltipSource, /showProviderSwatches === false/, 'history tooltip can suppress provider swatches for model-stacked combined bins');
  assert.match(renderTooltipSource, /ab-tip-model-row[\s\S]*ab-tip-swatch/, 'Top Models rows keep model swatches');

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  assert.match(styles, /\.ab-tip\{[\s\S]*position:fixed/, 'single tooltip style is fixed-position for webview edge handling');
  assert.match(styles, /\.ab-tip\{[\s\S]*pointer-events:none/, 'tooltip does not cause hover jitter');
  assert.match(styles, /\.usage-history-bar:focus-visible/, 'focus-visible styling exists for chart bars');
  assert.match(styles, /\.usage-model-donut-segment:focus-visible/, 'focus-visible styling exists for model donut segments');
  assert.match(styles, /\.usage-model-row:focus-visible/, 'focus-visible styling exists for model legend rows');
  assert.match(styles, /\.ab-tip-provider-row\.codex[\s\S]*repeating-linear-gradient/, 'Codex provider attribution keeps hatch treatment');

  console.log('PASS: chart tooltip smoke tests passed.');
}

main();
