import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isKnownProvider, type ProviderId } from '../core/providers';
import {
  PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
  IMPORTED_SNAPSHOT_SOURCE_LABEL,
  createEmptySnapshotState,
  safeSnapshotSourceLabel,
  sanitizeSnapshotSourceLabel,
  type PromptFuelSnapshotProviderAggregate,
  type PromptFuelSnapshotState,
} from '../core/snapshotTypes';
import {
  type AggregateUsage,
  type LocalHistoryWindowAggregateMap,
  type LocalHistoryWindowId,
  LOCAL_HISTORY_WINDOW_IDS,
  createEmptyAggregate,
  cloneAggregate,
} from '../core/usageAggregate';
import {
  mergeModelUsageAggregate,
  sortModelUsageAggregates,
  sanitizeModelLabel,
  type ModelUsageAggregate,
  type ModelUsageWindowAggregateMap,
} from '../core/modelUsage';
import type { PromptFuelSnapshotHistoryBucket } from '../core/snapshotTypes';

export interface SnapshotDiagnostics {
  info(message: string): void;
}

export interface ReadPromptFuelSnapshotsOptions {
  snapshotDir: string;
  enabledProviderIds?: ReadonlyArray<string>;
  diagnostics?: SnapshotDiagnostics;
  nowMs?: number;
  localMachineLabel?: string;
  snapshotImportLabels?: ReadonlyArray<string>;
}

export interface ReadPromptFuelSnapshotsResult {
  state: PromptFuelSnapshotState;
  filesRead: number;
  malformedRecords: number;
  unsupportedSchemaVersions: number;
  unknownProviders: number;
  skippedByMachineLabel: number;
}

interface ValidatedPromptFuelSnapshot {
  generatedAtEpochMs: number;
  providers: PromptFuelSnapshotProviderAggregate[];
}

const MAX_SNAPSHOT_FILES = 50;
const MAX_ARCHIVE_FILES = 240;
const SNAPSHOT_IMPORT_SCHEMA_V2 = 2;
const SNAPSHOT_ARCHIVE_SCHEMA_V1 = 1;

export async function readPromptFuelSnapshots(
  options: ReadPromptFuelSnapshotsOptions,
): Promise<ReadPromptFuelSnapshotsResult> {
  const nowMs = options.nowMs ?? Date.now();
  const empty = createReadResult(nowMs);

  let files: string[];
  try {
    files = await collectSnapshotJsonFiles(options.snapshotDir);
  } catch {
    options.diagnostics?.info('snapshot data not found');
    return empty;
  }

  if (files.length === 0) {
    options.diagnostics?.info('snapshot data not found');
    return empty;
  }

  const enabled = options.enabledProviderIds
    ? new Set(options.enabledProviderIds.filter(isKnownProvider))
    : undefined;

  const localLabelNormalized = resolveLocalMachineLabel(options.localMachineLabel);
  const importAllowSet = buildImportAllowSet(options.snapshotImportLabels);

  const providers: PromptFuelSnapshotProviderAggregate[] = [];
  let malformedRecords = 0;
  let unsupportedSchemaVersions = 0;
  let unknownProviders = 0;
  let skippedByMachineLabel = 0;
  let validSnapshotCount = 0;

  for (const fileName of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(fileName, 'utf8'));
    } catch {
      malformedRecords++;
      continue;
    }

    const machineLabel = getImportedSnapshotMachineLabel(parsed);
    if (machineLabel !== undefined) {
      if (machineLabel === localLabelNormalized) {
        skippedByMachineLabel++;
        continue;
      }
      if (importAllowSet.size > 0 && !importAllowSet.has(machineLabel)) {
        skippedByMachineLabel++;
        continue;
      }
    }

    const validation = validatePromptFuelSnapshotPayload(parsed, enabled, nowMs);
    malformedRecords += validation.malformed ? 1 : 0;
    unsupportedSchemaVersions += validation.unsupportedSchemaVersion ? 1 : 0;
    unknownProviders += validation.unknownProviders;

    if (validation.snapshot && validation.snapshot.providers.length > 0) {
      validSnapshotCount++;
      providers.push(...validation.snapshot.providers);
    }
  }

  if (validSnapshotCount > 0) {
    options.diagnostics?.info(
      `snapshot read success; files=${files.length}; snapshots=${validSnapshotCount}; providers=${providers.length}`,
    );
  } else {
    options.diagnostics?.info('snapshot data not found');
  }
  if (malformedRecords > 0) {
    options.diagnostics?.info(`malformed snapshot ignored; count=${malformedRecords}`);
  }
  if (unsupportedSchemaVersions > 0) {
    options.diagnostics?.info(`unsupported snapshot schema version ignored; count=${unsupportedSchemaVersions}`);
  }
  if (unknownProviders > 0) {
    options.diagnostics?.info(`unknown snapshot provider ignored; count=${unknownProviders}`);
  }
  if (skippedByMachineLabel > 0) {
    options.diagnostics?.info(`snapshot skipped (local machine label); count=${skippedByMachineLabel}`);
  }

  return {
    state: {
      providers,
      snapshotCount: validSnapshotCount,
      lastReadEpochMs: nowMs,
    },
    filesRead: files.length,
    malformedRecords,
    unsupportedSchemaVersions,
    unknownProviders,
    skippedByMachineLabel,
  };
}

