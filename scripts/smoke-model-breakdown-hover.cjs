#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { formatStatus } = require('../out/display/format.js');
const {
  STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS,
  aggregateRecentHistoryModelUsage,
  buildStatusHoverModelBreakdown
} = require('../out/display/modelBreakdown.js');
const { buildRemoteUsageProjection } = require('../out/snapshot/remoteUsageProjection.js');
const { SNAPSHOT_SCHEMA_V1 } = require('../out/snapshot/types.js');

function main() {
  const now = Date.now();
  const sevenDayReset = Math.floor((now + (2 * 24 + 8) * 3600) / 1000);
  const fiveHourReset = Math.floor((now + 150 * 60) / 1000);
  const todayKey = (() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();
  const dateKeyFromTodayOffset = offsetDays => {
    const nowDate = new Date();
    const date = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const baseOptions = {
    displayMode: 'standard',
    displayParts: {
      showEmoji: true,
      showProviderNames: true,
      showFiveHour: true,
      showSevenDay: true,
      sevenDayFirst: true,
      showPercentSymbol: true,
      showCountdownInline: false,
      showSourceInline: false,
      showStaleInline: false
    },
    statusMode: 'remaining',
    lowRemainingPercent: 50,
    warnRemainingPercent: 30,
    criticalRemainingPercent: 10,
    emptyRemainingPercent: 1,
    nextResetRefreshEpochMs: now + 120_000
  };

  const baseState = {
    provider: 'claude',
    source: 'local statusLine/hook state',
    lastUpdatedEpochMs: now - 45_000,
    sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
    fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
  };

  const codexState = {
    provider: 'codex',
    source: 'local session snapshot',
    lastUpdatedEpochMs: now - 60_000,
    sevenDay: { usedPercentage: 40, resetsAtEpochSeconds: sevenDayReset },
    fiveHour: { usedPercentage: 10, resetsAtEpochSeconds: fiveHourReset }
  };

  const codexShorten = model => model
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const claudeShorten = model => model
    .replace(/^claude-/, '')
    .replace('-20251001', '')
    .replace('-20250514', '');
  const makeRemoteSource = (overrides = {}) => ({
    provider: 'codex',
    sourceLabel: 'Codex',
    machineLabel: 'vm-source',
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    quotaOnly: false,
    stale: false,
    historyBuckets: [{
      dateKey: todayKey,
      inputTokens: 4000,
      outputTokens: 2000,
      cacheCreationTokens: 700,
      cacheReadTokens: 300,
      reasoningOutputTokens: 5000,
      turns: 3,
      models: [{
        model: 'gpt-5.5',
        inputTokens: 4000,
        outputTokens: 2000,
        cacheCreationTokens: 700,
        cacheReadTokens: 300,
        reasoningOutputTokens: 5000,
        turns: 3
      }]
    }],
    ...overrides
  });
  const buildHoverProjection = (sources, selected) => buildRemoteUsageProjection(
    sources,
    selected,
    { windowDays: STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS }
  );

  {
    const result = formatStatus([baseState], baseOptions);
    assert.ok(!result.tooltip.includes('Models ('), 'no model breakdown section when no breakdown data');
    console.log('PASS: model breakdown section absent when no breakdown data provided');
  }

  {
    const options = {
      ...baseOptions,
      modelBreakdown: {
        claude: [
          { label: 'Sonnet 4.6', totalTokens: 150000, assistantMessages: 45, costUsd: 0.39 }
        ]
      }
    };
    const result = formatStatus([baseState], options);
    assert.ok(result.tooltip.includes('**Models (7d; API-equivalent estimate, not billing)**'));
    assert.ok(result.tooltip.includes('| Provider | Model | Tokens | Msgs/Turns | API est. |'));
    assert.ok(result.tooltip.includes('| Claude | Sonnet 4.6 | **150.0K** | 45 |'));
    assert.ok(result.providers[0].tooltip.includes('**Models** (Claude 7d; API-equivalent estimate, not billing)'));
    console.log('PASS: model breakdown section shows model label, tokens, msgs, and cost');
  }

  {
    const options = {
      ...baseOptions,
      modelBreakdown: {
        claude: [
          { label: 'Large estimate', totalTokens: 999000, assistantMessages: 1, costUsd: 4859.5 },
          { label: 'Medium estimate', totalTokens: 100000, assistantMessages: 1, costUsd: 227.76 },
          { label: 'Small estimate', totalTokens: 90000, assistantMessages: 1, costUsd: 102.05 },
          { label: 'Sub-dollar estimate', totalTokens: 10, assistantMessages: 1, costUsd: 0.004 }
        ]
      }
    };
    const result = formatStatus([baseState], options);
    assert.ok(result.tooltip.includes('$4,859.50'), 'large API estimate uses thousands separator');
    assert.ok(!result.tooltip.includes('$4859.50'), 'large API estimate is not ungrouped');
    assert.ok(result.tooltip.includes('$227.76'), 'medium API estimate remains sane');
    assert.ok(result.tooltip.includes('$102.05'), 'small three-digit API estimate remains sane');
    assert.ok(result.tooltip.includes('&lt;\u00A21'), 'sub-cent API estimate remains explicit');
    console.log('PASS: hover API estimates use sane cost formatting across sizes');
  }

  {
    assert.equal(STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS, 7);
    const history = {
      available: true,
      days: [{
        dateKey: '2026-05-10',
        modelUsage: [{ model: 'old-model', assistantMessages: 99, inputTokens: 9000, outputTokens: 9000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 18000 }]
      }, {
        dateKey: '2026-05-12',
        modelUsage: [{ model: 'claude-sonnet-4-20250514', assistantMessages: 2, inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 50, cacheReadInputTokens: 25, totalTokens: 1275 }]
      }, {
        dateKey: '2026-05-18',
        modelUsage: [{ model: 'claude-sonnet-4-20250514', assistantMessages: 3, inputTokens: 2000, outputTokens: 500, cacheCreationInputTokens: 100, cacheReadInputTokens: 75, totalTokens: 2675 }]
      }]
    };
    const aggregate = aggregateRecentHistoryModelUsage(history, STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS, new Date(2026, 4, 18));
    assert.equal(aggregate.length, 1);
    assert.equal(aggregate[0].model, 'claude-sonnet-4-20250514');
    assert.equal(aggregate[0].assistantMessages, 5);
    assert.equal(aggregate[0].totalTokens, 3950);
    console.log('PASS: hover model aggregate uses 7d bucket data and excludes older history rows');
  }

  {
    const projection = buildHoverProjection([makeRemoteSource()], new Set(['vm-source/codex']));
    const hoverBreakdown = buildStatusHoverModelBreakdown([
      {
        provider: 'codex',
        history: undefined,
        shortenModel: codexShorten,
        estimateCostUsd: model => model.totalTokens / 100000,
        remoteModelEntries: projection.codexModelEntries
      }
    ], new Date());
    assert.equal(hoverBreakdown.codex.length, 1);
    assert.equal(hoverBreakdown.codex[0].label, 'gpt-5.5');
    assert.equal(hoverBreakdown.codex[0].totalTokens, 7000);
    assert.equal(hoverBreakdown.codex[0].assistantMessages, 3);
    assert.equal(hoverBreakdown.codex[0].costUsd, 0.07);

    const result = formatStatus([baseState], { ...baseOptions, modelBreakdown: hoverBreakdown });
    assert.ok(result.tooltip.includes('| Codex | gpt-5.5 | **7.0K** | 3 | ¢7.0 |'));
    assert.ok(result.tooltip.includes('snapshot history included'));
    assert.ok(!result.tooltip.includes('Remote API estimates excluded'));
    console.log('PASS: selected remote historyBuckets model rows appear in hover model table');
  }

  {
    const projection = buildHoverProjection([makeRemoteSource()], new Set(['vm-source/codex']));
    const localHistory = {
      available: true,
      days: [{
        dateKey: todayKey,
        modelUsage: [{
          model: 'gpt-5.5-2026-05-13',
          assistantMessages: 2,
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 3000
        }]
      }]
    };
    const hoverBreakdown = buildStatusHoverModelBreakdown([
      {
        provider: 'codex',
        history: localHistory,
        shortenModel: codexShorten,
        estimateCostUsd: model => model.totalTokens / 100000,
        remoteModelEntries: projection.codexModelEntries
      }
    ], new Date());
    assert.equal(hoverBreakdown.codex.length, 1);
    assert.equal(hoverBreakdown.codex[0].totalTokens, 10000);
    assert.equal(hoverBreakdown.codex[0].assistantMessages, 5);
    assert.equal(hoverBreakdown.codex[0].costUsd, 0.1);
    const result = formatStatus([codexState], { ...baseOptions, modelBreakdown: hoverBreakdown });
    assert.equal((result.tooltip.match(/\| Codex \| gpt-5\.5 \|/g) || []).length, 1);
    assert.ok(result.tooltip.includes('| Codex | gpt-5.5 | **10.0K** | 5 | ¢10.0 |'));
    console.log('PASS: local and remote Codex model rows merge into one hover row');
  }

  {
    const projection = buildHoverProjection([
      makeRemoteSource({
        provider: 'claude',
        sourceLabel: 'Claude',
        machineLabel: 'vm-source',
        historyBuckets: [{
          dateKey: todayKey,
          models: [{
            model: 'claude-sonnet-4-20250514',
            inputTokens: 3000,
            outputTokens: 800,
            cacheCreationTokens: 150,
            cacheReadTokens: 50,
            messages: 4
          }]
        }]
      })
    ], new Set(['vm-source/claude']));
    const localHistory = {
      available: true,
      days: [{
        dateKey: todayKey,
        modelUsage: [{
          model: 'claude-sonnet-4-20250514',
          assistantMessages: 6,
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 6000
        }]
      }]
    };
    const hoverBreakdown = buildStatusHoverModelBreakdown([
      {
        provider: 'claude',
        history: localHistory,
        shortenModel: claudeShorten,
        estimateCostUsd: model => model.totalTokens / 100000,
        remoteModelEntries: projection.claudeModelEntries
      }
    ], new Date());
    assert.equal(hoverBreakdown.claude.length, 1);
    assert.equal(hoverBreakdown.claude[0].label, 'sonnet-4');
    assert.equal(hoverBreakdown.claude[0].totalTokens, 10000);
    assert.equal(hoverBreakdown.claude[0].assistantMessages, 10);
    console.log('PASS: selected remote Claude bucket model rows merge by model identity');
  }

  {
    const unselected = buildHoverProjection([makeRemoteSource({ machineLabel: 'UNSELECTED' })], new Set(['vm-source/codex']));
    assert.equal(unselected.codexModelEntries.length, 0);

    const stale = buildHoverProjection([makeRemoteSource({ stale: true })], new Set(['vm-source/codex']));
    assert.equal(stale.codexModelEntries.length, 0);

    const nonCurrent = buildHoverProjection([makeRemoteSource({ schemaVersion: 99 })], new Set(['vm-source/codex']));
    assert.equal(nonCurrent.codexModelEntries.length, 0);
    console.log('PASS: unselected, stale, and non-current remote sources do not contribute to hover models');
  }

  {
    const projection = buildHoverProjection([makeRemoteSource({
      historyBuckets: [{
        dateKey: dateKeyFromTodayOffset(-8),
        models: [{
          model: 'old-remote-model',
          inputTokens: 9000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          turns: 99
        }]
      }, {
        dateKey: todayKey,
        models: [{
          model: 'gpt-5.5',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 250,
          cacheReadTokens: 100,
          turns: 2
        }]
      }]
    })], new Set(['vm-source/codex']));
    assert.equal(projection.codexModelEntries.length, 1);
    assert.equal(projection.codexModelEntries[0].model, 'gpt-5.5');
    assert.equal(projection.codexModelEntries[0].tokens, 1850);
    console.log('PASS: hover remote model rows come from historyBuckets models inside the 7d window');
  }

  console.log('\nAll model breakdown hover smoke tests passed.');
}

main();
