import type { ProviderUsageState } from '../../types';
import type { ClaudeHistoryModelUsage, ClaudeTodayUsageBucket, ClaudeUsageHistory } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket, CodexCorrelatedHistory, CodexCorrelatedHistoryModelUsage } from '../../providers/codexCorrelatedDayBucketScanner';
import type { SanitizedHistorySource, SnapshotHistoryBucket, SnapshotBucketModel } from '../../snapshot/types';
import { SNAPSHOT_SCHEMA_V2 } from '../../snapshot/types';
import { buildRemoteUsageProjection } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens } from '../../snapshot/tokenMath';

export interface CanonicalUsageFixture {
  targetDate: Date;
  todayKey: string;
  priorKey: string;
  states: ProviderUsageState[];
  claudeToday: ClaudeTodayUsageBucket;
  codexToday: CodexCorrelatedDayBucket;
  claudeHistory: ClaudeUsageHistory;
  codexHistory: CodexCorrelatedHistory;
  remoteSources: SanitizedHistorySource[];
  selectedRemoteSourceIds: Set<string>;
  remoteProjection: ReturnType<typeof buildRemoteUsageProjection>;
  expected: {
    claudeTodayTokens: number;
    codexTodayTokens: number;
    claudeHistoryTokens: number;
    codexHistoryTokens: number;
    claudeModelDistributionTokens: number;
    codexModelDistributionTokens: number;
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localModel(model: string, inputTokens: number, outputTokens: number, cacheCreationInputTokens: number, cacheReadInputTokens: number, assistantMessages: number, reasoningOutputTokens = 0) {
  return {
    model,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningOutputTokens,
    totalTokens: displayTotalTokens({ inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, reasoningOutputTokens })
  };
}

function remoteModel(model: string, inputTokens: number, outputTokens: number, cacheCreationTokens: number, cacheReadTokens: number, messages: number, reasoningOutputTokens = 0): SnapshotBucketModel {
  return {
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningOutputTokens,
    messages
  };
}

function sumLocalModels<T extends ClaudeHistoryModelUsage | CodexCorrelatedHistoryModelUsage>(models: T[]) {
  return models.reduce((sum, model) => ({
    inputTokens: sum.inputTokens + model.inputTokens,
    outputTokens: sum.outputTokens + model.outputTokens,
    cacheCreationInputTokens: sum.cacheCreationInputTokens + model.cacheCreationInputTokens,
    cacheReadInputTokens: sum.cacheReadInputTokens + model.cacheReadInputTokens,
    reasoningOutputTokens: sum.reasoningOutputTokens + ('reasoningOutputTokens' in model ? model.reasoningOutputTokens : 0),
    assistantMessages: sum.assistantMessages + model.assistantMessages,
    totalTokens: sum.totalTokens + displayTotalTokens(model)
  }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    assistantMessages: 0,
    totalTokens: 0
  });
}

function sumRemoteModels(models: SnapshotBucketModel[]) {
  return models.reduce((sum, model) => ({
    inputTokens: sum.inputTokens + (model.inputTokens ?? 0),
    outputTokens: sum.outputTokens + (model.outputTokens ?? 0),
    cacheCreationTokens: sum.cacheCreationTokens + (model.cacheCreationTokens ?? 0),
    cacheReadTokens: sum.cacheReadTokens + (model.cacheReadTokens ?? 0),
    reasoningOutputTokens: sum.reasoningOutputTokens + (model.reasoningOutputTokens ?? 0),
    messages: sum.messages + (model.messages ?? 0),
    totalTokens: sum.totalTokens + displayTotalTokens(model)
  }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningOutputTokens: 0,
    messages: 0,
    totalTokens: 0
  });
}

function makeClaudeDay(dateKey: string, modelUsage: ClaudeHistoryModelUsage[]): ClaudeTodayUsageBucket {
  const totals = sumLocalModels(modelUsage);
  return {
    available: totals.assistantMessages > 0,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: totals.assistantMessages,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    totalTokens: totals.totalTokens,
    models: modelUsage.map(model => model.model),
    modelUsage,
    filesFound: 2,
    filesInspected: 2,
    recordsRead: totals.assistantMessages,
    recordsMatched: totals.assistantMessages,
    fileReadErrors: 0
  };
}

function makeCodexDay(dateKey: string, modelUsage: CodexCorrelatedHistoryModelUsage[]): CodexCorrelatedDayBucket {
  const totals = sumLocalModels(modelUsage);
  return {
    available: totals.assistantMessages > 0,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: totals.assistantMessages,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    reasoningOutputTokens: totals.reasoningOutputTokens,
    totalTokens: totals.totalTokens,
    models: modelUsage.map(model => model.model),
    modelUsage,
    correlatedTurns: totals.assistantMessages,
    filesFound: 2,
    filesInspected: 2,
    recordsRead: totals.assistantMessages,
    recordsMatched: totals.assistantMessages,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

function mergeLocalModelUsage<T extends ClaudeHistoryModelUsage | CodexCorrelatedHistoryModelUsage>(days: Array<{ modelUsage?: T[] }>): T[] {
  const byModel = new Map<string, T>();
  for (const day of days) {
    for (const model of day.modelUsage ?? []) {
      const existing = byModel.get(model.model);
      if (existing) {
        existing.assistantMessages += model.assistantMessages;
        existing.inputTokens += model.inputTokens;
        existing.outputTokens += model.outputTokens;
        existing.cacheCreationInputTokens += model.cacheCreationInputTokens;
        existing.cacheReadInputTokens += model.cacheReadInputTokens;
        if ('reasoningOutputTokens' in existing && 'reasoningOutputTokens' in model) {
          existing.reasoningOutputTokens += model.reasoningOutputTokens;
        }
        existing.totalTokens += displayTotalTokens(model);
      } else {
        byModel.set(model.model, { ...model, totalTokens: displayTotalTokens(model) });
      }
    }
  }
  return Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

function makeRemoteBucket(dateKey: string, models: SnapshotBucketModel[]): SnapshotHistoryBucket {
  const totals = sumRemoteModels(models);
  return {
    dateKey,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    reasoningOutputTokens: totals.reasoningOutputTokens,
    messages: totals.messages,
    models
  };
}

export function createCanonicalUsageFixture(targetDate = new Date()): CanonicalUsageFixture {
  const todayKey = localDateKey(targetDate);
  const priorDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - 1);
  const priorKey = localDateKey(priorDate);

  const claudeToday = makeClaudeDay(todayKey, [
    localModel('claude-sonnet-4-20250514', 1000, 500, 200, 50, 2),
    localModel('claude-opus-4-20250514', 600, 300, 100, 25, 1)
  ]);
  const claudePrior = makeClaudeDay(priorKey, [
    localModel('claude-sonnet-4-20250514', 500, 250, 100, 25, 1),
    localModel('claude-opus-4-20250514', 300, 150, 50, 10, 1)
  ]);
  const codexToday = makeCodexDay(todayKey, [
    localModel('gpt-5.5', 2000, 1000, 400, 100, 2, 300),
    localModel('gpt-5.4', 1000, 500, 100, 50, 1, 100)
  ]);
  const codexPrior = makeCodexDay(priorKey, [
    localModel('gpt-5.5', 400, 200, 50, 25, 1, 40),
    localModel('gpt-5.4', 300, 150, 40, 20, 1, 30)
  ]);

  const claudeHistory: ClaudeUsageHistory = {
    available: true,
    rangeLabel: `${priorKey} to ${todayKey}`,
    totalDays: 2,
    activeDays: 2,
    days: [claudePrior, claudeToday].map(day => ({ ...day, modelUsage: day.modelUsage ?? [] })),
    assistantMessages: claudePrior.assistantMessages + claudeToday.assistantMessages,
    inputTokens: claudePrior.inputTokens + claudeToday.inputTokens,
    outputTokens: claudePrior.outputTokens + claudeToday.outputTokens,
    cacheCreationInputTokens: claudePrior.cacheCreationInputTokens + claudeToday.cacheCreationInputTokens,
    cacheReadInputTokens: claudePrior.cacheReadInputTokens + claudeToday.cacheReadInputTokens,
    totalTokens: displayTotalTokens(claudePrior) + displayTotalTokens(claudeToday),
    modelUsage: mergeLocalModelUsage([claudePrior, claudeToday]),
    filesFound: 2,
    filesInspected: 2,
    recordsRead: 5,
    recordsMatched: 5,
    fileReadErrors: 0
  };

  const codexHistory: CodexCorrelatedHistory = {
    available: true,
    rangeLabel: `${priorKey} to ${todayKey}`,
    totalDays: 2,
    activeDays: 2,
    days: [codexPrior, codexToday].map(day => ({ ...day, modelUsage: day.modelUsage ?? [] })),
    assistantMessages: codexPrior.assistantMessages + codexToday.assistantMessages,
    inputTokens: codexPrior.inputTokens + codexToday.inputTokens,
    outputTokens: codexPrior.outputTokens + codexToday.outputTokens,
    cacheCreationInputTokens: codexPrior.cacheCreationInputTokens + codexToday.cacheCreationInputTokens,
    cacheReadInputTokens: codexPrior.cacheReadInputTokens + codexToday.cacheReadInputTokens,
    reasoningOutputTokens: codexPrior.reasoningOutputTokens + codexToday.reasoningOutputTokens,
    totalTokens: displayTotalTokens(codexPrior) + displayTotalTokens(codexToday),
    modelUsage: mergeLocalModelUsage([codexPrior, codexToday]),
    filesFound: 2,
    filesInspected: 2,
    recordsRead: 6,
    recordsMatched: 6,
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

  const remoteSources: SanitizedHistorySource[] = [{
    provider: 'claude',
    sourceLabel: 'Claude (vm-source)',
    machineLabel: 'vm-source',
    schemaVersion: SNAPSHOT_SCHEMA_V2,
    quotaOnly: false,
    stale: false,
    historyBuckets: [
      makeRemoteBucket(priorKey, [
        remoteModel('claude-sonnet-4-20250514', 200, 100, 25, 10, 1, 15),
        remoteModel('claude-opus-4-20250514', 500, 250, 100, 40, 1, 20)
      ]),
      makeRemoteBucket(todayKey, [
        remoteModel('claude-sonnet-4-20250514', 400, 200, 50, 25, 1, 30),
        remoteModel('claude-haiku-4-5', 300, 100, 25, 10, 1, 10)
      ])
    ]
  }, {
    provider: 'codex',
    sourceLabel: 'Codex (workstation)',
    machineLabel: 'workstation',
    schemaVersion: SNAPSHOT_SCHEMA_V2,
    quotaOnly: false,
    stale: false,
    historyBuckets: [
      makeRemoteBucket(priorKey, [
        remoteModel('gpt-5.5', 500, 250, 50, 25, 1, 60),
        remoteModel('gpt-5.3-codex', 300, 150, 25, 10, 1, 25)
      ]),
      makeRemoteBucket(todayKey, [
        remoteModel('gpt-5.5', 800, 400, 100, 50, 1, 75),
        remoteModel('gpt-5.3-codex', 600, 300, 50, 25, 1, 40)
      ])
    ]
  }];

  const selectedRemoteSourceIds = new Set(['vm-source/claude', 'workstation/codex']);
  const remoteProjection = buildRemoteUsageProjection(remoteSources, selectedRemoteSourceIds, {
    windowDays: 7,
    targetDate
  });

  const states: ProviderUsageState[] = [{
    provider: 'claude',
    source: 'local fixture',
    stale: false,
    fiveHour: { usedPercentage: 25 },
    sevenDay: { usedPercentage: 40 },
    tracing: {
      totalCostUsd: 0.05,
      totalTokens: claudeHistory.totalTokens,
      currentTotalTokens: claudeToday.totalTokens,
      currentInputTokens: claudeToday.inputTokens,
      currentOutputTokens: claudeToday.outputTokens,
      currentCacheCreationInputTokens: claudeToday.cacheCreationInputTokens,
      currentCacheReadInputTokens: claudeToday.cacheReadInputTokens
    }
  }, {
    provider: 'codex',
    source: 'local fixture',
    stale: false,
    fiveHour: { usedPercentage: 15 },
    sevenDay: { usedPercentage: 35 },
    tracing: {
      totalCostUsd: 0.07,
      totalTokens: codexHistory.totalTokens,
      currentTotalTokens: codexToday.totalTokens,
      currentInputTokens: codexToday.inputTokens,
      currentOutputTokens: codexToday.outputTokens,
      currentCacheCreationInputTokens: codexToday.cacheCreationInputTokens,
      currentCacheReadInputTokens: codexToday.cacheReadInputTokens,
      currentReasoningOutputTokens: codexToday.reasoningOutputTokens
    }
  }];

  return {
    targetDate,
    todayKey,
    priorKey,
    states,
    claudeToday,
    codexToday,
    claudeHistory,
    codexHistory,
    remoteSources,
    selectedRemoteSourceIds,
    remoteProjection,
    expected: {
      claudeTodayTokens: displayTotalTokens(claudeToday) + displayTotalTokens(remoteProjection.claudeToday),
      codexTodayTokens: displayTotalTokens(codexToday) + displayTotalTokens(remoteProjection.codexToday),
      claudeHistoryTokens: displayTotalTokens(claudeHistory) + remoteProjection.claudeHistoryPoints.reduce((sum, point) => sum + displayTotalTokens(point), 0),
      codexHistoryTokens: displayTotalTokens(codexHistory) + remoteProjection.codexHistoryPoints.reduce((sum, point) => sum + displayTotalTokens(point), 0),
      claudeModelDistributionTokens: displayTotalTokens(claudeHistory) + remoteProjection.claudeModelEntries.reduce((sum, entry) => sum + entry.tokens, 0),
      codexModelDistributionTokens: displayTotalTokens(codexHistory) + remoteProjection.codexModelEntries.reduce((sum, entry) => sum + entry.tokens, 0)
    }
  };
}
