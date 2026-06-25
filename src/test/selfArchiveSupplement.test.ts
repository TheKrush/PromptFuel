import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeHistoryChart } from '../panel/dashboard/historyChart';
import type { UsageHistoryPoint } from '../panel/usageHistoryBinning';
import { buildUsageHistoryRangeViews } from '../panel/usageHistoryBinning';
import type { ClaudeHistoryModelUsage, ClaudeHistoryUsageBucket, ClaudeUsageHistory } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory, CodexCorrelatedHistoryBucket, CodexCorrelatedHistoryModelUsage } from '../providers/codexCorrelatedDayBucketScanner';
import { buildRemoteUsageProjection } from '../snapshot/remoteUsageProjection';
import { filterSelfSourceIds, filterSelfSnapshots, supplementLocalHistoryWithSelfArchives } from '../snapshot/selfArchiveSupplement';
import { SNAPSHOT_SCHEMA_V1, type SanitizedHistorySource, type SnapshotHistoryBucket, type SnapshotProviderName } from '../snapshot/types';
import type { ValidatedSnapshot } from '../snapshot/readMachineSnapshots';

function source(
  machineLabel: string,
  provider: SnapshotProviderName,
  historyBuckets: SnapshotHistoryBucket[]
): SanitizedHistorySource {
  return {
    provider,
    sourceLabel: provider === 'claude' ? 'Claude' : 'Codex',
    machineLabel,
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    quotaOnly: false,
    stale: false,
    historyBuckets
  };
}

function bucket(
  dateKey: string,
  tokens: number,
  provider: SnapshotProviderName = 'claude',
  model = provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.5'
): SnapshotHistoryBucket {
  return {
    dateKey,
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    ...(provider === 'codex' ? { turns: tokens > 0 ? 1 : 0 } : { messages: tokens > 0 ? 1 : 0 }),
    models: tokens > 0 ? [{
      model,
      inputTokens: tokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      ...(provider === 'codex' ? { turns: 1 } : { messages: 1 })
    }] : []
  };
}

function claudeDay(dateKey: string, tokens: number, model = 'claude-local'): ClaudeHistoryUsageBucket {
  const modelUsage: ClaudeHistoryModelUsage[] = tokens > 0 ? [{
    model,
    assistantMessages: 1,
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: tokens
  }] : [];

  return {
    available: tokens > 0,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: tokens > 0 ? 1 : 0,
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: tokens,
    models: modelUsage.map(model => model.model),
    modelUsage,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: tokens > 0 ? 1 : 0,
    recordsMatched: tokens > 0 ? 1 : 0,
    fileReadErrors: 0
  };
}

