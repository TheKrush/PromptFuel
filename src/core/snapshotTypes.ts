import type { ProviderId } from './providers';
import {
  cloneAggregate,
  createEmptyAggregate,
  type AggregateUsage,
  type LocalHistoryWindowAggregateMap,
} from './usageAggregate';
import {
  cloneModelUsageAggregates,
  cloneModelUsageWindowAggregates,
  type ModelUsageAggregate,
  type ModelUsageWindowAggregateMap,
} from './modelUsage';

export const PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION = 1;
export const IMPORTED_SNAPSHOT_SOURCE_LABEL = 'Imported snapshot';
export const SNAPSHOT_SOURCE_LABEL = 'Snapshot source';

const MAX_SNAPSHOT_SOURCE_LABEL_LENGTH = 40;
const UNSAFE_SNAPSHOT_SOURCE_LABEL_PARTS = [
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'credential',
  'password',
  'secret',
  'session',
  'token',
];

const UNSAFE_SNAPSHOT_SOURCE_FILE_EXTENSIONS = [
  'csv',
  'db',
  'env',
  'json',
  'jsonl',
  'key',
  'log',
  'pem',
  'sqlite',
  'toml',
  'txt',
  'yaml',
  'yml',
];

export interface PromptFuelSnapshotProviderAggregate {
  providerId: ProviderId;
  generatedAtEpochMs: number;
  aggregate: AggregateUsage;
  windowTotals?: Partial<LocalHistoryWindowAggregateMap>;
  modelAggregates?: ModelUsageAggregate[];
  modelWindowTotals?: Partial<ModelUsageWindowAggregateMap>;
  sourceLabel?: string;
}

export interface PromptFuelSnapshotState {
  providers: PromptFuelSnapshotProviderAggregate[];
  snapshotCount: number;
  lastReadEpochMs: number | undefined;
}

export function createEmptySnapshotState(lastReadEpochMs?: number): PromptFuelSnapshotState {
  return {
    providers: [],
    snapshotCount: 0,
    lastReadEpochMs,
  };
}

export function cloneSnapshotState(state: PromptFuelSnapshotState): PromptFuelSnapshotState {
  return {
    providers: state.providers.map(provider => ({
      providerId: provider.providerId,
      generatedAtEpochMs: provider.generatedAtEpochMs,
      aggregate: cloneAggregate(provider.aggregate),
      ...(provider.windowTotals ? { windowTotals: cloneWindowTotals(provider.windowTotals) } : {}),
      ...(provider.modelAggregates ? { modelAggregates: cloneModelUsageAggregates(provider.modelAggregates) } : {}),
      ...(provider.modelWindowTotals ? { modelWindowTotals: cloneModelUsageWindowAggregates(provider.modelWindowTotals) } : {}),
      ...(provider.sourceLabel ? { sourceLabel: provider.sourceLabel } : {}),
    })),
    snapshotCount: state.snapshotCount,
    lastReadEpochMs: state.lastReadEpochMs,
  };
}

export function createZeroSnapshotAggregate(): AggregateUsage {
  return createEmptyAggregate();
}

function cloneWindowTotals(
  windows: Partial<LocalHistoryWindowAggregateMap>,
): Partial<LocalHistoryWindowAggregateMap> {
  const cloned: Partial<LocalHistoryWindowAggregateMap> = {};
  if (windows.today) {
    cloned.today = cloneAggregate(windows.today);
  }
  if (windows.last5h) {
    cloned.last5h = cloneAggregate(windows.last5h);
  }
  if (windows.last7d) {
    cloned.last7d = cloneAggregate(windows.last7d);
  }
  if (windows.all) {
    cloned.all = cloneAggregate(windows.all);
  }
  return cloned;
}

export function sanitizeSnapshotSourceLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_SNAPSHOT_SOURCE_LABEL_LENGTH) {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f<>|]/.test(trimmed)) {
    return undefined;
  }
  if (/[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed) || /^~/.test(trimmed)) {
    return undefined;
  }
  if (/^\.\.?($|[. -])/.test(trimmed) || trimmed.includes('..')) {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
    return undefined;
  }
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(trimmed)) {
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(trimmed)) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (UNSAFE_SNAPSHOT_SOURCE_LABEL_PARTS.some(part => lower.includes(part))) {
    return undefined;
  }
  if (UNSAFE_SNAPSHOT_SOURCE_FILE_EXTENSIONS.some(extension => lower.endsWith(`.${extension}`))) {
    return undefined;
  }

  return trimmed;
}

export function safeSnapshotSourceLabel(
  value: unknown,
  fallback = IMPORTED_SNAPSHOT_SOURCE_LABEL,
): string {
  return sanitizeSnapshotSourceLabel(value) ?? fallback;
}

export function uniqueSnapshotSourceLabels(
  labels: ReadonlyArray<string | undefined>,
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const label of labels) {
    const safe = sanitizeSnapshotSourceLabel(label);
    if (!safe) {
      continue;
    }
    const key = safe.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(safe);
  }

  return unique.sort((a, b) => a.localeCompare(b));
}

export function formatSnapshotSourceLabels(
  labels: ReadonlyArray<string | undefined>,
  maxLabels = 3,
): string | undefined {
  const unique = uniqueSnapshotSourceLabels(labels);
  if (unique.length === 0) {
    return undefined;
  }
  const visible = unique.slice(0, maxLabels);
  const remainder = unique.length - visible.length;
  return remainder > 0
    ? `${visible.join(', ')} +${remainder}`
    : visible.join(', ');
}
