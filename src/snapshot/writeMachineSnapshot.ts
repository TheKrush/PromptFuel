import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ProviderUsageState, LimitWindow, QuotaSourceKind } from '../types';
import type { UsageDashboardSourceConfidence } from '../panel/usageDashboardModel';
import { EXTENSION_VERSION } from '../version';
import type {
  SnapshotProviderUsageV2,
  SnapshotHistoryBucket,
  SnapshotBucketModel,
  PromptFuelMachineSnapshotV2
} from './types';
import { SNAPSHOT_SCHEMA_V1 } from './types';
import { hasTokenData } from './tokenMath';
import { writeSnapshotHistoryArchives } from './historyArchive';
import { cleanupSnapshotFiles, cleanupTempSnapshotFile } from './cleanupSnapshotFiles';

export interface SnapshotWriterConfig {
  enabled: boolean;
  machineLabel: string;
  path: string;
}

/** Narrow allowlisted input for per-model contribution data from day-bucket scanners. */
export interface ModelContributionInput {
  model: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningOutputTokens?: number;
  assistantMessages?: number;
  turns?: number;
  requests?: number;
}

/** Narrow allowlisted input for per-day history exported to snapshots. */
export interface HistoryBucketInput {
  dateKey: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningOutputTokens?: number;
  messages?: number;
  turns?: number;
  modelUsage?: ModelContributionInput[];
}

export interface ProviderHistoryInput {
  buckets: HistoryBucketInput[];
}

function sanitizeMachineLabel(label: string): string {
  const sanitized = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized || 'unknown';
}

function mapSourceKind(kind: QuotaSourceKind | undefined): SnapshotProviderUsageV2['source'] {
  switch (kind) {
    case 'authenticated':
      return 'authenticated';
    case 'statusLine':
      return 'localSession';
    case 'hook':
      return 'hook';
    case 'localSession':
      return 'localSession';
    case 'cache':
      return 'cache';
    case 'stale':
      return 'stale';
    default:
      return 'unknown';
  }
}

function deriveSourceConfidence(
  authStatus: string | undefined,
  sourceKind: QuotaSourceKind | undefined,
  stale: boolean | undefined
): UsageDashboardSourceConfidence {
  if (authStatus === 'success') {
    return 'quotaState';
  }
  if (stale) {
    return 'unavailable';
  }
  if (sourceKind === 'authenticated' || sourceKind === 'cache') {
    return 'quotaState';
  }
  if (sourceKind === 'localSession' || sourceKind === 'hook' || sourceKind === 'statusLine') {
    return 'apiEquivalentEstimate';
  }
  return 'unavailable';
}

function windowUsedPercent(window: LimitWindow | undefined): number | undefined {
  if (!window || typeof window.usedPercentage !== 'number') {
    return undefined;
  }
  const pct = window.usedPercentage;
  if (!Number.isFinite(pct) || pct < 0) {
    return undefined;
  }
  return Math.min(pct, 100);
}