function codexDay(dateKey: string, tokens: number, model = 'gpt-local'): CodexCorrelatedHistoryBucket {
  const modelUsage: CodexCorrelatedHistoryModelUsage[] = tokens > 0 ? [{
    model,
    assistantMessages: 1,
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens
  }] : [];

  return {
    available: tokens > 0,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: tokens > 0 ? 1 : 0,
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
    models: modelUsage.map(model => model.model),
    modelUsage,
    correlatedTurns: tokens > 0 ? 1 : 0,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: tokens > 0 ? 1 : 0,
    recordsMatched: tokens > 0 ? 1 : 0,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

function claudeHistory(days: ClaudeHistoryUsageBucket[]): ClaudeUsageHistory {
  const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
  return {
    available: days.some(day => day.totalTokens > 0),
    rangeLabel: '365d',
    totalDays: 365,
    activeDays: days.filter(day => day.totalTokens > 0).length,
    days,
    assistantMessages: days.reduce((sum, day) => sum + day.assistantMessages, 0),
    inputTokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: inputTokens,
    modelUsage: days.flatMap(day => day.modelUsage),
    filesFound: 1,
    filesInspected: 1,
    recordsRead: days.reduce((sum, day) => sum + day.recordsRead, 0),
    recordsMatched: days.reduce((sum, day) => sum + day.recordsMatched, 0),
    fileReadErrors: 0
  };
}

function codexHistory(days: CodexCorrelatedHistoryBucket[]): CodexCorrelatedHistory {
  const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
  return {
    available: days.some(day => day.totalTokens > 0),
    rangeLabel: '365d',
    totalDays: 365,
    activeDays: days.filter(day => day.totalTokens > 0).length,
    days,
    assistantMessages: days.reduce((sum, day) => sum + day.assistantMessages, 0),
    inputTokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens,
    modelUsage: days.flatMap(day => day.modelUsage),
    filesFound: 1,
    filesInspected: 1,
    recordsRead: days.reduce((sum, day) => sum + day.recordsRead, 0),
    recordsMatched: days.reduce((sum, day) => sum + day.recordsMatched, 0),
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0,
    skippedTokenCountOutsideTurn: 0,
    skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0
  };
}

function total(points: UsageHistoryPoint[]): number {
  return points.reduce((sum, point) => sum + point.totalTokens, 0);
}

function snapshot(machineLabel: string): ValidatedSnapshot {
  return {
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_V1,
      writerVersion: '1.0.7',
      generatedAtEpochMs: Date.now(),
      machineLabel,
      providerUsage: []
    },
    filePath: `${machineLabel}-latest.json`,
    stale: false
  };
}

describe('self archive history supplement', () => {
  it('fills missing local Claude days from the self archive', () => {
    const result = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [source('PHOENIX', 'claude', [bucket('2026-04-23', 1000)])],
      claudeUsageHistory: claudeHistory([])
    });

    assert.equal(result.claudeUsageHistory?.days.length, 1);
    assert.equal(result.claudeUsageHistory?.days[0].dateKey, '2026-04-23');
    assert.equal(result.claudeUsageHistory?.days[0].totalTokens, 1000);
  });

  it('does not create disabled local provider lanes from self archives', () => {
    const claudeDisabled = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [
        source('PHOENIX', 'claude', [bucket('2026-04-23', 1000)]),
        source('PHOENIX', 'codex', [bucket('2026-04-23', 2000, 'codex')])
      ],
      codexCorrelatedHistory: codexHistory([])
    });
    assert.equal(claudeDisabled.claudeUsageHistory, undefined);
    assert.equal(claudeDisabled.codexCorrelatedHistory?.days.length, 1);
    assert.equal(claudeDisabled.codexCorrelatedHistory?.days[0].totalTokens, 2000);

    const codexDisabled = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [
        source('PHOENIX', 'claude', [bucket('2026-04-24', 3000)]),
        source('PHOENIX', 'codex', [bucket('2026-04-24', 4000, 'codex')])
      ],
      claudeUsageHistory: claudeHistory([])
    });
    assert.equal(codexDisabled.codexCorrelatedHistory, undefined);
    assert.equal(codexDisabled.claudeUsageHistory?.days.length, 1);
    assert.equal(codexDisabled.claudeUsageHistory?.days[0].totalTokens, 3000);
  });

  it('does not double count when local and self archive share the same provider/date', () => {
    const result = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [source('PHOENIX', 'claude', [bucket('2026-05-20', 9000)])],
      claudeUsageHistory: claudeHistory([claudeDay('2026-05-20', 200)])
    });

    assert.equal(result.claudeUsageHistory?.days.length, 1);
    assert.equal(result.claudeUsageHistory?.days[0].totalTokens, 200);
    assert.equal(result.claudeUsageHistory?.totalTokens, 200);
  });

  it('uses self archive when the local same-date bucket is empty', () => {
    const result = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [source('PHOENIX', 'claude', [bucket('2026-05-21', 1200)])],
      claudeUsageHistory: claudeHistory([claudeDay('2026-05-21', 0)])
    });

    assert.equal(result.claudeUsageHistory?.days.length, 1);
    assert.equal(result.claudeUsageHistory?.days[0].totalTokens, 1200);
    assert.equal(result.claudeUsageHistory?.days[0].models[0], 'claude-sonnet-4-6');
  });

  it('leaves selected non-self remote projection semantics intact and excludes unselected disabled sources', () => {
    const sources = [
      source('PHOENIX', 'claude', [bucket('2026-04-23', 1000)]),
      source('WATCHER', 'codex', [bucket('2026-06-20', 700, 'codex')]),
      source('laptop', 'claude', [bucket('2026-05-01', 500)])
    ];

    const projection = buildRemoteUsageProjection(sources, new Set(['WATCHER/codex']));

    assert.equal(projection.codexHistoryPoints.length, 1);
    assert.equal(projection.codexHistoryPoints[0].dateKey, '2026-06-20');
    assert.equal(projection.codexHistoryPoints[0].totalTokens, 700);
    assert.equal(projection.claudeHistoryPoints.length, 0);
  });

  it('filters self source IDs and snapshots out of visible remote surfaces', () => {
    assert.deepEqual(
      filterSelfSourceIds(['PHOENIX/claude', 'WATCHER/codex', 'PHOENIX/codex'], 'PHOENIX'),
      ['WATCHER/codex']
    );
    assert.deepEqual(
      filterSelfSnapshots([snapshot('PHOENIX'), snapshot('WATCHER')], 'PHOENIX').map(item => item.snapshot.machineLabel),
      ['WATCHER']
    );
  });

  it('does not filter visible remote sources when machine label is empty or missing', () => {
    const sourceIds = ['PHOENIX/claude', 'WATCHER/codex', 'PHOENIX/codex'];
    const snapshots = [snapshot('PHOENIX'), snapshot('WATCHER')];

    assert.deepEqual(filterSelfSourceIds(sourceIds, ''), sourceIds);
    assert.deepEqual(filterSelfSourceIds(sourceIds, undefined), sourceIds);
    assert.deepEqual(filterSelfSnapshots(snapshots, '').map(item => item.snapshot.machineLabel), ['PHOENIX', 'WATCHER']);
    assert.deepEqual(filterSelfSnapshots(snapshots, undefined).map(item => item.snapshot.machineLabel), ['PHOENIX', 'WATCHER']);
  });

  it('ignores empty Codex marker buckets', () => {
    const result = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [source('PHOENIX', 'codex', [{ dateKey: '2026-06-01' }])],
      codexCorrelatedHistory: codexHistory([])
    });

    assert.equal(result.codexCorrelatedHistory?.days.length, 0);
    assert.equal(result.codexCorrelatedHistory?.totalTokens, 0);
    assert.equal(result.codexCorrelatedHistory?.activeDays, 0);
  });

  it('feeds restored April Claude data into 1Y weekly bins without a PHOENIX remote source', () => {
    const result = supplementLocalHistoryWithSelfArchives({
      machineLabel: 'PHOENIX',
      archiveSources: [source('PHOENIX', 'claude', [
        bucket('2026-04-23', 1000),
        bucket('2026-05-20', 9000)
      ])],
      claudeUsageHistory: claudeHistory([claudeDay('2026-05-20', 200)])
    });

    const chart = buildClaudeHistoryChart(result.claudeUsageHistory, undefined, undefined, undefined, 'Claude');
    const oneYear = buildUsageHistoryRangeViews(chart.points, '2026-06-24')['1Y'];
    const aprilBin = oneYear.points.find(point =>
      point.binStartDateKey === '2026-04-22' &&
      point.binEndDateKey === '2026-04-28'
    );

    assert.ok(aprilBin);
    assert.equal(aprilBin.totalTokens, 1000);
    assert.equal(total(oneYear.points), 1200);
    assert.equal(oneYear.activeBinCount, 2);
  });
});
