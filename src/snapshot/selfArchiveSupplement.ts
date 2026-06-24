import type { ClaudeHistoryModelUsage, ClaudeHistoryUsageBucket, ClaudeUsageHistory } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory, CodexCorrelatedHistoryBucket, CodexCorrelatedHistoryModelUsage } from '../providers/codexCorrelatedDayBucketScanner';
import type { ValidatedSnapshot } from './readMachineSnapshots';
import { cloneSnapshotHistoryBucket, shouldReplaceHistoryBucket } from './historyBucketMerge';
import type { SanitizedHistorySource, SnapshotBucketModel, SnapshotHistoryBucket, SnapshotProviderName } from './types';
import { displayTotalTokens, normalizeTokenComponents, sumTokens, type NormalizedTokenComponents } from './tokenMath';

export interface LocalHistorySupplementResult {
  claudeUsageHistory?: ClaudeUsageHistory;
  codexCorrelatedHistory?: CodexCorrelatedHistory;
}

interface SupplementOptions {
  machineLabel: string;
  archiveSources: SanitizedHistorySource[];
  claudeUsageHistory?: ClaudeUsageHistory;
  codexCorrelatedHistory?: CodexCorrelatedHistory;
}

export function filterSelfSourceIds(
  sourceIds: ReadonlyArray<string>,
  machineLabel: string
): string[] {
  if (!machineLabel) {
    return [...sourceIds];
  }
  const selfPrefix = `${machineLabel}/`;
  return sourceIds.filter(sourceId => !sourceId.startsWith(selfPrefix));
}

export function filterSelfSnapshots(
  snapshots: ReadonlyArray<ValidatedSnapshot>,
  machineLabel: string
): ValidatedSnapshot[] {
  if (!machineLabel) {
    return [...snapshots];
  }
  return snapshots.filter(snapshot => snapshot.snapshot.machineLabel !== machineLabel);
}

export function supplementLocalHistoryWithSelfArchives(
  options: SupplementOptions
): LocalHistorySupplementResult {
  const selfArchiveSources = options.archiveSources.filter(source =>
    source.machineLabel === options.machineLabel &&
    !source.stale &&
    (source.provider === 'claude' || source.provider === 'codex')
  );

  if (selfArchiveSources.length === 0) {
    return {
      claudeUsageHistory: options.claudeUsageHistory,
      codexCorrelatedHistory: options.codexCorrelatedHistory
    };
  }

  return {
    claudeUsageHistory: supplementClaudeHistory(
      options.claudeUsageHistory,
      collectSelfArchiveBuckets(selfArchiveSources, 'claude')
    ),
    codexCorrelatedHistory: supplementCodexHistory(
      options.codexCorrelatedHistory,
      collectSelfArchiveBuckets(selfArchiveSources, 'codex')
    )
  };
}