function safePositiveNumber(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function safeNonEmptyString(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim();
}

function buildSnapshotBucketModelEntry(
  contribution: ModelContributionInput
): SnapshotBucketModel | undefined {
  const model = safeNonEmptyString(contribution.model);
  if (!model) {
    return undefined;
  }

  const entry: SnapshotBucketModel = { model };
  const inputTokens = safePositiveNumber(contribution.inputTokens);
  const outputTokens = safePositiveNumber(contribution.outputTokens);
  const cacheCreationTokens = safePositiveNumber(contribution.cacheCreationTokens);
  const cacheReadTokens = safePositiveNumber(contribution.cacheReadTokens);
  const reasoningOutputTokens = safePositiveNumber(contribution.reasoningOutputTokens);
  const assistantMessages = safePositiveNumber(contribution.assistantMessages);
  const turns = safePositiveNumber(contribution.turns);
  const requests = safePositiveNumber(contribution.requests);

  if (inputTokens !== undefined) entry.inputTokens = inputTokens;
  if (outputTokens !== undefined) entry.outputTokens = outputTokens;
  if (cacheCreationTokens !== undefined) entry.cacheCreationTokens = cacheCreationTokens;
  if (cacheReadTokens !== undefined) entry.cacheReadTokens = cacheReadTokens;
  if (reasoningOutputTokens !== undefined) entry.reasoningOutputTokens = reasoningOutputTokens;
  if (assistantMessages !== undefined) entry.messages = assistantMessages;
  if (turns !== undefined) entry.turns = turns;
  if (requests !== undefined) entry.requests = requests;

  return hasTokenData(entry) || assistantMessages !== undefined || turns !== undefined || requests !== undefined
    ? entry
    : undefined;
}

function buildHistoryBucketFromInput(input: HistoryBucketInput): SnapshotHistoryBucket | undefined {
  const dateKey = safeNonEmptyString(input.dateKey);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return undefined;
  }

  const bucket: SnapshotHistoryBucket = { dateKey };
  const inputTokens = safePositiveNumber(input.inputTokens);
  const outputTokens = safePositiveNumber(input.outputTokens);
  const cacheCreationTokens = safePositiveNumber(input.cacheCreationTokens);
  const cacheReadTokens = safePositiveNumber(input.cacheReadTokens);
  const reasoningOutputTokens = safePositiveNumber(input.reasoningOutputTokens);
  const messages = safePositiveNumber(input.messages);
  const turns = safePositiveNumber(input.turns);

  if (inputTokens !== undefined) bucket.inputTokens = inputTokens;
  if (outputTokens !== undefined) bucket.outputTokens = outputTokens;
  if (cacheCreationTokens !== undefined) bucket.cacheCreationTokens = cacheCreationTokens;
  if (cacheReadTokens !== undefined) bucket.cacheReadTokens = cacheReadTokens;
  if (reasoningOutputTokens !== undefined) bucket.reasoningOutputTokens = reasoningOutputTokens;
  if (messages !== undefined) bucket.messages = messages;
  if (turns !== undefined) bucket.turns = turns;

  const models = (input.modelUsage ?? [])
    .map(model => buildSnapshotBucketModelEntry(model))
    .filter((entry): entry is SnapshotBucketModel => entry !== undefined);
  if (models.length > 0) {
    bucket.models = models;
  }

  const hasAnyField = hasTokenData(bucket) || messages !== undefined ||
    turns !== undefined || models.length > 0;

  return hasAnyField ? bucket : undefined;
}

function buildHistoryBuckets(
  state: ProviderUsageState,
  historyInput?: ProviderHistoryInput
): SnapshotHistoryBucket[] | undefined {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (historyInput?.buckets?.length) {
    const buckets = historyInput.buckets
      .map(buildHistoryBucketFromInput)
      .filter((bucket): bucket is SnapshotHistoryBucket => bucket !== undefined)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    if (!buckets.some(b => b.dateKey === todayKey)) {
      buckets.push({ dateKey: todayKey });
      buckets.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }
    return buckets.length > 0 ? buckets : undefined;
  }

  if (!state.tracing) {
    return [{ dateKey: todayKey }];
  }
  const t = state.tracing;
  const bucket: SnapshotHistoryBucket = { dateKey: todayKey };

  const inputTokens = safePositiveNumber(t.totalInputTokens);
  const outputTokens = safePositiveNumber(t.totalOutputTokens);
  const cacheCreationTokens = safePositiveNumber(t.totalCachedInputTokens);
  const cacheReadTokens = safePositiveNumber(t.currentCacheReadInputTokens);
  const reasoningOutputTokens = safePositiveNumber(t.totalReasoningOutputTokens);

  if (inputTokens !== undefined) { bucket.inputTokens = inputTokens; }
  if (outputTokens !== undefined) { bucket.outputTokens = outputTokens; }
  if (cacheCreationTokens !== undefined) { bucket.cacheCreationTokens = cacheCreationTokens; }
  if (cacheReadTokens !== undefined) { bucket.cacheReadTokens = cacheReadTokens; }
  if (reasoningOutputTokens !== undefined) { bucket.reasoningOutputTokens = reasoningOutputTokens; }

  const hasAnyField = hasTokenData(bucket);

  return hasAnyField ? [bucket] : undefined;
}