export function validatePromptFuelSnapshotPayload(
  value: unknown,
  enabledProviderIds?: ReadonlySet<ProviderId>,
  nowMs = Date.now(),
): {
  snapshot?: ValidatedPromptFuelSnapshot;
  malformed: boolean;
  unsupportedSchemaVersion: boolean;
  unknownProviders: number;
} {
  if (!isRecord(value)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  if (value.schemaVersion === SNAPSHOT_IMPORT_SCHEMA_V2) {
    return validateImportedSnapshotPayload(value, enabledProviderIds, nowMs);
  }

  if (value.schemaVersion !== PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION) {
    return {
      malformed: false,
      unsupportedSchemaVersion: true,
      unknownProviders: 0,
    };
  }

  const generatedAtEpochMs = readEpochMs(value.generatedAtEpochMs ?? value.generatedAt);
  if (generatedAtEpochMs === undefined || !Array.isArray(value.providers)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  const providers: PromptFuelSnapshotProviderAggregate[] = [];
  let unknownProviders = 0;
  let malformedProvider = false;

  for (const rawProvider of value.providers) {
    const provider = validateSnapshotProvider(rawProvider, generatedAtEpochMs);
    if (provider === 'unknown-provider') {
      unknownProviders++;
      continue;
    }
    if (provider === undefined) {
      malformedProvider = true;
      continue;
    }
    if (enabledProviderIds && !enabledProviderIds.has(provider.providerId)) {
      continue;
    }
    providers.push(provider);
  }

  if (malformedProvider && providers.length === 0) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders };
  }

  return {
    snapshot: { generatedAtEpochMs, providers },
    malformed: false,
    unsupportedSchemaVersion: false,
    unknownProviders,
  };
}

async function collectSnapshotJsonFiles(snapshotDir: string): Promise<string[]> {
  const entries = await fs.readdir(snapshotDir, { withFileTypes: true });
  const rootFiles = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => path.join(snapshotDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SNAPSHOT_FILES);

  const archiveFiles = await collectArchiveSnapshotJsonFiles(path.join(snapshotDir, 'archive'));
  return [...rootFiles, ...archiveFiles];
}

async function collectArchiveSnapshotJsonFiles(archiveRoot: string): Promise<string[]> {
  const files: string[] = [];
  let machineEntries: { name: string; isDirectory(): boolean }[];
  try {
    machineEntries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const machineEntry of machineEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!machineEntry.isDirectory()) {
      continue;
    }
    const machineDir = path.join(archiveRoot, machineEntry.name);
    let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[];
    try {
      entries = await fs.readdir(machineDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && /^\d{4}-\d{2}\.json$/i.test(entry.name)) {
        files.push(path.join(machineDir, entry.name));
      } else if (entry.isDirectory() && /^\d{4}$/.test(entry.name)) {
        await collectYearArchiveFiles(path.join(machineDir, entry.name), files);
      }
      if (files.length >= MAX_ARCHIVE_FILES) {
        return files;
      }
    }
  }

  return files;
}

async function collectYearArchiveFiles(yearDir: string, files: string[]): Promise<void> {
  let entries: { name: string; isFile(): boolean }[];
  try {
    entries = await fs.readdir(yearDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && /^\d{2}\.json$/i.test(entry.name)) {
      files.push(path.join(yearDir, entry.name));
      if (files.length >= MAX_ARCHIVE_FILES) {
        return;
      }
    }
  }
}

