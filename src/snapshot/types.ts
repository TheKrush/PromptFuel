import type { UsageDashboardSourceConfidence } from '../panel/usageDashboardModel';

export type SnapshotProviderName = 'claude' | 'codex';

export interface PromptFuelMachineSnapshotProvider {
  provider: SnapshotProviderName;
  sourceLabel: string;
  fiveHourUsedPercent?: number;
  sevenDayUsedPercent?: number;
  fiveHourResetAtEpochSeconds?: number;
  sevenDayResetAtEpochSeconds?: number;
  lastUpdatedEpochMs?: number;
  stale: boolean;
  source: 'authenticated' | 'localSession' | 'hook' | 'snapshot' | 'cache' | 'stale' | 'unknown';
  sourceConfidence: UsageDashboardSourceConfidence;
}

// --- Snapshot schema versions ---
export const SNAPSHOT_SCHEMA_V2 = 2; // legacy: uses laneLabel
export const SNAPSHOT_SCHEMA_V3 = 3; // legacy: had exportMeta wrapper
export const SNAPSHOT_SCHEMA_V4 = 4; // current: writerVersion at root, no exportMeta
export const SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION = 1;

/** Sanitized history bucket (v2). */
export interface SnapshotHistoryBucket {
  dateKey: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningOutputTokens?: number;
  requests?: number;
  messages?: number;
  turns?: number;
  sourceConfidence?: string;
  models?: SnapshotBucketModel[];
}

/** Sanitized per-bucket model entry (v2). */
export interface SnapshotBucketModel {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningOutputTokens?: number;
  requests?: number;
  messages?: number;
  turns?: number;
}

/** Per-provider source entry with optional v2 history payload. */
export interface SnapshotProviderUsageV2 {
  provider: SnapshotProviderName;
  sourceLabel: string;
  fiveHourUsedPercent?: number;
  sevenDayUsedPercent?: number;
  fiveHourResetAtEpochSeconds?: number;
  sevenDayResetAtEpochSeconds?: number;
  lastUpdatedEpochMs?: number;
  stale: boolean;
  source: 'authenticated' | 'localSession' | 'hook' | 'snapshot' | 'cache' | 'stale' | 'unknown';
  sourceConfidence: UsageDashboardSourceConfidence;
  historyBuckets?: SnapshotHistoryBucket[];
}

/** Extension-level export metadata (V2/V3 on-disk only; used in upgrade path). */
export interface ExtensionExportMetaV2 {
  extensionVersion: string;
  schemaVersion: number;
  includeHistoryBuckets?: boolean;
}

/** Machine snapshot payload for the current snapshot schema (V4+). */
export interface PromptFuelMachineSnapshotV2 {
  schemaVersion: typeof SNAPSHOT_SCHEMA_V2 | typeof SNAPSHOT_SCHEMA_V3 | typeof SNAPSHOT_SCHEMA_V4;
  writerVersion: string;
  generatedAtEpochMs: number;
  machineLabel: string;
  providerUsage?: SnapshotProviderUsageV2[];
}

export interface SnapshotHistoryArchiveProvider {
  provider: SnapshotProviderName;
  historyBuckets: SnapshotHistoryBucket[];
}

export interface PromptFuelSnapshotHistoryArchiveMonth {
  schemaVersion: typeof SNAPSHOT_SCHEMA_V2 | typeof SNAPSHOT_SCHEMA_V3 | typeof SNAPSHOT_SCHEMA_V4;
  archiveSchemaVersion: typeof SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION;
  writerVersion: string;
  generatedAtEpochMs: number;
  machineLabel: string;
  month: string;
  providers: SnapshotHistoryArchiveProvider[];
}

/** Sanitized history source for a single remote source (v2 reader output). */
export interface SanitizedHistorySource {
  provider: string;
  sourceLabel: string;
  machineLabel: string;
  schemaVersion: number;
  quotaOnly: boolean;
  stale: boolean;
  fiveHourResetAtEpochSeconds?: number;
  sevenDayResetAtEpochSeconds?: number;
  historyBuckets?: SnapshotHistoryBucket[];
}

export function isSupportedSchemaVersion(version: number): boolean {
  return version === SNAPSHOT_SCHEMA_V2 || version === SNAPSHOT_SCHEMA_V3 || version === SNAPSHOT_SCHEMA_V4;
}
