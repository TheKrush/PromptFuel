#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { initModelPricingFromCsv } = require(path.join(repoRoot, 'out', 'modelPricing.js'));
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));
  const { estimateAggregateCostUsd } = require(path.join(repoRoot, 'out', 'providers', 'pricing.js'));
  initModelPricingFromCsv(fs.readFileSync(path.join(repoRoot, 'data', 'model-pricing-estimates.csv'), 'utf8'));

  const costRowsFromModels = models => models.map(model => ({
    model: model.model,
    inputTokens: model.inputTokens,
    outputTokens: model.outputTokens,
    cacheCreationInputTokens: model.cacheCreationInputTokens,
    cacheReadInputTokens: model.cacheReadInputTokens
  }));

  const claudeState = {
    provider: 'claude',
    source: 'local statusLine/hook state',
    stale: false,
    lastUpdatedEpochMs: Date.now()
  };

  const codexState = {
    provider: 'codex',
    source: 'Codex completed-turn bridge status',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    diagnosticSeverity: 'info',
    diagnostics: {
      usageFieldsFound: true,
      quotaFieldsFound: false
    }
  };

  const claudeTodayUsage = {
    available: true,
    dateKey: '2026-05-16',
    dateLabel: '2026-05-16',
    totalTokens: 50000,
    inputTokens: 30000,
    outputTokens: 20000,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 500,
    assistantMessages: 42,
    correlatedTurns: 42,
    models: ['claude-sonnet-4-20250514'],
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 42,
    recordsMatched: 42,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    reasoningOutputTokens: 0
  };

  const codexTodayUsage = {
    available: true,
    dateKey: '2026-05-16',
    dateLabel: '2026-05-16',
    totalTokens: 8000,
    inputTokens: 3000,
    outputTokens: 5000,
    cacheCreationInputTokens: 500,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 600,
    assistantMessages: 2,
    correlatedTurns: 2,
    models: ['gpt-5.4-2026-05-13'],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 10,
    recordsMatched: 2,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };

  {
    const model = buildUsageDashboardModel({
      states: [claudeState, codexState],
      claudeTodayUsage: claudeTodayUsage,
      codexTodayUsage: codexTodayUsage,
      enabledProviders: ['claude', 'codex']
    });

    const todayApiEq = model.today.cards.find(c => c.key === 'todayApiEquivalent');
    assert.ok(todayApiEq, 'todayApiEquivalent card present');
    assert.equal(todayApiEq.available, true, 'todayApiEquivalent card available');
    assert.ok(todayApiEq.value.startsWith('$'), `todayApiEquivalent value starts with $, got ${todayApiEq.value}`);
    assert.equal(estimateAggregateCostUsd([{
      model: claudeTodayUsage.models[0],
      inputTokens: claudeTodayUsage.inputTokens,
      outputTokens: claudeTodayUsage.outputTokens,
      cacheCreationInputTokens: claudeTodayUsage.cacheCreationInputTokens,
      cacheReadInputTokens: claudeTodayUsage.cacheReadInputTokens
    }], true).fallbackCount, 0, 'Claude today estimate uses configured model pricing');

    const codexTodayApiEq = model.today.cards.find(c => c.key === 'codexTodayApiEquivalent');
    assert.ok(codexTodayApiEq, 'codexTodayApiEquivalent card present');
    assert.equal(codexTodayApiEq.available, true, 'codexTodayApiEquivalent card available');
    assert.ok(codexTodayApiEq.value.startsWith('$'), `codexTodayApiEquivalent value starts with $, got ${codexTodayApiEq.value}`);
    assert.equal(estimateAggregateCostUsd([{
      model: codexTodayUsage.models[0],
      inputTokens: codexTodayUsage.inputTokens,
      outputTokens: codexTodayUsage.outputTokens,
      cacheCreationInputTokens: codexTodayUsage.cacheCreationInputTokens,
      cacheReadInputTokens: codexTodayUsage.cacheReadInputTokens
    }], false).fallbackCount, 0, 'Codex today estimate uses configured model pricing');
  }

  {
    const codexMixedTodayUsage = {
      ...codexTodayUsage,
      models: ['gpt-5.4-2026-05-13', '<synthetic>:o3-20260513'],
      modelUsage: [
        {
          model: 'gpt-5.4-2026-05-13',
          assistantMessages: 1,
          inputTokens: 1000,
          outputTokens: 2000,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 3300
        },
        {
          model: '<synthetic>:o3-20260513',
          assistantMessages: 1,
          inputTokens: 2000,
          outputTokens: 3000,
          cacheCreationInputTokens: 300,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 5300
        }
      ]
    };

    const model = buildUsageDashboardModel({
      states: [codexState],
      codexTodayUsage: codexMixedTodayUsage,
      enabledProviders: ['codex']
    });

    const codexTodayApiEq = model.today.cards.find(c => c.key === 'codexTodayApiEquivalent');
    assert.ok(codexTodayApiEq, 'mixed codexTodayApiEquivalent card present');
    assert.equal(codexTodayApiEq.available, true, 'mixed codexTodayApiEquivalent available with per-model tokens');
    assert.ok(codexTodayApiEq.value.startsWith('$'), `mixed codexTodayApiEquivalent value starts with $, got ${codexTodayApiEq.value}`);
    const mixedEstimate = estimateAggregateCostUsd(costRowsFromModels(codexMixedTodayUsage.modelUsage), false);
    assert.equal(mixedEstimate.fallbackCount, 1, 'mixed Codex estimate records one fallback-priced model');
    assert.equal(mixedEstimate.totalCount, 2, 'mixed Codex estimate evaluates both model rows');
  }

  {
    const codexMixedNoBreakdown = {
      ...codexTodayUsage,
      models: ['gpt-5.4-2026-05-13', '<synthetic>:o3-20260513'],
      modelUsage: []
    };

    const model = buildUsageDashboardModel({
      states: [codexState],
      codexTodayUsage: codexMixedNoBreakdown,
      enabledProviders: ['codex']
    });

    const codexTodayApiEq = model.today.cards.find(c => c.key === 'codexTodayApiEquivalent');
    assert.ok(codexTodayApiEq, 'mixed codexTodayApiEquivalent card present without per-model tokens');
    assert.equal(codexTodayApiEq.available, false, 'mixed codexTodayApiEquivalent unavailable without per-model tokens');
    assert.ok(codexTodayApiEq.detailTooltip && codexTodayApiEq.detailTooltip.length > 0, 'mixed unsafe estimate carries unavailable context');
  }

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState] });
    const todayApiEq = model.today.cards.find(c => c.key === 'todayApiEquivalent');
    assert.ok(todayApiEq, 'todayApiEquivalent card present when all unavailable');
    assert.equal(todayApiEq.available, false, 'todayApiEquivalent unavailable when no today data');

    const codexTodayApiEq = model.today.cards.find(c => c.key === 'codexTodayApiEquivalent');
    assert.ok(codexTodayApiEq, 'codexTodayApiEquivalent card present when all unavailable');
    assert.equal(codexTodayApiEq.available, false, 'codexTodayApiEquivalent unavailable when no today data');
  }

  {
    const codexCorrelatedHistory = {
      available: true,
      rangeLabel: '2026-05-15 to 2026-05-16',
      totalDays: 2,
      activeDays: 1,
      assistantMessages: 2,
      inputTokens: 3000,
      outputTokens: 5000,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 600,
      totalTokens: 8600,
      filesFound: 1,
      filesInspected: 1,
      recordsRead: 10,
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
      days: [],
      modelUsage: [
        {
          model: 'gpt-5.4-2026-05-13',
          assistantMessages: 1,
          inputTokens: 1000,
          outputTokens: 2000,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 3300
        },
        {
          model: '<synthetic>:o3-20260513',
          assistantMessages: 1,
          inputTokens: 2000,
          outputTokens: 3000,
          cacheCreationInputTokens: 300,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 5300
        }
      ]
    };

    const model = buildUsageDashboardModel({
      states: [codexState],
      codexCorrelatedHistory: codexCorrelatedHistory,
      enabledProviders: ['codex']
    });

    const apiEq = model.details.cards.find(c => c.key === 'codexHistoryApiEquivalent');
    assert.ok(apiEq, 'codexHistoryApiEquivalent card present');
    assert.equal(apiEq.available, true, 'codexHistoryApiEquivalent card available');
    assert.ok(apiEq.value.startsWith('$'), `codexHistoryApiEquivalent value starts with $, got ${apiEq.value}`);
    const historyEstimate = estimateAggregateCostUsd(costRowsFromModels(codexCorrelatedHistory.modelUsage), false);
    assert.equal(historyEstimate.fallbackCount, 1, 'codex history estimate records one fallback-priced model');
    assert.equal(historyEstimate.totalCount, 2, 'codex history estimate evaluates both model rows');
  }

  console.log('dashboard pricing card smoke passed');
}

main();
