#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const { initModelPricingFromCsv } = require(path.join(repoRoot, 'out', 'modelPricing.js'));
const { aggregateSnapshotBucketModels, buildRemoteUsageProjection } = require('../out/snapshot/remoteUsageProjection.js');
const { buildUsageDashboardModel } = require('../out/panel/usageDashboardModel.js');
const { buildStatusHoverModelBreakdown } = require('../out/display/modelBreakdown.js');
const { formatRemoteProviderTooltip } = require('../out/display/format.js');
const { SNAPSHOT_SCHEMA_V1 } = require('../out/snapshot/types.js');
const { displayTotalTokens } = require('../out/snapshot/tokenMath.js');
const { estimateClaudeCostUsd, estimateCodexCostUsd } = require('../out/providers/pricing.js');
const { createCanonicalUsageFixture } = require('../out/test/fixtures/canonicalUsageFixture.js');
initModelPricingFromCsv(fs.readFileSync(path.join(repoRoot, 'data', 'model-pricing-estimates.csv'), 'utf8'));

const TODAY_KEY = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();

function dateKeyFromTodayOffset(offsetDays) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function assertCompactRemoteTooltip(markdown, label) {
  assert.ok(String(markdown || '').length > 0, `${label}: tooltip exists`);
  assert.doesNotMatch(markdown, /\*\*Models\*\*|Models \(|API est\.|Remote API estimates excluded|API estimate unavailable/, `${label}: tooltip omits model/pricing sections`);
}

function makeBucket(overrides = {}) {
  return {
    dateKey: TODAY_KEY,
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 250,
    cacheReadTokens: 100,
    reasoningOutputTokens: 75,
    messages: 2,
    models: [{
      model: 'claude-sonnet-4-20250514',
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 250,
      cacheReadTokens: 100,
      reasoningOutputTokens: 75,
      messages: 2
    }],
    ...overrides
  };
}

function makeV2Source(overrides = {}) {
  return {
    provider: 'claude',
    sourceLabel: 'Claude',
    machineLabel: 'desktop',
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    quotaOnly: false,
    stale: false,
    historyBuckets: [
      { dateKey: '2026-05-18', inputTokens: 10000, outputTokens: 6000, cacheCreationTokens: 2000, cacheReadTokens: 400 },
      makeBucket()
    ],
    ...overrides
  };
}

function makeNonCurrentSource(overrides = {}) {
  return {
    provider: 'claude',
    sourceLabel: 'Claude',
    machineLabel: 'LEGACY',
    schemaVersion: 99,
    quotaOnly: false,
    stale: false,
    ...overrides
  };
}

{
  const projection = buildRemoteUsageProjection([makeV2Source()], new Set());
  assert.equal(projection.claudeToday, undefined);
  assert.equal(projection.claudeHistoryPoints.length, 0);
  assert.equal(projection.claudeModelEntries.length, 0);
  console.log('empty projection when no sources selected: PASS');
}

{
  const projection = buildRemoteUsageProjection([makeNonCurrentSource()], new Set(['LEGACY/claude']));
  assert.equal(projection.claudeToday, undefined);
  assert.equal(projection.claudeHistoryPoints.length, 0);
  assert.equal(projection.claudeModelEntries.length, 0);
  console.log('non-current schema source excluded: PASS');
}

{
  const projection = buildRemoteUsageProjection([makeV2Source({ stale: true, machineLabel: 'STALE' })], new Set(['STALE/claude']));
  assert.equal(projection.claudeToday, undefined);
  assert.equal(projection.claudeHistoryPoints.length, 0);
  console.log('stale source excluded from history: PASS');
}

{
  const projection = buildRemoteUsageProjection([makeV2Source({ machineLabel: 'OTHER' })], new Set(['desktop/claude']));
  assert.equal(projection.claudeToday, undefined);
  console.log('unselected source excluded: PASS');
}

{
  const projection = buildRemoteUsageProjection([makeV2Source()], new Set(['desktop/claude']));
  assert.ok(projection.claudeToday);
  assert.equal(projection.claudeToday.inputTokens, 1000);
  assert.equal(projection.claudeToday.outputTokens, 500);
  assert.equal(projection.claudeToday.cacheCreationTokens, 250);
  assert.equal(projection.claudeToday.cacheReadTokens, 100);
  assert.equal(projection.claudeToday.reasoningOutputTokens, 75);
  assert.equal(projection.claudeToday.sourceCount, 1);
  console.log('selected v2 source derives Today from current history bucket: PASS');
}

{
  const sources = [
    makeV2Source({ machineLabel: 'desktop' }),
    makeV2Source({ machineLabel: 'vm-source' })
  ];
  const projection = buildRemoteUsageProjection(sources, new Set(['desktop/claude', 'vm-source/claude']));
  assert.equal(projection.claudeToday.inputTokens, 2000);
  assert.equal(projection.claudeToday.sourceCount, 2);
  console.log('multiple sources accumulate bucket-derived Today: PASS');
}

{
  const projection = buildRemoteUsageProjection([makeV2Source()], new Set(['desktop/claude']));
  assert.equal(projection.claudeHistoryPoints.length, 2);
  const pt = projection.claudeHistoryPoints[1];
  assert.equal(pt.dateKey, TODAY_KEY);
  assert.equal(pt.totalTokens, 1850);
  assert.equal(pt.models[0].model, 'claude-sonnet-4-20250514');
  assert.equal(pt.models[0].totalTokens, 1850);
  assert.equal(pt.models[0].reasoningOutputTokens, 75);
  console.log('history buckets and bucket model rows imported: PASS');
}

{
  const cacheHeavyCodexSource = makeV2Source({
    provider: 'codex',
    machineLabel: 'vm-source',
    historyBuckets: [makeBucket({
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 9000,
      cacheReadTokens: 250,
      reasoningOutputTokens: 7000,
      models: [{
        model: 'gpt-5.5',
        inputTokens: 600,
        outputTokens: 250,
        cacheCreationTokens: 6000,
        cacheReadTokens: 100,
        reasoningOutputTokens: 3000,
        messages: 1
      }, {
        model: 'codex-auto-review',
        inputTokens: 400,
        outputTokens: 250,
        cacheCreationTokens: 3000,
        cacheReadTokens: 150,
        reasoningOutputTokens: 4000,
        messages: 1
      }]
    })]
  });
  const projection = buildRemoteUsageProjection([cacheHeavyCodexSource], new Set(['vm-source/codex']));
  const point = projection.codexHistoryPoints[0];
  const modelTotal = projection.codexModelEntries.reduce((sum, entry) => sum + entry.tokens, 0);
  assert.equal(point.totalTokens, 10750, 'provider bucket displayed total includes cache creation/read');
  assert.equal(modelTotal, point.totalTokens, 'provider bucket displayed total equals complete model displayed totals');
  assert.equal(displayTotalTokens(cacheHeavyCodexSource.historyBuckets[0]), 10750, 'canonical helper excludes reasoning from displayed total');
  assert.equal(point.models.find(m => m.model === 'gpt-5.5').totalTokens, 6950, 'cache-heavy Codex model total includes cacheCreationTokens');
  console.log('cache-heavy Codex projection uses canonical displayed token math: PASS');
}

{
  const sourceA = makeV2Source({
    machineLabel: 'desktop',
    historyBuckets: [makeBucket({
      models: [{
        model: 'claude-sonnet-4-20250514',
        inputTokens: 2000,
        outputTokens: 1000,
        cacheCreationTokens: 500,
        cacheReadTokens: 250,
        messages: 3
      }]
    })]
  });
  const sourceB = makeV2Source({
    machineLabel: 'vm-source',
    historyBuckets: [makeBucket({
      models: [{
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 250,
        cacheReadTokens: 100,
        messages: 2
      }, {
        model: 'claude-opus-4-20250514',
        inputTokens: 500,
        outputTokens: 250,
        cacheCreationTokens: 100,
        cacheReadTokens: 50,
        messages: 1
      }]
    })]
  });
  const projection = buildRemoteUsageProjection([sourceA, sourceB], new Set(['desktop/claude', 'vm-source/claude']));
  const sonnet = projection.claudeModelEntries.find(e => e.model === 'claude-sonnet-4-20250514');
  const opus = projection.claudeModelEntries.find(e => e.model === 'claude-opus-4-20250514');
  assert.equal(sonnet.tokens, 5600);
  assert.equal(sonnet.assistantMessages, 5);
  assert.equal(opus.tokens, 900);
  console.log('model entries aggregate from historyBuckets models only: PASS');
}

{
  const codexSource = makeV2Source({
    provider: 'codex',
    machineLabel: 'CODEX-VM',
    historyBuckets: [makeBucket({
      models: [{
        model: 'gpt-5-5',
        inputTokens: 5000,
        outputTokens: 3000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messages: 1
      }]
    })]
  });
  const projection = buildRemoteUsageProjection([codexSource], new Set(['CODEX-VM/codex']));
  assert.ok(projection.codexToday);
  assert.equal(projection.claudeToday, undefined);
  assert.equal(projection.codexModelEntries[0].tokens, 8000);
  console.log('codex source routes to codex projection fields: PASS');
}

{
  const codexSource = makeV2Source({
    provider: 'codex',
    machineLabel: 'vm-source',
    historyBuckets: [makeBucket({
      models: [{
        model: 'gpt-5.5',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 100,
        messages: 2
      }]
    })]
  });
  const projection = buildRemoteUsageProjection([codexSource], new Set(['vm-source/codex']));
  const model = buildUsageDashboardModel({
    states: [{ provider: 'codex', source: 'local', stale: false, sevenDay: { usedPercentage: 20 }, fiveHour: { usedPercentage: 10 } }],
    enabledProviders: ['codex'],
    remoteUsage: projection
  });
  const segment = model.details.codexModelDistribution.segments.find(s => s.model === 'gpt-5.5');
  assert.equal(segment.totalTokens, 1800);
  assert.equal(segment.assistantMessages, 2);
  console.log('remote-only model distribution derives from historyBuckets model rows: PASS');
}

{
  const codexSource = makeV2Source({
    provider: 'codex',
    machineLabel: 'vm-source',
    historyBuckets: [makeBucket({
      models: [{
        model: 'gpt-5-5',
        inputTokens: 5000,
        outputTokens: 3000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messages: 1
      }]
    })]
  });
  const projection = buildRemoteUsageProjection([codexSource], new Set(['vm-source/codex']));
  const localCodexHistory = {
    available: true,
    rangeLabel: '30d',
    totalDays: 1,
    activeDays: 1,
    days: [{
      dateKey: TODAY_KEY,
      modelUsage: [{ model: 'gpt-5-5', totalTokens: 8000, assistantMessages: 1, inputTokens: 5000, outputTokens: 3000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }]
    }],
    assistantMessages: 1,
    inputTokens: 5000,
    outputTokens: 3000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 8000,
    modelUsage: [{ model: 'gpt-5-5', totalTokens: 8000, assistantMessages: 1, inputTokens: 5000, outputTokens: 3000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 1,
    recordsMatched: 1,
    fileReadErrors: 0
  };
  const localState = { provider: 'codex', source: 'local', stale: false, sevenDay: { usedPercentage: 20 }, fiveHour: { usedPercentage: 10 } };
  const model = buildUsageDashboardModel({
    states: [localState],
    codexCorrelatedHistory: localCodexHistory,
    enabledProviders: ['codex'],
    remoteUsage: projection
  });
  const segment = model.details.codexModelDistribution.segments.find(s => s.model === 'gpt-5-5');
  assert.equal(segment.totalTokens, 16000);
  assert.equal(model.details.codexModelDistribution.segments.length, 1);
  console.log('model distribution merges local and bucket-derived remote model rows: PASS');
}

{
  const buckets = [
    makeBucket({
      dateKey: dateKeyFromTodayOffset(-8),
      models: [{
        model: 'old-remote-model',
        inputTokens: 9000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messages: 99
      }]
    }),
    makeBucket({
      dateKey: TODAY_KEY,
      models: [{
        model: 'gpt-5.5',
        inputTokens: 2000,
        outputTokens: 1000,
        cacheCreationTokens: 500,
        cacheReadTokens: 250,
        messages: 4
      }]
    })
  ];
  const windowed = aggregateSnapshotBucketModels(buckets, { windowDays: 7 });
  assert.equal(windowed.length, 1);
  assert.equal(windowed[0].model, 'gpt-5.5');
  assert.equal(windowed[0].tokens, 3750);

  const projection = buildRemoteUsageProjection([
    makeV2Source({ provider: 'codex', machineLabel: 'vm-source', historyBuckets: buckets })
  ], new Set(['vm-source/codex']), { windowDays: 7 });
  assert.equal(projection.codexModelEntries.length, 1);
  assert.equal(projection.codexModelEntries[0].model, 'gpt-5.5');
  console.log('status/tooltip remote model rows honor the selected bucket window: PASS');
}

{
  const fixture = createCanonicalUsageFixture();
  const model = buildUsageDashboardModel({
    states: fixture.states,
    claudeTodayUsage: fixture.claudeToday,
    claudeUsageHistory: fixture.claudeHistory,
    codexCorrelatedHistory: fixture.codexHistory,
    codexTodayUsage: fixture.codexToday,
    enabledProviders: ['claude', 'codex'],
    remoteUsage: fixture.remoteProjection
  });

  const forbiddenFixtureText = JSON.stringify(fixture.remoteSources);
  for (const field of ['todaySummary', 'modelContribution', 'windowResetMeta', 'resetAtEpochSeconds', 'apiEquivalentCostUsd']) {
    assert.equal(forbiddenFixtureText.includes(field), false, `canonical fixture must not reintroduce ${field}`);
  }

  assert.equal(displayTotalTokens(fixture.remoteProjection.claudeToday), 1110, 'imported projection derives Claude Today from selected historyBuckets');
  assert.equal(displayTotalTokens(fixture.remoteProjection.codexToday), 2325, 'imported projection derives Codex Today from selected historyBuckets');

  const claudeTodayCard = model.today.cards.find(card => card.key === 'todayTokens');
  const codexTodayCard = model.today.cards.find(card => card.key === 'codexTodayTokens');
  const claudeTodayApi = model.today.cards.find(card => card.key === 'todayApiEquivalent');
  const codexTodayApi = model.today.cards.find(card => card.key === 'codexTodayApiEquivalent');
  assert.equal(claudeTodayCard.value, '3.9K', 'Claude Today card shows local + selected remote token total');
  assert.equal(codexTodayCard.value, '7.5K', 'Codex Today card shows local + selected remote token total');
  assert.equal(claudeTodayApi.available, true, 'mixed Claude local+remote API estimate is available when every row has model/token components');
  assert.match(claudeTodayApi.value, /^\$/, 'mixed Claude local+remote API estimate shows a derived combined cost');
  assert.equal(codexTodayApi.available, true, 'mixed Codex local+remote API estimate is available when every row has model/token components');
  assert.match(codexTodayApi.value, /^\$/, 'mixed Codex local+remote API estimate shows a derived combined cost');

  const localOnlyModel = buildUsageDashboardModel({
    states: fixture.states,
    claudeTodayUsage: fixture.claudeToday,
    claudeUsageHistory: fixture.claudeHistory,
    codexCorrelatedHistory: fixture.codexHistory,
    codexTodayUsage: fixture.codexToday,
    enabledProviders: ['claude', 'codex']
  });
  assert.equal(localOnlyModel.today.cards.find(card => card.key === 'todayApiEquivalent').available, true, 'local-only Claude with complete model cost data may show API estimate');
  assert.equal(localOnlyModel.today.cards.find(card => card.key === 'codexTodayApiEquivalent').available, true, 'local-only Codex with complete model cost data may show API estimate');

  const remoteOnlyModel = buildUsageDashboardModel({
    states: [],
    enabledProviders: ['claude', 'codex'],
    remoteUsage: fixture.remoteProjection
  });
  assert.equal(remoteOnlyModel.today.cards.find(card => card.key === 'todayApiEquivalent').available, true, 'remote-only Claude known model rows compute API estimate locally');
  assert.equal(remoteOnlyModel.today.cards.find(card => card.key === 'codexTodayApiEquivalent').available, true, 'remote-only Codex known model rows compute API estimate locally');

  const unpriceableProjection = buildRemoteUsageProjection([makeV2Source({
    machineLabel: 'BROKEN',
    historyBuckets: [makeBucket({
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 100,
      cacheReadTokens: 50,
      models: []
    })]
  })], new Set(['BROKEN/claude']));
  const unpriceableModel = buildUsageDashboardModel({
    states: [],
    enabledProviders: ['claude'],
    remoteUsage: unpriceableProjection
  });
  assert.equal(unpriceableModel.today.cards.find(card => card.key === 'todayApiEquivalent').available, false, 'remote row without model/token attribution hides API estimate');

  const fallbackProjection = buildRemoteUsageProjection([makeV2Source({
    machineLabel: 'FALLBACK',
    historyBuckets: [makeBucket({
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 100,
      cacheReadTokens: 50,
      models: [{
        model: 'claude-future-unknown',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 100,
        cacheReadTokens: 50,
        messages: 1
      }]
    })]
  })], new Set(['FALLBACK/claude']));
  const fallbackModel = buildUsageDashboardModel({
    states: [],
    enabledProviders: ['claude'],
    remoteUsage: fallbackProjection
  });
  const fallbackApi = fallbackModel.today.cards.find(card => card.key === 'todayApiEquivalent');
  assert.equal(fallbackApi.available, true, 'unknown remote model follows existing fallback pricing behavior');
  const fallbackEstimate = estimateClaudeCostUsd(1000, 500, 50, 100, ['claude-future-unknown']);
  assert.equal(fallbackEstimate.isFallback, true, 'unknown remote model is detected as fallback-priced data');

  const claudeTodayBin = model.details.historyChart.rangeViews['1W'].points.find(point => point.dateKey === fixture.todayKey);
  const codexTodayBin = model.details.codexHistoryChart.rangeViews['1W'].points.find(point => point.dateKey === fixture.todayKey);
  assert.equal(claudeTodayBin.totalTokens, fixture.expected.claudeTodayTokens, 'Claude history bin agrees with Today token total');
  assert.equal(codexTodayBin.totalTokens, fixture.expected.codexTodayTokens, 'Codex history bin agrees with Today token total');
  assert.equal(
    model.details.historyChart.rangeViews['1W'].points.reduce((sum, point) => sum + point.totalTokens, 0),
    fixture.expected.claudeHistoryTokens,
    'Claude history chart/binning preserves local + selected remote totals'
  );
  assert.equal(
    model.details.codexHistoryChart.rangeViews['1W'].points.reduce((sum, point) => sum + point.totalTokens, 0),
    fixture.expected.codexHistoryTokens,
    'Codex history chart/binning preserves local + selected remote totals'
  );

  assert.equal(model.details.modelDistribution.totalTokens, fixture.expected.claudeModelDistributionTokens, 'Claude model distribution agrees with canonical fixture total');
  assert.equal(model.details.codexModelDistribution.totalTokens, fixture.expected.codexModelDistributionTokens, 'Codex model distribution agrees with canonical fixture total');

  const hoverBreakdown = buildStatusHoverModelBreakdown([{
    provider: 'claude',
    history: { available: true, days: fixture.claudeHistory.days },
    shortenModel: modelName => modelName,
    estimateCostUsd: row => estimateClaudeCostUsd(row.inputTokens, row.outputTokens, row.cacheReadInputTokens, row.cacheCreationInputTokens, [row.model]).costUsd,
    remoteModelEntries: fixture.remoteProjection.claudeModelEntries
  }, {
    provider: 'codex',
    history: { available: true, days: fixture.codexHistory.days },
    shortenModel: modelName => modelName,
    estimateCostUsd: row => estimateCodexCostUsd(row.inputTokens, row.outputTokens, row.cacheReadInputTokens, row.cacheCreationInputTokens, [row.model]).costUsd,
    remoteModelEntries: fixture.remoteProjection.codexModelEntries
  }], fixture.targetDate);

  assert.equal(hoverBreakdown.claude.reduce((sum, row) => sum + row.totalTokens, 0), fixture.expected.claudeModelDistributionTokens, 'status hover Claude model table agrees with model distribution total');
  assert.equal(hoverBreakdown.codex.reduce((sum, row) => sum + row.totalTokens, 0), fixture.expected.codexModelDistributionTokens, 'status hover Codex model table agrees with model distribution total');
  assert.equal(hoverBreakdown.claude.filter(row => row.remoteTokens).every(row => row.costUsd !== undefined), true, 'status hover prices remote rows with complete model/token components');
  assert.equal(hoverBreakdown.codex.filter(row => row.remoteTokens).every(row => row.costUsd !== undefined), true, 'status hover prices remote rows with complete model/token components');

  const remoteTooltip = formatRemoteProviderTooltip({
    label: 'Codex (workstation)',
    provider: 'codex',
    sevenDayRemainingPercent: 65,
    fiveHourRemainingPercent: 85,
    stale: false,
    snapshotAgeLabel: '1m',
    snapshotEpochMs: Date.now()
  });

  assertCompactRemoteTooltip(remoteTooltip, 'remote split');

  console.log('canonical cross-surface agreement fixture: PASS');
}

console.log('\nsmoke-remote-history-merge: all tests passed');
