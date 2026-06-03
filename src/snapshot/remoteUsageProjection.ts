import { isSupportedSchemaVersion, type SanitizedHistorySource, type SnapshotHistoryBucket, type SnapshotBucketModel } from './types';
import { displayTotalTokens, sumTokens } from './tokenMath';
import type { UsageHistoryModelUsage, UsageHistoryPoint } from '../panel/usageHistoryBinning';
import { shouldReplaceHistoryBucket } from './historyBucketMerge';

export interface RemoteSourceTodaySummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  assistantMessages?: number;
  sourceCount: number;
  machineLabels: string[];
}

export interface RemoteModelEntry {
  model: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sourceCount: number;
  assistantMessages?: number;
}

export interface RemoteModelAggregationOptions {
  windowDays?: number;
  targetDate?: Date;
}

export interface RemoteUsageProjection {
  claudeToday?: RemoteSourceTodaySummary;
  codexToday?: RemoteSourceTodaySummary;
  claudeTodayModelEntries: RemoteModelEntry[];
  codexTodayModelEntries: RemoteModelEntry[];
  claudeHistoryPoints: UsageHistoryPoint[];
  codexHistoryPoints: UsageHistoryPoint[];
  claudeModelEntries: RemoteModelEntry[];
  codexModelEntries: RemoteModelEntry[];
  /** Machine labels that contributed to each history section (raw labels, before alias resolution). */
  contributingMachineLabels: {
    claudeToday: string[];
    codexToday: string[];
    claudeHistory: string[];
    codexHistory: string[];
    claudeModels: string[];
    codexModels: string[];
  };
}

function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function startDateKeyForWindow(windowDays: number, targetDate: Date): string {
  const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - (windowDays - 1));
  return localDateKey(start);
}

function bucketInModelWindow(bucket: SnapshotHistoryBucket, options?: RemoteModelAggregationOptions): boolean {
  if (!options?.windowDays || options.windowDays <= 0) {
    return true;
  }
  const targetDate = options.targetDate ?? new Date();
  const endKey = localDateKey(targetDate);
  const startKey = startDateKeyForWindow(options.windowDays, targetDate);
  return bucket.dateKey >= startKey && bucket.dateKey <= endKey;
}

function accumulateTodayBucket(
  acc: RemoteSourceTodaySummary | undefined,
  source: SanitizedHistorySource,
  bucket: SnapshotHistoryBucket
): RemoteSourceTodaySummary {
  const tokens = sumTokens(acc, bucket);
  const bucketCount = bucket.messages ?? bucket.turns;
  const accCount = acc?.assistantMessages;
  const assistantMessages =
    bucketCount !== undefined || accCount !== undefined
      ? (accCount ?? 0) + (bucketCount ?? 0)
      : undefined;

  if (!acc) {
    return {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheCreationTokens: tokens.cacheCreationTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      reasoningOutputTokens: tokens.reasoningOutputTokens,
      ...(assistantMessages !== undefined ? { assistantMessages } : {}),
      sourceCount: 1,
      machineLabels: [source.machineLabel]
    };
  }
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationTokens: tokens.cacheCreationTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    reasoningOutputTokens: tokens.reasoningOutputTokens,
    ...(assistantMessages !== undefined ? { assistantMessages } : {}),
    sourceCount: acc.sourceCount + 1,
    machineLabels: [...acc.machineLabels, source.machineLabel]
  };
}

function bucketToHistoryPoint(
  bucket: SnapshotHistoryBucket,
  provider: 'claude' | 'codex',
  sourceLabel: string
): UsageHistoryPoint {
  const inputTokens = bucket.inputTokens ?? 0;
  const outputTokens = bucket.outputTokens ?? 0;
  const cacheCreationTokens = bucket.cacheCreationTokens ?? 0;
  const cacheReadTokens = bucket.cacheReadTokens ?? 0;
  const totalTokens = displayTotalTokens(bucket);
  const assistantMessages = bucket.messages ?? bucket.turns ?? 0;

  return {
    dateKey: bucket.dateKey,
    label: bucket.dateKey.slice(5),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens: cacheCreationTokens + cacheReadTokens,
    cacheCreationTokens,
    cacheReadTokens,
    assistantMessages,
    models: (bucket.models ?? []).map(bucketModelToHistoryModel).filter((model): model is UsageHistoryModelUsage => model !== undefined),
    providerSegments: [{
      provider,
      label: sourceLabel,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheTokens: cacheCreationTokens + cacheReadTokens,
      cacheCreationTokens,
      cacheReadTokens,
      assistantMessages,
      sourceConfidence: 'snapshotOnly'
    }]
  };
}