function collectSelfArchiveBuckets(
  sources: SanitizedHistorySource[],
  provider: SnapshotProviderName
): SnapshotHistoryBucket[] {
  const byDate = new Map<string, SnapshotHistoryBucket>();

  for (const source of sources) {
    if (source.provider !== provider) {
      continue;
    }
    for (const bucket of source.historyBuckets ?? []) {
      const cloned = cloneSnapshotHistoryBucket(bucket);
      if (!cloned || !snapshotBucketHasData(cloned)) {
        continue;
      }
      const existing = byDate.get(cloned.dateKey);
      if (!existing || shouldReplaceHistoryBucket(existing, cloned)) {
        byDate.set(cloned.dateKey, cloned);
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function supplementClaudeHistory(
  history: ClaudeUsageHistory | undefined,
  archiveBuckets: SnapshotHistoryBucket[]
): ClaudeUsageHistory | undefined {
  if (archiveBuckets.length === 0) {
    return history;
  }

  const daysByDate = new Map<string, ClaudeHistoryUsageBucket>();
  for (const day of history?.days ?? []) {
    daysByDate.set(day.dateKey, cloneClaudeDay(day));
  }

  for (const bucket of archiveBuckets) {
    const existing = daysByDate.get(bucket.dateKey);
    if (existing && localClaudeDayHasData(existing)) {
      continue;
    }
    daysByDate.set(bucket.dateKey, snapshotBucketToClaudeDay(bucket));
  }

  return rebuildClaudeHistory(history, Array.from(daysByDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)));
}

function supplementCodexHistory(
  history: CodexCorrelatedHistory | undefined,
  archiveBuckets: SnapshotHistoryBucket[]
): CodexCorrelatedHistory | undefined {
  if (archiveBuckets.length === 0) {
    return history;
  }

  const daysByDate = new Map<string, CodexCorrelatedHistoryBucket>();
  for (const day of history?.days ?? []) {
    daysByDate.set(day.dateKey, cloneCodexDay(day));
  }

  for (const bucket of archiveBuckets) {
    const existing = daysByDate.get(bucket.dateKey);
    if (existing && localCodexDayHasData(existing)) {
      continue;
    }
    daysByDate.set(bucket.dateKey, snapshotBucketToCodexDay(bucket));
  }

  return rebuildCodexHistory(history, Array.from(daysByDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)));
}

function snapshotBucketHasData(bucket: SnapshotHistoryBucket): boolean {
  if (displayTotalTokens(bucket) > 0) {
    return true;
  }
  const activity = bucket.messages ?? bucket.turns ?? bucket.requests ?? 0;
  if (activity > 0) {
    return true;
  }
  return (bucket.models ?? []).some(model => displayTotalTokens(model) > 0);
}

function localClaudeDayHasData(day: ClaudeHistoryUsageBucket): boolean {
  return day.totalTokens > 0 ||
    day.assistantMessages > 0 ||
    day.recordsMatched > 0 ||
    day.modelUsage.some(model => model.totalTokens > 0 || model.assistantMessages > 0);
}

function localCodexDayHasData(day: CodexCorrelatedHistoryBucket): boolean {
  return day.totalTokens > 0 ||
    day.correlatedTurns > 0 ||
    day.assistantMessages > 0 ||
    day.recordsMatched > 0 ||
    day.modelUsage.some(model => model.totalTokens > 0 || model.assistantMessages > 0);
}

function bucketTokenComponents(bucket: SnapshotHistoryBucket): NormalizedTokenComponents {
  const direct = normalizeTokenComponents(bucket);
  if (displayTotalTokens(bucket) > 0) {
    return direct;
  }
  return (bucket.models ?? []).reduce<NormalizedTokenComponents>((acc, model) => sumTokens(acc, model), {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningOutputTokens: 0
  });
}

function snapshotBucketActivity(bucket: SnapshotHistoryBucket, provider: SnapshotProviderName): number {
  return provider === 'codex'
    ? bucket.turns ?? bucket.requests ?? bucket.messages ?? 0
    : bucket.messages ?? bucket.turns ?? bucket.requests ?? 0;
}

function snapshotModelActivity(model: SnapshotBucketModel, provider: SnapshotProviderName): number {
  return provider === 'codex'
    ? model.turns ?? model.requests ?? model.messages ?? 0
    : model.messages ?? model.turns ?? model.requests ?? 0;
}

function snapshotBucketToClaudeDay(bucket: SnapshotHistoryBucket): ClaudeHistoryUsageBucket {
  const tokens = bucketTokenComponents(bucket);
  const assistantMessages = snapshotBucketActivity(bucket, 'claude');
  const modelUsage = (bucket.models ?? [])
    .map(model => snapshotModelToClaudeModel(model))
    .filter((model): model is ClaudeHistoryModelUsage => model !== undefined)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    available: true,
    dateKey: bucket.dateKey,
    dateLabel: bucket.dateKey,
    assistantMessages,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationInputTokens: tokens.cacheCreationTokens,
    cacheReadInputTokens: tokens.cacheReadTokens,
    totalTokens: displayTotalTokens(tokens),
    models: modelUsage.map(model => model.model),
    modelUsage,
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: Math.max(assistantMessages, modelUsage.length, displayTotalTokens(tokens) > 0 ? 1 : 0),
    fileReadErrors: 0
  };
}

function snapshotModelToClaudeModel(model: SnapshotBucketModel): ClaudeHistoryModelUsage | undefined {
  const tokens = normalizeTokenComponents(model);
  const totalTokens = displayTotalTokens(tokens);
  const assistantMessages = snapshotModelActivity(model, 'claude');
  if (!model.model || (totalTokens <= 0 && assistantMessages <= 0)) {
    return undefined;
  }
  return {
    model: model.model,
    assistantMessages,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationInputTokens: tokens.cacheCreationTokens,
    cacheReadInputTokens: tokens.cacheReadTokens,
    totalTokens
  };
}

function snapshotBucketToCodexDay(bucket: SnapshotHistoryBucket): CodexCorrelatedHistoryBucket {
  const tokens = bucketTokenComponents(bucket);
  const correlatedTurns = snapshotBucketActivity(bucket, 'codex');
  const modelUsage = (bucket.models ?? [])
    .map(model => snapshotModelToCodexModel(model))
    .filter((model): model is CodexCorrelatedHistoryModelUsage => model !== undefined)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    available: true,
    dateKey: bucket.dateKey,
    dateLabel: bucket.dateKey,
    assistantMessages: correlatedTurns,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationInputTokens: tokens.cacheCreationTokens,
    cacheReadInputTokens: tokens.cacheReadTokens,
    reasoningOutputTokens: tokens.reasoningOutputTokens,
    totalTokens: displayTotalTokens(tokens),
    models: modelUsage.map(model => model.model),
    modelUsage,
    correlatedTurns,
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: Math.max(correlatedTurns, modelUsage.length, displayTotalTokens(tokens) > 0 ? 1 : 0),
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };
}

