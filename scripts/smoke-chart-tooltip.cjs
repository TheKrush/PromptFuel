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
    'globalThis.__chartTooltipTest = { renderHistoryChart: renderHistoryChart, renderWeekdayActivityBreakdown: renderWeekdayActivityBreakdown, renderCombinedHistoryLegend: renderCombinedHistoryLegend, renderClaudeModelDistribution: renderClaudeModelDistribution, renderApiEstimateStrip: renderApiEstimateStrip, renderUsageMetricCard: renderUsageMetricCard, renderHistoryRange: renderHistoryRange, renderHistoryTooltipContent: renderHistoryTooltipContent, resetHistoryTooltipPayloads: resetHistoryTooltipPayloads, resetModelColorAssignments: resetModelColorAssignments, setLastUsageDashboardModel: function(model) { lastUsageDashboardModel = model; }, getPayloads: function() { return historyTooltipPayloads; }, positionHistoryTooltipSource: String(positionHistoryTooltip), bindHistoryTooltipControlsSource: String(bindHistoryTooltipControls), closestHistoryTooltipTargetSource: String(closestHistoryTooltipTarget), tooltipPayloadIdFromTargetSource: String(tooltipPayloadIdFromTarget), renderHistoryTooltipContentSource: String(renderHistoryTooltipContent) }; })();'
  );
  const fakeElement = createFakeElement();
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      body: { appendChild: () => undefined },
      documentElement: { clientWidth: 320, clientHeight: 240 },
      createElement: tagName => createFakeElement(tagName),
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
      binStartDateKey: '2026-05-28',
      binEndDateKey: '2026-06-24',
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
  assert.match(combinedHtml, /class="source-chip mixed glyph"[^>]*data-source-tip-id="source-tip-1"/, 'history chart source chips carry bespoke tooltip payload ids');
  assert.match(combinedHtml, /class="source-chip mixed glyph"[^>]*tabindex="0"/, 'history chart source chips are keyboard focusable');
  assert.match(combinedHtml, /tabindex="0"/, 'history bars are keyboard focusable');
  assert.match(combinedHtml, /aria-label="/, 'history bars keep an ARIA fallback');
  assert.doesNotMatch(combinedHtml, /usage-history-bar[^>]*title="/, 'history bars do not rely on native title tooltip UX');
  assert.doesNotMatch(combinedHtml, /source-chip[^>]*title="/, 'source chips do not rely on native title tooltip UX');
  assert.doesNotMatch(combinedHtml, /<img src=x onerror=alert\(1\)>/, 'unsafe model text is not emitted as raw HTML');
  assert.match(combinedHtml, /&lt;img src=x onerror=alert\(1\)&gt;Codex/, 'unsafe model text is escaped in ARIA fallback');

  const payloads = sandbox.__chartTooltipTest.getPayloads();
  const payload = payloads['history-tip-1'];
  const sourcePayload = payloads['source-tip-1'];
  assert.equal(payload.provider, 'combined', 'payload records combined mode');
  assert.equal(payload.binLabel, '2026-05-28 to 2026-06-24', 'payload includes the full date-range header');
  assert.equal(payload.totalTokens, 3000, 'payload includes total tokens');
  assert.equal(payload.activity, 5, 'payload includes message/turn count');
  assert.equal(payload.sourceText, 'Claude trusted usage + Codex correlated usage', 'combined payload keeps source wording');
  assert.equal(sourcePayload.kind, 'sourceChip', 'source chip payload is routed through the custom tooltip shell');
  assert.equal(sourcePayload.title, 'Mixed', 'source chip payload uses the compact source type as the tooltip title');
  assert.equal(sourcePayload.subtitle, 'Mixed Claude trusted and Codex correlated history', 'source chip payload keeps the provenance label as a subtitle');
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
  const weekdayHtml = sandbox.__chartTooltipTest.renderWeekdayActivityBreakdown(
    {
      available: true,
      entries: [
        {
          label: 'Sun',
          longLabel: 'Sunday',
          totalTokens: 3000,
          percentLabel: '100%',
          assistantMessages: 5,
          activeDays: 1,
          models: [
            { label: 'Claude - Sonnet 4', model: 'claude-sonnet-4-20250514', provider: 'claude', totalTokens: 2000 },
            { label: 'Codex - GPT-5', model: 'gpt-5-codex', provider: 'codex', totalTokens: 1000 }
          ]
        },
        { label: 'Mon', longLabel: 'Monday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Tue', longLabel: 'Tuesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Wed', longLabel: 'Wednesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Thu', longLabel: 'Thursday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Fri', longLabel: 'Friday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Sat', longLabel: 'Saturday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] }
      ]
    },
    '1M',
    'Combined',
    '1M / daily bins',
    { confidence: 'mixedDayBucket', label: 'Mixed Claude trusted and Codex correlated history' }
  );
  assert.match(weekdayHtml, /Weekday distribution<\/span><span class="source-chip mixed glyph" tabindex="0" data-source-tip-id="source-tip-1"/, "weekday distribution heading uses the shared source chip tooltip path");
  assert.doesNotMatch(weekdayHtml, /source-chip[^>]*title="/, "weekday distribution heading avoids native title tooltip UX");
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['source-tip-1'].subtitle, 'Mixed Claude trusted and Codex correlated history', 'weekday distribution heading keeps the shared mixed-source tooltip metadata');
  const weekdayPayload = sandbox.__chartTooltipTest.getPayloads()['history-tip-1'];
  assert.equal(weekdayPayload.dayLabel, 'Sunday', 'weekday tooltip payload keeps the weekday name');
  assert.equal(weekdayPayload.rangeKey, '1M', 'weekday tooltip payload keeps the active range key');
  assert.equal(weekdayPayload.totalTokens, 3000, 'weekday tooltip payload keeps the total tokens');
  assert.equal(weekdayPayload.percentLabel, '100%', 'weekday tooltip payload keeps the share label');
  assert.equal(weekdayPayload.activeDays, 1, 'weekday tooltip payload keeps the active day count');
  assert.equal(weekdayPayload.activity, 5, 'weekday tooltip payload keeps the messages/turns count');
  assert.equal(weekdayPayload.topModels.length, 2, 'weekday tooltip payload keeps top model rows');
  const weekdayTooltip = createFakeElement();
  sandbox.__chartTooltipTest.renderHistoryTooltipContent(weekdayTooltip, weekdayPayload);
  const weekdayTooltipText = elementText(weekdayTooltip).replace(/\s+/g, ' ');
  assert.match(weekdayTooltipText, /Sunday/, 'weekday tooltip content includes the weekday name');
  assert.match(weekdayTooltipText, /1M/, 'weekday tooltip content includes the active range');
  assert.match(weekdayTooltipText, /Total tokens/, 'weekday tooltip content includes total tokens');
  assert.match(weekdayTooltipText, /Share/, 'weekday tooltip content includes the share stat');
  assert.match(weekdayTooltipText, /Active days/, 'weekday tooltip content includes active days');
  assert.match(weekdayTooltipText, /Messages \/ turns/, 'weekday tooltip content includes messages/turns');
  assert.match(weekdayTooltipText, /Top models/, 'weekday tooltip content includes the top model section');
  assert.match(weekdayTooltipText, /Claude - Sonnet 4/, 'weekday tooltip content includes the leading model row');
  assert.match(weekdayTooltipText, /Codex - GPT-5/, 'weekday tooltip content includes the secondary model row');
  sandbox.__chartTooltipTest.setLastUsageDashboardModel({ weekStartsOn: 1 });
  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const rotatedWeekdayHtml = sandbox.__chartTooltipTest.renderWeekdayActivityBreakdown(
    {
      available: true,
      entries: [
        { label: 'Sun', longLabel: 'Sunday', totalTokens: 1000, percentLabel: '25%', assistantMessages: 1, activeDays: 1, models: [{ label: 'Sonnet 4', model: 'claude-sonnet-4-20250514', provider: 'claude', totalTokens: 1000 }] },
        { label: 'Mon', longLabel: 'Monday', totalTokens: 3000, percentLabel: '75%', assistantMessages: 3, activeDays: 2, models: [{ label: 'Opus 4', model: 'claude-opus-4-20250514', provider: 'claude', totalTokens: 3000 }] },
        { label: 'Tue', longLabel: 'Tuesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Wed', longLabel: 'Wednesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Thu', longLabel: 'Thursday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Fri', longLabel: 'Friday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Sat', longLabel: 'Saturday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] }
      ]
    },
    '1M',
    'Claude',
    '1M / daily bins',
    { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' }
  );
  assert.match(rotatedWeekdayHtml, /usage-weekday-axis"><span>Mon<\/span><span>Tue<\/span><span>Wed<\/span><span>Thu<\/span><span>Fri<\/span><span>Sat<\/span><span>Sun<\/span>/, 'weekStartsOn only rotates weekday display order');
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['history-tip-1'].dayLabel, 'Monday', 'weekStartsOn rotation keeps Monday data attached to the first displayed bar');
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['history-tip-1'].totalTokens, 3000, 'weekStartsOn rotation does not rebin weekday totals');
  sandbox.__chartTooltipTest.setLastUsageDashboardModel({ weekStartsOn: 0 });
  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const partialWeekdayHtml = sandbox.__chartTooltipTest.renderWeekdayActivityBreakdown(
    {
      available: true,
      entries: [
        { label: 'Sun', longLabel: 'Sunday', totalTokens: 1000, percentLabel: '100%', assistantMessages: 2, activeDays: 1, models: [{ label: 'Sonnet 4', model: 'claude-sonnet-4-20250514', provider: 'claude', totalTokens: 600 }] },
        { label: 'Mon', longLabel: 'Monday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Tue', longLabel: 'Tuesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Wed', longLabel: 'Wednesday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Thu', longLabel: 'Thursday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Fri', longLabel: 'Friday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] },
        { label: 'Sat', longLabel: 'Saturday', totalTokens: 0, percentLabel: '0%', assistantMessages: 0, activeDays: 0, models: [] }
      ]
    },
    '1W',
    'Claude',
    '1W / daily bins',
    { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' }
  );
  assert.match(partialWeekdayHtml, /class="usage-history-bar-fill" style="height:100%"/, 'weekday partial model attribution falls back to total bar height');
  assert.doesNotMatch(partialWeekdayHtml, /usage-history-bar-fill stacked/, 'weekday partial model attribution does not render misleading partial stacks');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const combinedYearChart = {
    ...combinedChart,
    rangeLabel: '1Y / weekly bins',
    ranges: [{ key: '1Y', label: '1Y', available: true, active: true }],
    points: [{
      ...combinedChart.points[0],
      binStartDateKey: '2025-12-29',
      binEndDateKey: '2026-01-04'
    }]
  };
  sandbox.__chartTooltipTest.renderHistoryChart(combinedYearChart, 'combined', '1Y', combinedYearChart.source);
  const yearPayload = sandbox.__chartTooltipTest.getPayloads()['history-tip-1'];
  assert.equal(yearPayload.binLabel, '2025-12-29 to 2026-01-04', '1Y combined tooltip preserves the full weekly date range');
  assert.equal(yearPayload.sourceText, 'Claude trusted usage + Codex correlated usage', '1Y combined tooltip keeps source wording');

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
  const legendHtml = sandbox.__chartTooltipTest.renderCombinedHistoryLegend(fallbackCombinedChart);
  assert.match(legendHtml, /usage-history-legend-swatch claude" tabindex="0" data-usage-tip-id="usage-tip-1"/, 'provider legend swatches use custom tooltip payload ids');
  assert.match(legendHtml, /usage-history-legend-swatch codex" tabindex="0" data-usage-tip-id="usage-tip-2"/, 'provider legend codex swatch uses custom tooltip payload ids');
  assert.doesNotMatch(legendHtml, /usage-history-legend-swatch[^>]*title="/, 'provider legend swatches avoid native title tooltip UX');
  const legendPayload = sandbox.__chartTooltipTest.getPayloads()['usage-tip-1'];
  assert.equal(legendPayload.kind, 'usageNote', 'legend swatch payload uses the custom usage note renderer');
  assert.equal(legendPayload.title, 'Claude', 'legend swatch payload keeps the provider title');
  assert.equal(legendPayload.body, 'Trusted completed-turn data', 'legend swatch payload keeps the provenance note');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const unavailableRangeHtml = sandbox.__chartTooltipTest.renderHistoryRange({ key: '1Y', label: '1Y', available: false }, '1M', 'combined');
  assert.match(unavailableRangeHtml, /data-usage-tip-id="usage-tip-1"/, 'unavailable range pills use custom tooltip payload ids');
  assert.doesNotMatch(unavailableRangeHtml, /title="/, 'unavailable range pills avoid native title tooltip UX');
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['usage-tip-1'].body, 'Unavailable in this slice', 'unavailable range payload keeps the unavailable reason');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const apiTooltipHtml = sandbox.__chartTooltipTest.renderApiEstimateStrip({
    label: '1D API-equivalent',
    value: '$171',
    detailLines: ['Claude: <b>$57.34</b>', 'Codex: $114 & fees'],
    detailTooltip: 'Estimated <combined> "cost"; not actual billing',
    available: true
  });
  assert.match(apiTooltipHtml, /class="usage-api-estimate-strip" tabindex="0" data-usage-tip-id="usage-tip-1"/, 'API estimate strips use custom tooltip payload ids');
  assert.doesNotMatch(apiTooltipHtml, /title="/, 'API estimate strips avoid native title tooltip UX');
  assert.match(apiTooltipHtml, /Claude: &lt;b&gt;\$57\.34&lt;\/b&gt;<br>Codex: \$114 &amp; fees/, 'API estimate strip still escapes visible detailLines');
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['usage-tip-1'].body, 'Estimated <combined> "cost"; not actual billing', 'API estimate payload keeps the full note text');

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  const metricTooltipHtml = sandbox.__chartTooltipTest.renderUsageMetricCard({
    label: '1D tokens',
    value: '94.8M',
    detail: 'Claude 56.2K',
    detailTooltip: 'Mixed Claude trusted and Codex correlated history',
    source: {
      confidence: 'mixedDayBucket',
      label: 'Mixed Claude trusted and Codex correlated history',
      detail: 'Claude uses trusted completed-turn buckets; Codex remains correlated day-bucket data.'
    },
    available: true
  });
  assert.match(metricTooltipHtml, /source-chip mixed glyph" tabindex="0" data-source-tip-id="source-tip-1"/, 'metric source chips use custom tooltip payload ids');
  assert.match(metricTooltipHtml, /usage-metric-detail" tabindex="0" data-usage-tip-id="usage-tip-1"/, 'metric detail notes use custom tooltip payload ids');
  assert.doesNotMatch(metricTooltipHtml, /source-chip[^>]*title="/, 'metric source chips avoid native title tooltip UX');
  assert.doesNotMatch(metricTooltipHtml, /usage-metric-detail[^>]*title="/, 'metric details avoid native title tooltip UX');
  assert.equal(sandbox.__chartTooltipTest.getPayloads()['source-tip-1'].detail, 'Claude uses trusted completed-turn buckets; Codex remains correlated day-bucket data.', 'metric source tooltip keeps the long provenance detail');

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
  const providerPayload = sandbox.__chartTooltipTest.getPayloads()['history-tip-2'];
  assert.equal(providerPayload.sourceText, 'Claude trusted usage', 'provider chart tooltip keeps source wording');

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
  assert.match(splitDistributionHtml, /<div class="usage-history-chart-title"><span>Model distribution<\/span><span class="source-chip trusted glyph"/, 'model distribution heading uses the shared chart title source chip path');
  assert.doesNotMatch(splitDistributionHtml, /usage-model-distribution-title/, 'model distribution does not use a separate title alignment class');
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

  sandbox.__chartTooltipTest.resetHistoryTooltipPayloads();
  sandbox.__chartTooltipTest.resetModelColorAssignments();
  const rankSwapChart = {
    available: true,
    title: 'Token trend',
    providerLabel: 'Claude',
    rangeLabel: '1M / 30d',
    ranges: [{ key: '1M', label: '1M', available: true, active: true }],
    maxTotalTokens: 1000,
    source: { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' },
    points: [{
      dateKey: '2026-06-23',
      label: '06-23',
      totalTokens: 1000,
      inputTokens: 600,
      outputTokens: 400,
      cacheTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      assistantMessages: 5,
      sourcePointCount: 1,
      models: [
        { label: 'opus-4.7', model: 'claude-opus-4-7', provider: 'claude', providerLabel: 'Claude', totalTokens: 600, assistantMessages: 3 },
        { label: 'fable-5', model: 'claude-fable-5', provider: 'claude', providerLabel: 'Claude', totalTokens: 400, assistantMessages: 2 }
      ]
    }]
  };
  const rankSwapHistoryHtml = sandbox.__chartTooltipTest.renderHistoryChart(rankSwapChart, 'claude', '1M', rankSwapChart.source);
  const rankSwapHistoryPayload = sandbox.__chartTooltipTest.getPayloads()['history-tip-1'];
  const trendOpus = rankSwapHistoryPayload.topModels.find(model => model.label === 'opus-4.7');
  const trendFable = rankSwapHistoryPayload.topModels.find(model => model.label === 'fable-5');
  const rankSwapBarColors = historyBarSegmentColors(rankSwapHistoryHtml);
  assert.equal(rankSwapBarColors[0], trendOpus.color, 'rank-swap trend Opus bar uses the Opus identity color');
  assert.equal(rankSwapBarColors[1], trendFable.color, 'rank-swap trend Fable bar uses the Fable identity color');

  const rankSwapDistribution = {
    available: true,
    title: 'Model distribution',
    providerLabel: 'Claude',
    rangeLabel: '1M / 30d',
    totalTokens: 1700,
    source: { confidence: 'trustedCompletedTurnUsage', label: 'Claude assistant-message JSONL history buckets' },
    segments: [
      { label: 'fable-5', model: 'claude-fable-5', provider: 'claude', providerLabel: 'Claude', totalTokens: 900, assistantMessages: 4, percent: 900 / 1700, percentLabel: '53%' },
      { label: 'opus-4.7', model: 'claude-opus-4-7', provider: 'claude', providerLabel: 'Claude', totalTokens: 800, assistantMessages: 3, percent: 800 / 1700, percentLabel: '47%' }
    ]
  };
  const rankSwapDistributionHtml = sandbox.__chartTooltipTest.renderClaudeModelDistribution(rankSwapDistribution, rankSwapDistribution.source);
  const rankSwapPayloads = Object.values(sandbox.__chartTooltipTest.getPayloads());
  const distributionFable = rankSwapPayloads.find(payload => payload.kind === 'modelDistribution' && payload.model === 'claude-fable-5');
  const distributionOpus = rankSwapPayloads.find(payload => payload.kind === 'modelDistribution' && payload.model === 'claude-opus-4-7');
  const rankSwapDonutColors = modelDistributionDonutColors(rankSwapDistributionHtml);
  const rankSwapSwatchColors = modelDistributionSwatchColors(rankSwapDistributionHtml);
  assert.equal(distributionFable.color, trendFable.color, 'rank-swap Fable tooltip keeps the trend-assigned model color');
  assert.equal(distributionOpus.color, trendOpus.color, 'rank-swap Opus tooltip keeps the trend-assigned model color');
  assert.equal(rankSwapDonutColors[0], trendFable.color, 'rank-swap distribution Fable donut segment keeps the Fable color despite being first');
  assert.equal(rankSwapDonutColors[1], trendOpus.color, 'rank-swap distribution Opus donut segment keeps the Opus color despite being second');
  assert.equal(rankSwapSwatchColors[0], trendFable.color, 'rank-swap distribution Fable legend swatch keeps the Fable color despite being first');
  assert.equal(rankSwapSwatchColors[1], trendOpus.color, 'rank-swap distribution Opus legend swatch keeps the Opus color despite being second');

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
  assert.match(closestSource, /tooltipPayloadIdFromTarget/, 'tooltip target lookup uses the shared target-id helper');
  const targetIdSource = sandbox.__chartTooltipTest.tooltipPayloadIdFromTargetSource;
  assert.match(targetIdSource, /data-model-tip-id/, 'tooltip target lookup recognizes model distribution targets');
  assert.match(targetIdSource, /data-source-tip-id/, 'tooltip target lookup recognizes source chip targets');
  assert.match(targetIdSource, /data-usage-tip-id/, 'tooltip target lookup recognizes usage note targets');
  const renderTooltipSource = sandbox.__chartTooltipTest.renderHistoryTooltipContentSource;
  assert.match(renderTooltipSource, /renderModelDistributionTooltipContent/, 'single tooltip shell dispatches model distribution payloads');
  assert.match(renderTooltipSource, /renderSourceTooltipContent/, 'single tooltip shell dispatches source chip payloads');
  assert.match(renderTooltipSource, /renderUsageNoteTooltipContent/, 'single tooltip shell dispatches usage note payloads');
  assert.match(renderTooltipSource, /showProviderSwatches === false/, 'history tooltip can suppress provider swatches for model-stacked combined bins');
  assert.match(renderTooltipSource, /appendHistoryTooltipModelList/, 'history tooltip routes Top Models rows through the shared model-list helper');

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  const tipHeadBlock = styles.match(/\.ab-tip-head\{[^}]*\}/)?.[0] || '';
  const tipTitleBlock = styles.match(/\.ab-tip-title\{[^}]*\}/)?.[0] || '';
  const tipSourceBlock = styles.match(/\.ab-tip-source\{[^}]*\}/)?.[0] || '';
  assert.match(styles, /\.ab-tip\{[\s\S]*position:fixed/, 'single tooltip style is fixed-position for webview edge handling');
  assert.match(styles, /\.ab-tip\{[\s\S]*pointer-events:none/, 'tooltip does not cause hover jitter');
  assert.match(tipHeadBlock, /display:grid/, 'tooltip header stacks title and source vertically');
  assert.doesNotMatch(tipHeadBlock, /justify-content:space-between/, 'tooltip header does not squeeze title and source horizontally');
  assert.match(tipTitleBlock, /white-space:normal/, 'tooltip title can wrap instead of truncating date ranges');
  assert.doesNotMatch(tipTitleBlock, /overflow:hidden/, 'tooltip title does not clip date ranges');
  assert.doesNotMatch(tipTitleBlock, /text-overflow:ellipsis/, 'tooltip title does not ellipsize date ranges');
  assert.match(tipSourceBlock, /text-align:left/, 'tooltip source renders as a subtitle under the title');
  assert.match(styles, /\.usage-history-bar:focus-visible/, 'focus-visible styling exists for chart bars');
  assert.match(styles, /\.usage-model-donut-segment:focus-visible/, 'focus-visible styling exists for model donut segments');
  assert.match(styles, /\.usage-model-row:focus-visible/, 'focus-visible styling exists for model legend rows');
  assert.match(styles, /\.source-chip:focus-visible/, 'focus-visible styling exists for source chips');
  assert.match(styles, /\.usage-api-estimate-strip:focus-visible/, 'focus-visible styling exists for usage note tooltip targets');
  assert.match(styles, /\.ab-tip-note\{[\s\S]*overflow-wrap:break-word/, 'custom usage note tooltip bodies wrap long text');
  assert.match(styles, /\.ab-tip-provider-row\.codex[\s\S]*repeating-linear-gradient/, 'Codex provider attribution keeps hatch treatment');

  console.log('PASS: chart tooltip smoke tests passed.');
}

function createFakeElement(tagName = 'div') {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    value: '',
    className: '',
    disabled: false,
    innerHTML: '',
    firstChild: null,
    style: {},
    childNodes: [],
    attributes: {},
    _textContent: '',
    addEventListener: () => undefined,
    appendChild(child) {
      this.childNodes.push(child);
      this.firstChild = this.childNodes[0] || null;
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
      }
      this.firstChild = this.childNodes[0] || null;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    classList: {
      add: () => undefined,
      remove: () => undefined
    }
  };
  Object.defineProperty(element, "textContent", {
    get() {
      return this._textContent;
    },
    set(value) {
      this._textContent = String(value);
      this.childNodes = [];
      this.firstChild = null;
    }
  });
  return element;
}

function elementText(node) {
  if (!node) {
    return '';
  }
  const own = node._textContent || '';
  const children = Array.isArray(node.childNodes)
    ? node.childNodes.map(child => elementText(child)).join(' ')
    : '';
  return [own, children].filter(Boolean).join(' ');
}

function historyBarSegmentColors(html) {
  return Array.from(String(html || '').matchAll(/usage-history-bar-segment[^"]*" style="[^"]*background-color:([^";]+)[^"]*"/g))
    .map(match => match[1]);
}

function modelDistributionDonutColors(html) {
  return Array.from(String(html || '').matchAll(/usage-model-donut-segment"[^>]*data-model-tip-id="model-tip-\d+"[^>]*stroke="([^"]+)"/g))
    .map(match => match[1]);
}

function modelDistributionSwatchColors(html) {
  return Array.from(String(html || '').matchAll(/usage-model-swatch" style="background:([^"]+)"/g))
    .map(match => match[1]);
}

main();