function buildProviderUsage(
  state: ProviderUsageState,
  _extraContributions?: ModelContributionInput[],
  historyInput?: ProviderHistoryInput
): SnapshotProviderUsageV2 | undefined {
  if (!state.fiveHour && !state.sevenDay) {
    return undefined;
  }

  const kind = state.fiveHour?.sourceKind ?? state.sevenDay?.sourceKind;

  const base: SnapshotProviderUsageV2 = {
    provider: state.provider === 'claude' ? 'claude' : 'codex',
    sourceLabel: state.provider === 'claude' ? 'Claude' : 'Codex',
    fiveHourUsedPercent: windowUsedPercent(state.fiveHour),
    sevenDayUsedPercent: windowUsedPercent(state.sevenDay),
    lastUpdatedEpochMs: state.lastUpdatedEpochMs,
    stale: Boolean(state.stale),
    source: mapSourceKind(kind),
    sourceConfidence: deriveSourceConfidence(state.authenticatedStatus, kind, state.stale)
  };

  const fiveHourReset = safePositiveNumber(state.fiveHour?.resetsAtEpochSeconds);
  const sevenDayReset = safePositiveNumber(state.sevenDay?.resetsAtEpochSeconds);
  if (fiveHourReset !== undefined) {
    base.fiveHourResetAtEpochSeconds = fiveHourReset;
  }
  if (sevenDayReset !== undefined) {
    base.sevenDayResetAtEpochSeconds = sevenDayReset;
  }

  const historyBuckets = buildHistoryBuckets(state, historyInput);
  if (historyBuckets !== undefined && historyBuckets.length > 0) {
    base.historyBuckets = historyBuckets;
  }

  return base;
}

export function buildMachineSnapshot(
  config: SnapshotWriterConfig,
  states: ProviderUsageState[],
  extraModelData?: Record<string, ModelContributionInput[]>,
  historyData?: Record<string, ProviderHistoryInput | undefined>
): PromptFuelMachineSnapshotV2 {
  const providers = states
    .map(state => buildProviderUsage(state, extraModelData?.[state.provider], historyData?.[state.provider]))
    .filter((p): p is SnapshotProviderUsageV2 => p !== undefined);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    writerVersion: EXTENSION_VERSION,
    generatedAtEpochMs: Date.now(),
    machineLabel: config.machineLabel || 'unknown',
    providerUsage: providers.length > 0 ? providers : undefined,
  };
}

export async function writeMachineSnapshotToPath(
  filePath: string,
  snapshot: PromptFuelMachineSnapshotV2
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
  const json = JSON.stringify(snapshot, null, 2) + '\n';
  try {
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await cleanupTempSnapshotFile(tmpPath);
    throw error;
  }
}

export async function writeMachineSnapshotIfEnabled(
  config: SnapshotWriterConfig,
  stateDirectory: string,
  states: ProviderUsageState[],
  extraModelData?: Record<string, ModelContributionInput[]>,
  historyData?: Record<string, ProviderHistoryInput | undefined>
): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const snapshot = buildMachineSnapshot(config, states, extraModelData, historyData);
  const machineLabel = sanitizeMachineLabel(config.machineLabel || 'unknown');
  const snapshotDir = path.join(stateDirectory, 'snapshots');
  const fileName = `${machineLabel}-latest.json`;

  await cleanupSnapshotFiles(snapshotDir);
  await writeMachineSnapshotToPath(path.join(snapshotDir, fileName), snapshot);
  await writeSnapshotHistoryArchives(snapshotDir, snapshot, machineLabel);

  if (config.path) {
    const syncDir = path.resolve(config.path);
    await fs.mkdir(syncDir, { recursive: true });
    await cleanupSnapshotFiles(syncDir);
    await writeMachineSnapshotToPath(path.join(syncDir, fileName), snapshot);
    await writeSnapshotHistoryArchives(syncDir, snapshot, machineLabel);
  }
}

export function isMachineSnapshotPayload(value: unknown): value is PromptFuelMachineSnapshotV2 {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== SNAPSHOT_SCHEMA_V1) {
    return false;
  }
  if (typeof obj.generatedAtEpochMs !== 'number') {
    return false;
  }
  if (typeof obj.machineLabel !== 'string' || !obj.machineLabel) {
    return false;
  }
  if (typeof obj.writerVersion !== 'string' || !obj.writerVersion) {
    return false;
  }
  return true;
}
