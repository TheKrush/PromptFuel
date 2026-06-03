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
// V1 is the current public snapshot shape (messages, turns, requests in models).
// Legacy private dev versions (V2=2, V3=3) are no longer supported for reading.
export const SNAPSHOT_SCHEMA_V1 = 1;
export const SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION = 1;

/** Sanitized history bucket. */
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

/** Sanitized per-bucket model entry. */
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

/** Per-provider source entry with optional history payload. */
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



/** Machine snapshot payload for the current snapshot schema (V1). */
export interface PromptFuelMachineSnapshotV2 {
  schemaVersion: typeof SNAPSHOT_SCHEMA_V1;
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
  schemaVersion: typeof SNAPSHOT_SCHEMA_V1;
  archiveSchemaVersion: typeof SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION;
  writerVersion: string;
  generatedAtEpochMs: number;
  machineLabel: string;
  month: string;
  providers: SnapshotHistoryArchiveProvider[];
}

/** Sanitized history source for a single remote source (reader output). */
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
  return version === SNAPSHOT_SCHEMA_V1;
}