function validateImportedSnapshotPayload(
  value: Record<string, unknown>,
  enabledProviderIds: ReadonlySet<ProviderId> | undefined,
  nowMs: number,
): {
  snapshot?: ValidatedPromptFuelSnapshot;
  malformed: boolean;
  unsupportedSchemaVersion: boolean;
  unknownProviders: number;
} {
  if (hasForbiddenSnapshotContent(value)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  if (value.archiveSchemaVersion !== undefined) {
    return validateImportedArchiveSnapshotPayload(value, enabledProviderIds, nowMs);
  }

  if (hasUnexpectedFields(value, ['schemaVersion', 'generatedAtEpochMs', 'machine', 'providerUsage', 'exportMeta'])) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  const generatedAtEpochMs = readEpochMs(value.generatedAtEpochMs);
  if (generatedAtEpochMs === undefined || !isRecord(value.machine) || typeof value.machine.label !== 'string') {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }
  if (value.providerUsage !== undefined && !Array.isArray(value.providerUsage)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  const sourceLabel = safeSnapshotSourceLabel(value.machine.label, IMPORTED_SNAPSHOT_SOURCE_LABEL);

  return validateImportedProviders(
    value.providerUsage ?? [],
    generatedAtEpochMs,
    enabledProviderIds,
    nowMs,
    sourceLabel,
  );
}

function validateImportedArchiveSnapshotPayload(
  value: Record<string, unknown>,
  enabledProviderIds: ReadonlySet<ProviderId> | undefined,
  nowMs: number,
): {
  snapshot?: ValidatedPromptFuelSnapshot;
  malformed: boolean;
  unsupportedSchemaVersion: boolean;
  unknownProviders: number;
} {
  if (value.archiveSchemaVersion !== SNAPSHOT_ARCHIVE_SCHEMA_V1) {
    return { malformed: false, unsupportedSchemaVersion: true, unknownProviders: 0 };
  }
  if (hasUnexpectedFields(value, [
    'schemaVersion',
    'archiveSchemaVersion',
    'generatedAtEpochMs',
    'machine',
    'month',
    'providers',
    'exportMeta',
  ])) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  const generatedAtEpochMs = readEpochMs(value.generatedAtEpochMs);
  if (generatedAtEpochMs === undefined || !Array.isArray(value.providers)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
  }

  const sourceLabel = isRecord(value.machine)
    ? safeSnapshotSourceLabel(value.machine.label, IMPORTED_SNAPSHOT_SOURCE_LABEL)
    : IMPORTED_SNAPSHOT_SOURCE_LABEL;

  return validateImportedProviders(
    value.providers,
    generatedAtEpochMs,
    enabledProviderIds,
    nowMs,
    sourceLabel,
  );
}

function validateImportedProviders(
  rawProviders: unknown[],
  generatedAtEpochMs: number,
  enabledProviderIds: ReadonlySet<ProviderId> | undefined,
  nowMs: number,
  sourceLabel: string,
): {
  snapshot?: ValidatedPromptFuelSnapshot;
  malformed: boolean;
  unsupportedSchemaVersion: boolean;
  unknownProviders: number;
} {
  const providers: PromptFuelSnapshotProviderAggregate[] = [];
  let unknownProviders = 0;
  let malformedProvider = false;

  for (const rawProvider of rawProviders) {
    const provider = validateImportedProvider(rawProvider, generatedAtEpochMs, nowMs, sourceLabel);
    if (provider === 'unknown-provider') {
      unknownProviders++;
      continue;
    }
    if (provider === undefined) {
      malformedProvider = true;
      continue;
    }
    if (enabledProviderIds && !enabledProviderIds.has(provider.providerId)) {
      continue;
    }
    providers.push(provider);
  }

  if (malformedProvider && providers.length === 0) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders };
  }

  return {
    snapshot: { generatedAtEpochMs, providers },
    malformed: false,
    unsupportedSchemaVersion: false,
    unknownProviders,
  };
}

