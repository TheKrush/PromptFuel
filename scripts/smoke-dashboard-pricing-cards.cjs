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
  const now = new Date();
  const historyDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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

  {
    const codexHistoryModelUsage = [
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
    ];
    const codexCorrelatedHistory = {
      available: true,
      rangeLabel: `${historyDateKey} to ${historyDateKey}`,
      totalDays: 1,
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
      days: [{
        dateKey: historyDateKey,
        correlatedTurns: 2,
        inputTokens: 3000,
        outputTokens: 5000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 0,
        reasoningOutputTokens: 600,
        totalTokens: 8600,
        modelUsage: codexHistoryModelUsage
      }],
      modelUsage: codexHistoryModelUsage
    };

    const model = buildUsageDashboardModel({
      states: [codexState],
      codexCorrelatedHistory: codexCorrelatedHistory,
      enabledProviders: ['codex']
    });

    const apiEq = model.details.codexHistoryChart?.rangeViews?.['1M']?.apiEquivalentCard;
    assert.ok(apiEq, 'prepared Codex 1M API-equivalent card present');
    assert.equal(apiEq.available, true, 'prepared Codex 1M API-equivalent card available');
    assert.ok(apiEq.value.startsWith('$'), `prepared Codex 1M API-equivalent value starts with $, got ${apiEq.value}`);
    const historyEstimate = estimateAggregateCostUsd(costRowsFromModels(codexCorrelatedHistory.modelUsage), false);
    assert.equal(historyEstimate.fallbackCount, 1, 'codex history estimate records one fallback-priced model');
    assert.equal(historyEstimate.totalCount, 2, 'codex history estimate evaluates both model rows');
  }

  console.log('dashboard pricing card smoke passed');
}

main();