function bucketModelToHistoryModel(entry: SnapshotBucketModel): UsageHistoryModelUsage | undefined {
  const totalTokens = displayTotalTokens(entry);
  if (!entry.model || totalTokens <= 0) {
    return undefined;
  }
  return {
    label: entry.model,
    model: entry.model,
    pricingModel: entry.model,
    totalTokens,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationInputTokens: entry.cacheCreationTokens,
    cacheReadInputTokens: entry.cacheReadTokens,
    reasoningOutputTokens: entry.reasoningOutputTokens,
    assistantMessages: entry.messages ?? entry.turns ?? entry.requests ?? 0
  };
}

interface SelectedRemoteBucket {
  source: SanitizedHistorySource;
  bucket: SnapshotHistoryBucket;
}

function collectSelectedBuckets(
  sources: ReadonlyArray<SanitizedHistorySource>,
  selectedSourceIds: Set<string>
): SelectedRemoteBucket[] {
  const byKey = new Map<string, SelectedRemoteBucket>();

  // Callers prepend archive sources before latest sources; equal-completeness ties
  // therefore resolve to latest while fuller archive buckets can survive bounds.
  for (const source of sources) {
    if (source.stale || !isSupportedSchemaVersion(source.schemaVersion)) {
      continue;
    }
    if (!selectedSourceIds.has(`${source.machineLabel}/${source.provider}`)) {
      continue;
    }

    const isClaude = source.provider === 'claude';
    const isCodex = source.provider === 'codex';
    if (!isClaude && !isCodex) {
      continue;
    }

    for (const bucket of source.historyBuckets ?? []) {
      const key = `${source.machineLabel}\0${source.provider}\0${bucket.dateKey}`;
      const existing = byKey.get(key);
      if (!existing || shouldReplaceHistoryBucket(existing.bucket, bucket)) {
        byKey.set(key, { source, bucket });
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.bucket.dateKey.localeCompare(b.bucket.dateKey) ||
    a.source.machineLabel.localeCompare(b.source.machineLabel) ||
    a.source.provider.localeCompare(b.source.provider)
  );
}

export function buildRemoteUsageProjection(
  sources: SanitizedHistorySource[],
  selectedSourceIds: Set<string>,
  modelOptions?: RemoteModelAggregationOptions
): RemoteUsageProjection {
  if (selectedSourceIds.size === 0) {
    return {
      claudeHistoryPoints: [],
      codexHistoryPoints: [],
      claudeTodayModelEntries: [],
      codexTodayModelEntries: [],
      claudeModelEntries: [],
      codexModelEntries: [],
      contributingMachineLabels: {
        claudeToday: [],
        codexToday: [],
        claudeHistory: [],
        codexHistory: [],
        claudeModels: [],
        codexModels: []
      }
    };
  }

  let claudeToday: RemoteSourceTodaySummary | undefined;
  let codexToday: RemoteSourceTodaySummary | undefined;
  const claudeHistoryPoints: UsageHistoryPoint[] = [];
  const codexHistoryPoints: UsageHistoryPoint[] = [];
  const claudeTodayModelMap = new Map<string, RemoteModelEntry>();
  const codexTodayModelMap = new Map<string, RemoteModelEntry>();
  const claudeModelMap = new Map<string, RemoteModelEntry>();
  const codexModelMap = new Map<string, RemoteModelEntry>();
  const claudeHistoryLabels = new Set<string>();
  const codexHistoryLabels = new Set<string>();
  const claudeModelLabels = new Set<string>();
  const codexModelLabels = new Set<string>();
  const todayKey = localDateKey();
  const selectedBuckets = collectSelectedBuckets(sources, selectedSourceIds);

  for (const { source, bucket } of selectedBuckets) {
    const isClaude = source.provider === 'claude';
    const points = isClaude ? claudeHistoryPoints : codexHistoryPoints;
    points.push(bucketToHistoryPoint(bucket, source.provider as 'claude' | 'codex', source.sourceLabel));
    if (bucket.dateKey === todayKey) {
      if (isClaude) {
        claudeToday = accumulateTodayBucket(claudeToday, source, bucket);
        mergeRemoteModelEntries(claudeTodayModelMap, aggregateSnapshotBucketModels([bucket]));
      } else {
        codexToday = accumulateTodayBucket(codexToday, source, bucket);
        mergeRemoteModelEntries(codexTodayModelMap, aggregateSnapshotBucketModels([bucket]));
      }
    }

    const bucketModelEntries = aggregateSnapshotBucketModels([bucket], modelOptions);
    mergeRemoteModelEntries(isClaude ? claudeModelMap : codexModelMap, bucketModelEntries);
    (isClaude ? claudeHistoryLabels : codexHistoryLabels).add(source.machineLabel);
    if (bucketModelEntries.length > 0) {
      (isClaude ? claudeModelLabels : codexModelLabels).add(source.machineLabel);
    }
  }

  return {
    claudeToday,
    codexToday,
    claudeHistoryPoints,
    codexHistoryPoints,
    claudeTodayModelEntries: Array.from(claudeTodayModelMap.values()),
    codexTodayModelEntries: Array.from(codexTodayModelMap.values()),
    claudeModelEntries: Array.from(claudeModelMap.values()),
    codexModelEntries: Array.from(codexModelMap.values()),
    contributingMachineLabels: {
      claudeToday: claudeToday ? claudeToday.machineLabels : [],
      codexToday: codexToday ? codexToday.machineLabels : [],
      claudeHistory: Array.from(claudeHistoryLabels),
      codexHistory: Array.from(codexHistoryLabels),
      claudeModels: Array.from(claudeModelLabels),
      codexModels: Array.from(codexModelLabels)
    }
  };
}

export function aggregateSnapshotBucketModels(
  historyBuckets: ReadonlyArray<SnapshotHistoryBucket> | undefined,
  options?: RemoteModelAggregationOptions
): RemoteModelEntry[] {
  const modelMap = new Map<string, RemoteModelEntry>();
  for (const bucket of historyBuckets ?? []) {
    if (!bucketInModelWindow(bucket, options)) {
      continue;
    }
    for (const entry of bucket.models ?? []) {
      accumulateSnapshotBucketModel(modelMap, entry);
    }
  }
  return Array.from(modelMap.values()).sort((a, b) => b.tokens - a.tokens);
}

function accumulateSnapshotBucketModel(modelMap: Map<string, RemoteModelEntry>, entry: SnapshotBucketModel): void {
  const tokens = displayTotalTokens(entry);
  if (!entry.model || tokens <= 0) {
    return;
  }
  const assistantMessages = entry.messages ?? entry.turns ?? entry.requests;
  const inputTokens = entry.inputTokens ?? 0;
  const outputTokens = entry.outputTokens ?? 0;
  const cacheCreationTokens = entry.cacheCreationTokens ?? 0;
  const cacheReadTokens = entry.cacheReadTokens ?? 0;
  const existing = modelMap.get(entry.model);
  if (existing) {
    existing.tokens += tokens;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheCreationTokens += cacheCreationTokens;
    existing.cacheReadTokens += cacheReadTokens;
    existing.sourceCount++;
    if (assistantMessages !== undefined) {
      existing.assistantMessages = (existing.assistantMessages ?? 0) + assistantMessages;
    }
  } else {
    modelMap.set(entry.model, {
      model: entry.model,
      tokens,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      sourceCount: 1,
      ...(assistantMessages !== undefined ? { assistantMessages } : {})
    });
  }
}

function mergeRemoteModelEntries(modelMap: Map<string, RemoteModelEntry>, entries: RemoteModelEntry[]): void {
  for (const entry of entries) {
    const existing = modelMap.get(entry.model);
    if (existing) {
      existing.tokens += entry.tokens;
      existing.inputTokens += entry.inputTokens;
      existing.outputTokens += entry.outputTokens;
      existing.cacheCreationTokens += entry.cacheCreationTokens;
      existing.cacheReadTokens += entry.cacheReadTokens;
      existing.sourceCount += entry.sourceCount;
      if (entry.assistantMessages !== undefined) {
        existing.assistantMessages = (existing.assistantMessages ?? 0) + entry.assistantMessages;
      }
    } else {
      modelMap.set(entry.model, { ...entry });
    }
  }
}
