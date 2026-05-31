import * as fs from 'fs/promises';
import * as path from 'path';
import { isKnownProvider, type ProviderId } from '../core/providers';
import {
  PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
  createEmptySnapshotState,
  type PromptFuelSnapshotProviderAggregate,
  type PromptFuelSnapshotState,
} from '../core/snapshotTypes';
import {
  type AggregateUsage,
  type LocalHistoryWindowAggregateMap,
  type LocalHistoryWindowId,
  LOCAL_HISTORY_WINDOW_IDS,
} from '../core/usageAggregate';

export interface SnapshotDiagnostics {
  info(message: string): void;
}

export interface ReadPromptFuelSnapshotsOptions {
  snapshotDir: string;
  enabledProviderIds?: ReadonlyArray<string>;
  diagnostics?: SnapshotDiagnostics;
  nowMs?: number;
}

export interface ReadPromptFuelSnapshotsResult {
  state: PromptFuelSnapshotState;
  filesRead: number;
  malformedRecords: number;
  unsupportedSchemaVersions: number;
  unknownProviders: number;
}

interface ValidatedPromptFuelSnapshot {
  generatedAtEpochMs: number;
  providers: PromptFuelSnapshotProviderAggregate[];
}

const MAX_SNAPSHOT_FILES = 50;
const GENERIC_SOURCE_LABELS = new Set([
  'imported',
  'manual import',
  'snapshot',
  'snapshot import',
]);

export async function readPromptFuelSnapshots(
  options: ReadPromptFuelSnapshotsOptions,
): Promise<ReadPromptFuelSnapshotsResult> {
  const nowMs = options.nowMs ?? Date.now();
  const empty = createReadResult(nowMs);

  let entries: { name: string; isFile(): boolean }[];
  try {
    entries = await fs.readdir(options.snapshotDir, { withFileTypes: true });
  } catch {
    options.diagnostics?.info('snapshot data not found');
    return empty;
  }

  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SNAPSHOT_FILES);

  if (files.length === 0) {
    options.diagnostics?.info('snapshot data not found');
    return empty;
  }

  const enabled = options.enabledProviderIds
    ? new Set(options.enabledProviderIds.filter(isKnownProvider))
    : undefined;

  const providers: PromptFuelSnapshotProviderAggregate[] = [];
  let malformedRecords = 0;
  let unsupportedSchemaVersions = 0;
  let unknownProviders = 0;
  let validSnapshotCount = 0;

  for (const fileName of files) {
    const filePath = path.join(options.snapshotDir, fileName);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      malformedRecords++;
      continue;
    }

    const validation = validatePromptFuelSnapshotPayload(parsed, enabled);
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
  };
}

export function validatePromptFuelSnapshotPayload(
  value: unknown,
  enabledProviderIds?: ReadonlySet<ProviderId>,
): {
  snapshot?: ValidatedPromptFuelSnapshot;
  malformed: boolean;
  unsupportedSchemaVersion: boolean;
  unknownProviders: number;
} {
  if (!isRecord(value)) {
    return { malformed: true, unsupportedSchemaVersion: false, unknownProviders: 0 };
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
  const sourceLabel = sanitizeSourceLabel(value.sourceLabel);

  return {
    providerId: value.providerId,
    generatedAtEpochMs,
    aggregate,
    ...(windowTotals ? { windowTotals } : {}),
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

function sanitizeSourceLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!GENERIC_SOURCE_LABELS.has(trimmed)) {
    return undefined;
  }
  return trimmed;
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
  };
}