function validateImportedProvider(
  value: unknown,
  generatedAtEpochMs: number,
  nowMs: number,
  sourceLabel: string,
): PromptFuelSnapshotProviderAggregate | 'unknown-provider' | undefined {
  if (!isRecord(value) || typeof value.provider !== 'string') {
    return undefined;
  }
  if (!isKnownProvider(value.provider)) {
    return 'unknown-provider';
  }
  if (hasUnexpectedFields(value, [
    'provider',
    'laneLabel',
    'fiveHourUsedPercent',
    'sevenDayUsedPercent',
    'fiveHourResetAtEpochSeconds',
    'sevenDayResetAtEpochSeconds',
    'lastUpdatedEpochMs',
    'stale',
    'source',
    'sourceConfidence',
    'historyBuckets',
  ])) {
    return undefined;
  }
  if (value.historyBuckets !== undefined && !Array.isArray(value.historyBuckets)) {
    return undefined;
  }

  const normalized = normalizeImportedHistoryBuckets(
    value.provider,
    value.historyBuckets ?? [],
    nowMs,
    sourceLabel,
  );
  if (!normalized) {
    return undefined;
  }

  return {
    providerId: value.provider,
    generatedAtEpochMs: readEpochMs(value.lastUpdatedEpochMs) ?? generatedAtEpochMs,
    aggregate: normalized.aggregate,
    windowTotals: normalized.windowTotals,
    historyBuckets: normalized.historyBuckets,
    modelAggregates: normalized.modelAggregates,
    modelWindowTotals: normalized.modelWindowTotals,
    sourceLabel,
  };
}

function normalizeImportedHistoryBuckets(
  providerId: ProviderId,
  buckets: unknown[],
  nowMs: number,
  sourceLabel: string,
): {
  aggregate: AggregateUsage;
  windowTotals: Partial<LocalHistoryWindowAggregateMap>;
  modelAggregates: ModelUsageAggregate[];
  modelWindowTotals: Partial<ModelUsageWindowAggregateMap>;
  historyBuckets: PromptFuelSnapshotHistoryBucket[];
} | undefined {
  const aggregate = createEmptyAggregate();
  const windowTotals: Partial<LocalHistoryWindowAggregateMap> = {
    all: createEmptyAggregate(),
  };
  const modelAggregates: ModelUsageAggregate[] = [];
  const modelWindowTotals: Partial<ModelUsageWindowAggregateMap> = {
    all: [],
  };
  const historyBuckets: PromptFuelSnapshotHistoryBucket[] = [];
  const todayKey = localDateKey(nowMs);
  const last7dStartKey = localDateKey(nowMs - (6 * 24 * 60 * 60 * 1000));
  let validBucketCount = 0;

  for (const rawBucket of buckets) {
    const bucket = readImportedHistoryBucket(rawBucket);
    if (!bucket) {
      continue;
    }
    validBucketCount++;
    addAggregate(aggregate, bucket.aggregate);
    addAggregate(windowTotals.all!, bucket.aggregate);
    mergeBucketModels(modelAggregates, providerId, bucket.models, sourceLabel);
    mergeBucketModels(modelWindowTotals.all!, providerId, bucket.models, sourceLabel, 'all');
    historyBuckets.push({
      dateKey: bucket.dateKey,
      aggregate: cloneAggregate(bucket.aggregate),
      modelAggregates: bucket.models.map(model => ({
        providerId,
        modelLabel: model.modelLabel,
        totalTokens: model.totalTokens,
        totalAssistantMessages: model.totalAssistantMessages,
        source: 'snapshot',
        sourceLabels: [sourceLabel],
      })),
    });

    if (bucket.dateKey === todayKey) {
      if (!windowTotals.today) {
        windowTotals.today = createEmptyAggregate();
      }
      if (!modelWindowTotals.today) {
        modelWindowTotals.today = [];
      }
      addAggregate(windowTotals.today, bucket.aggregate);
      mergeBucketModels(modelWindowTotals.today, providerId, bucket.models, sourceLabel, 'today');
    }
    if (bucket.dateKey >= last7dStartKey && bucket.dateKey <= todayKey) {
      if (!windowTotals.last7d) {
        windowTotals.last7d = createEmptyAggregate();
      }
      if (!modelWindowTotals.last7d) {
        modelWindowTotals.last7d = [];
      }
      addAggregate(windowTotals.last7d, bucket.aggregate);
      mergeBucketModels(modelWindowTotals.last7d, providerId, bucket.models, sourceLabel, 'last7d');
    }
  }

  if (validBucketCount === 0 || aggregate.totalTokens <= 0) {
    return undefined;
  }

  sortModelWindows(modelWindowTotals);
  return {
    aggregate,
    windowTotals,
    historyBuckets,
    modelAggregates: sortModelUsageAggregates(modelAggregates),
    modelWindowTotals,
  };
}