function snapshotModelToCodexModel(model: SnapshotBucketModel): CodexCorrelatedHistoryModelUsage | undefined {
  const tokens = normalizeTokenComponents(model);
  const totalTokens = displayTotalTokens(tokens);
  const assistantMessages = snapshotModelActivity(model, 'codex');
  if (!model.model || (totalTokens <= 0 && assistantMessages <= 0)) {
    return undefined;
  }
  return {
    model: model.model,
    assistantMessages,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationInputTokens: tokens.cacheCreationTokens,
    cacheReadInputTokens: tokens.cacheReadTokens,
    reasoningOutputTokens: tokens.reasoningOutputTokens,
    totalTokens
  };
}

function cloneClaudeDay(day: ClaudeHistoryUsageBucket): ClaudeHistoryUsageBucket {
  return {
    ...day,
    models: [...day.models],
    modelUsage: day.modelUsage.map(model => ({ ...model }))
  };
}

function cloneCodexDay(day: CodexCorrelatedHistoryBucket): CodexCorrelatedHistoryBucket {
  return {
    ...day,
    models: [...day.models],
    modelUsage: day.modelUsage.map(model => ({ ...model }))
  };
}

function rebuildClaudeHistory(
  base: ClaudeUsageHistory | undefined,
  days: ClaudeHistoryUsageBucket[]
): ClaudeUsageHistory {
  const modelUsage = aggregateClaudeModels(days);
  const assistantMessages = days.reduce((sum, day) => sum + day.assistantMessages, 0);
  const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
  const outputTokens = days.reduce((sum, day) => sum + day.outputTokens, 0);
  const cacheCreationInputTokens = days.reduce((sum, day) => sum + day.cacheCreationInputTokens, 0);
  const cacheReadInputTokens = days.reduce((sum, day) => sum + day.cacheReadInputTokens, 0);

  return {
    available: days.some(localClaudeDayHasData),
    rangeLabel: base?.rangeLabel ?? 'Self archive history',
    totalDays: base?.totalDays ?? days.length,
    activeDays: days.filter(localClaudeDayHasData).length,
    days,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    modelUsage,
    filesFound: base?.filesFound ?? 0,
    filesInspected: base?.filesInspected ?? 0,
    recordsRead: base?.recordsRead ?? 0,
    recordsMatched: Math.max(base?.recordsMatched ?? 0, assistantMessages, modelUsage.length),
    fileReadErrors: base?.fileReadErrors ?? 0,
    ...(days.some(localClaudeDayHasData) ? {} : base?.error ? { error: base.error } : {})
  };
}