function readImportedHistoryBucket(value: unknown): {
  dateKey: string;
  aggregate: AggregateUsage;
  models: Array<{ modelLabel: string; totalTokens: number; totalAssistantMessages: number }>;
} | undefined {
  if (!isRecord(value) || hasUnexpectedFields(value, [
    'dateKey',
    'inputTokens',
    'outputTokens',
    'cacheCreationTokens',
    'cacheReadTokens',
    'reasoningOutputTokens',
    'requests',
    'messages',
    'turns',
    'sourceConfidence',
    'models',
  ])) {
    return undefined;
  }
  if (typeof value.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey)) {
    return undefined;
  }
  if (value.models !== undefined && !Array.isArray(value.models)) {
    return undefined;
  }

  const aggregate = readImportedTokenAggregate(value);
  const models = (value.models ?? [])
    .map(readImportedModelBucket)
    .filter((model): model is { modelLabel: string; totalTokens: number; totalAssistantMessages: number } => model !== undefined);

  if (aggregate.totalTokens <= 0 && models.length === 0) {
    return undefined;
  }

  return {
    dateKey: value.dateKey,
    aggregate,
    models,
  };
}

function readImportedModelBucket(value: unknown): {
  modelLabel: string;
  totalTokens: number;
  totalAssistantMessages: number;
} | undefined {
  if (!isRecord(value) || hasUnexpectedFields(value, [
    'model',
    'inputTokens',
    'outputTokens',
    'cacheCreationTokens',
    'cacheReadTokens',
    'reasoningOutputTokens',
    'requests',
    'messages',
    'turns',
  ])) {
    return undefined;
  }
  const modelLabel = sanitizeModelLabel(value.model);
  const aggregate = readImportedTokenAggregate(value);
  if (!modelLabel || aggregate.totalTokens <= 0) {
    return undefined;
  }
  return {
    modelLabel,
    totalTokens: aggregate.totalTokens,
    totalAssistantMessages: aggregate.totalAssistantMessages,
  };
}

function readImportedTokenAggregate(value: Record<string, unknown>): AggregateUsage {
  const aggregate = createEmptyAggregate();
  aggregate.totalInputTokens = readNonNegativeInteger(value.inputTokens) ?? 0;
  aggregate.totalOutputTokens = readNonNegativeInteger(value.outputTokens) ?? 0;
  aggregate.totalCacheCreationInputTokens = readNonNegativeInteger(value.cacheCreationTokens) ?? 0;
  aggregate.totalCacheReadInputTokens = readNonNegativeInteger(value.cacheReadTokens) ?? 0;
  aggregate.totalTokens = (
    aggregate.totalInputTokens +
    aggregate.totalOutputTokens +
    aggregate.totalCacheCreationInputTokens +
    aggregate.totalCacheReadInputTokens
  );
  aggregate.totalAssistantMessages = readNonNegativeInteger(
    value.messages ?? value.turns ?? value.requests,
  ) ?? 0;
  return aggregate;
}

function addAggregate(target: AggregateUsage, source: AggregateUsage): void {
  target.totalInputTokens += source.totalInputTokens;
  target.totalOutputTokens += source.totalOutputTokens;
  target.totalCacheCreationInputTokens += source.totalCacheCreationInputTokens;
  target.totalCacheReadInputTokens += source.totalCacheReadInputTokens;
  target.totalTokens += source.totalTokens;
  target.totalAssistantMessages += source.totalAssistantMessages;
}

function mergeBucketModels(
  target: ModelUsageAggregate[],
  providerId: ProviderId,
  models: Array<{ modelLabel: string; totalTokens: number; totalAssistantMessages: number }>,
  sourceLabel: string,
  windowId?: LocalHistoryWindowId,
): void {
  for (const model of models) {
    mergeModelUsageAggregate(target, {
      providerId,
      modelLabel: model.modelLabel,
      totalTokens: model.totalTokens,
      totalAssistantMessages: model.totalAssistantMessages,
      source: 'snapshot',
      sourceLabels: [sourceLabel],
      ...(windowId ? { windowId } : {}),
    });
  }
}

function sortModelWindows(windows: Partial<ModelUsageWindowAggregateMap>): void {
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    if (windows[windowId]) {
      windows[windowId] = sortModelUsageAggregates(windows[windowId]!);
    }
  }
}