function rebuildCodexHistory(
  base: CodexCorrelatedHistory | undefined,
  days: CodexCorrelatedHistoryBucket[]
): CodexCorrelatedHistory {
  const modelUsage = aggregateCodexModels(days);
  const assistantMessages = days.reduce((sum, day) => sum + day.assistantMessages, 0);
  const correlatedTurns = days.reduce((sum, day) => sum + day.correlatedTurns, 0);
  const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
  const outputTokens = days.reduce((sum, day) => sum + day.outputTokens, 0);
  const cacheCreationInputTokens = days.reduce((sum, day) => sum + day.cacheCreationInputTokens, 0);
  const cacheReadInputTokens = days.reduce((sum, day) => sum + day.cacheReadInputTokens, 0);
  const reasoningOutputTokens = days.reduce((sum, day) => sum + day.reasoningOutputTokens, 0);

  return {
    available: days.some(localCodexDayHasData),
    rangeLabel: base?.rangeLabel ?? 'Self archive history',
    totalDays: base?.totalDays ?? days.length,
    activeDays: days.filter(localCodexDayHasData).length,
    days,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    modelUsage,
    filesFound: base?.filesFound ?? 0,
    filesInspected: base?.filesInspected ?? 0,
    recordsRead: base?.recordsRead ?? 0,
    recordsMatched: Math.max(base?.recordsMatched ?? 0, correlatedTurns, modelUsage.length),
    fileReadErrors: base?.fileReadErrors ?? 0,
    skippedMissingTokenData: base?.skippedMissingTokenData ?? 0,
    skippedMissingModel: base?.skippedMissingModel ?? 0,
    skippedMissingBaseline: base?.skippedMissingBaseline ?? 0,
    skippedNegativeDelta: base?.skippedNegativeDelta ?? 0,
    skippedTaskStartedWithoutTurnId: base?.skippedTaskStartedWithoutTurnId ?? 0,
    skippedTokenCountOutsideTurn: base?.skippedTokenCountOutsideTurn ?? 0,
    skippedCloseWithoutTurn: base?.skippedCloseWithoutTurn ?? 0,
    skippedCompletionTimestampMissing: base?.skippedCompletionTimestampMissing ?? 0,
    ...(days.some(localCodexDayHasData) ? {} : base?.error ? { error: base.error } : {})
  };
}

function aggregateClaudeModels(days: ClaudeHistoryUsageBucket[]): ClaudeHistoryModelUsage[] {
  const byModel = new Map<string, ClaudeHistoryModelUsage>();
  for (const day of days) {
    for (const model of day.modelUsage) {
      const existing = byModel.get(model.model) ?? {
        model: model.model,
        assistantMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 0
      };
      existing.assistantMessages += model.assistantMessages;
      existing.inputTokens += model.inputTokens;
      existing.outputTokens += model.outputTokens;
      existing.cacheCreationInputTokens += model.cacheCreationInputTokens;
      existing.cacheReadInputTokens += model.cacheReadInputTokens;
      existing.totalTokens += model.totalTokens;
      byModel.set(model.model, existing);
    }
  }
  return Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

function aggregateCodexModels(days: CodexCorrelatedHistoryBucket[]): CodexCorrelatedHistoryModelUsage[] {
  const byModel = new Map<string, CodexCorrelatedHistoryModelUsage>();
  for (const day of days) {
    for (const model of day.modelUsage) {
      const existing = byModel.get(model.model) ?? {
        model: model.model,
        assistantMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
      };
      existing.assistantMessages += model.assistantMessages;
      existing.inputTokens += model.inputTokens;
      existing.outputTokens += model.outputTokens;
      existing.cacheCreationInputTokens += model.cacheCreationInputTokens;
      existing.cacheReadInputTokens += model.cacheReadInputTokens;
      existing.reasoningOutputTokens += model.reasoningOutputTokens;
      existing.totalTokens += model.totalTokens;
      byModel.set(model.model, existing);
    }
  }
  return Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}