function validateSnapshotProvider(
  value: unknown,
  snapshotGeneratedAtEpochMs: number,
): PromptFuelSnapshotProviderAggregate | 'unknown-provider' | undefined {
  if (!isRecord(value) || typeof value.providerId !== 'string') {
    return undefined;
  }
  if (!isKnownProvider(value.providerId)) {
    return 'unknown-provider';
  }

  const generatedAtEpochMs = readEpochMs(value.generatedAtEpochMs ?? value.generatedAt)
    ?? snapshotGeneratedAtEpochMs;
  const aggregate = readAggregate(value.aggregate ?? value.totals);
  if (!aggregate) {
    return undefined;
  }

  const windowTotals = readWindowTotals(value.windowTotals);
  const sourceLabel = sanitizeSnapshotSourceLabel(value.sourceLabel);
  const modelAggregates = readModelTotals(value.modelTotals ?? value.modelAggregates, value.providerId, undefined, sourceLabel);
  const modelWindowTotals = readModelWindowTotals(value.modelWindowTotals, value.providerId, sourceLabel);

  return {
    providerId: value.providerId,
    generatedAtEpochMs,
    aggregate,
    ...(windowTotals ? { windowTotals } : {}),
    ...(modelAggregates.length > 0 ? { modelAggregates } : {}),
    ...(modelWindowTotals ? { modelWindowTotals } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
  };
}

function readWindowTotals(value: unknown): Partial<LocalHistoryWindowAggregateMap> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const windows: Partial<LocalHistoryWindowAggregateMap> = {};
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    const aggregate = readAggregate(value[windowId]);
    if (aggregate) {
      windows[windowId as LocalHistoryWindowId] = aggregate;
    }
  }

  return Object.keys(windows).length > 0 ? windows : undefined;
}

function readModelWindowTotals(
  value: unknown,
  providerId: ProviderId,
  sourceLabel: string | undefined,
): Partial<ModelUsageWindowAggregateMap> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const windows: Partial<ModelUsageWindowAggregateMap> = {};
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    const models = readModelTotals(value[windowId], providerId, windowId, sourceLabel);
    if (models.length > 0) {
      windows[windowId as LocalHistoryWindowId] = models;
    }
  }

  return Object.keys(windows).length > 0 ? windows : undefined;
}

function readModelTotals(
  value: unknown,
  providerId: ProviderId,
  windowId?: LocalHistoryWindowId,
  sourceLabel?: string,
): ModelUsageAggregate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const models: ModelUsageAggregate[] = [];
  for (const entry of value) {
    const model = readModelTotal(entry, providerId, windowId, sourceLabel);
    if (model) {
      models.push(model);
    }
  }

  return sortModelUsageAggregates(models);
}

function readModelTotal(
  value: unknown,
  providerId: ProviderId,
  windowId?: LocalHistoryWindowId,
  sourceLabel?: string,
): ModelUsageAggregate | undefined {
  if (!isRecord(value) || hasUnexpectedModelTotalFields(value)) {
    return undefined;
  }

  if (typeof value.providerId === 'string' && value.providerId !== providerId) {
    return undefined;
  }

  const modelLabel = sanitizeModelLabel(value.modelLabel ?? value.model);
  const totalTokens = readNonNegativeInteger(value.totalTokens);
  const totalAssistantMessages = readNonNegativeInteger(
    value.totalAssistantMessages ?? value.messages ?? value.turns,
  ) ?? 0;

  if (!modelLabel || totalTokens === undefined) {
    return undefined;
  }

  return {
    providerId,
    modelLabel,
    totalTokens,
    totalAssistantMessages,
    source: 'snapshot',
    ...(sourceLabel ? { sourceLabels: [sourceLabel] } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function hasUnexpectedModelTotalFields(value: Record<string, unknown>): boolean {
  const allowedFields = new Set([
    'providerId',
    'modelLabel',
    'model',
    'totalTokens',
    'totalAssistantMessages',
    'messages',
    'turns',
  ]);
  return Object.keys(value).some(key => !allowedFields.has(key));
}

function readAggregate(value: unknown): AggregateUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const totalTokens = readNonNegativeInteger(value.totalTokens);
  const totalAssistantMessages = readNonNegativeInteger(value.totalAssistantMessages);
  if (totalTokens === undefined || totalAssistantMessages === undefined) {
    return undefined;
  }

  return {
    totalInputTokens: readNonNegativeInteger(value.totalInputTokens) ?? 0,
    totalOutputTokens: readNonNegativeInteger(value.totalOutputTokens) ?? 0,
    totalCacheCreationInputTokens: readNonNegativeInteger(value.totalCacheCreationInputTokens) ?? 0,
    totalCacheReadInputTokens: readNonNegativeInteger(value.totalCacheReadInputTokens) ?? 0,
    totalTokens,
    totalAssistantMessages,
  };
}

function readEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return readNonNegativeInteger(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return readNonNegativeInteger(parsed);
  }
  return undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

const FORBIDDEN_FIELD_NAMES = new Set([
  'sessionId',
  'session_id',
  'token',
  'apiKey',
  'api_key',
  'credentials',
  'authHeader',
  'auth_header',
  'prompt',
  'response',
  'transcript',
  'sessionToken',
  'credential',
  'accessToken',
  'refreshToken',
  'authorization',
  'auth',
  'secret',
  'password',
  'workspace',
  'cwd',
  'transcriptPath',
  'providerPayload',
  'rawProviderPayload',
  'rawPayload',
  'payload',
]);

const PATH_LIKE_PATTERNS: RegExp[] = [
  /[A-Za-z]:[\\/]/,
  /^\\\\/,
  /(^|[\s"'`])\/(home|Users|var|tmp|mnt|Volumes|opt|etc|private|workspace)\//,
  /(^|[\s"'`])~[\\/]/,
  /(^|[\s"'`])\.\.?[\\/]/,
];

function hasUnexpectedFields(value: Record<string, unknown>, allowedFields: ReadonlyArray<string>): boolean {
  const allowed = new Set(allowedFields);
  return Object.keys(value).some(key => !allowed.has(key));
}

function hasForbiddenSnapshotContent(value: unknown, visited = new Set<unknown>()): boolean {
  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'string') {
      return PATH_LIKE_PATTERNS.some(pattern => pattern.test(value)) || /sess_[a-zA-Z0-9]/.test(value);
    }
    return false;
  }
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some(item => hasForbiddenSnapshotContent(item, visited));
  }

  for (const [key, item] of Object.entries(value)) {
    if (isForbiddenFieldName(key) || hasForbiddenSnapshotContent(item, visited)) {
      return true;
    }
  }
  return false;
}

function isForbiddenFieldName(key: string): boolean {
  if (FORBIDDEN_FIELD_NAMES.has(key)) {
    return true;
  }
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized.includes('credential') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized === 'auth' ||
    normalized.startsWith('auth') ||
    normalized.endsWith('auth') ||
    normalized.includes('prompt') ||
    normalized.includes('response') ||
    normalized.includes('transcript') ||
    normalized === 'session' ||
    normalized.startsWith('session') ||
    normalized === 'workspace' ||
    normalized.startsWith('workspace') ||
    normalized === 'cwd' ||
    normalized.startsWith('cwd') ||
    normalized === 'payload' ||
    normalized.includes('providerpayload') ||
    normalized.includes('rawpayload');
}

function localDateKey(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createReadResult(nowMs: number): ReadPromptFuelSnapshotsResult {
  return {
    state: createEmptySnapshotState(nowMs),
    filesRead: 0,
    malformedRecords: 0,
    unsupportedSchemaVersions: 0,
    unknownProviders: 0,
    skippedByMachineLabel: 0,
  };
}

function resolveLocalMachineLabel(configured: string | undefined): string {
  const trimmed = configured?.trim();
  return (trimmed ? trimmed : os.hostname()).toLowerCase().trim();
}

function buildImportAllowSet(labels: ReadonlyArray<string> | undefined): Set<string> {
  if (!labels || labels.length === 0) {
    return new Set();
  }
  return new Set(labels.map(l => l.toLowerCase().trim()).filter(l => l.length > 0));
}

function getImportedSnapshotMachineLabel(value: unknown): string | undefined {
  if (!isRecord(value) || value.schemaVersion !== SNAPSHOT_IMPORT_SCHEMA_V2) {
    return undefined;
  }
  if (!isRecord(value.machine) || typeof value.machine.label !== 'string') {
    return undefined;
  }
  return value.machine.label.toLowerCase().trim();
}
