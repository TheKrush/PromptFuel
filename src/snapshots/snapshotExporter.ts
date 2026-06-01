import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PromptFuelStatus } from '../core/statusModel';
import { isKnownProvider, PROVIDER_LABELS, type ProviderId } from '../core/providers';
import { safeSnapshotSourceLabel } from '../core/snapshotTypes';
import type { AggregateUsage } from '../core/usageAggregate';
import type { ModelUsageAggregate } from '../core/modelUsage';

const EXPORT_SCHEMA_VERSION = 2;
const EXPORT_FILE_NAME = 'promptfuel-latest.json';
const EXPORT_MACHINE_LABEL_FALLBACK = 'promptfuel';

function getExportMachineLabel(configured?: string): string {
  if (configured && configured.trim()) {
    return safeSnapshotSourceLabel(configured.trim(), EXPORT_MACHINE_LABEL_FALLBACK);
  }
  return safeSnapshotSourceLabel(os.hostname(), EXPORT_MACHINE_LABEL_FALLBACK);
}

interface ExportHistoryBucket {
  dateKey: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  messages?: number;
  models?: ExportHistoryBucketModel[];
}

interface ExportHistoryBucketModel {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  messages?: number;
}

interface ExportProviderUsage {
  provider: ProviderId;
  laneLabel: string;
  stale: boolean;
  source: 'snapshot';
  sourceConfidence: 'snapshotOnly';
  lastUpdatedEpochMs: number;
  historyBuckets?: ExportHistoryBucket[];
}

export async function exportPromptFuelUsageSnapshot(
  status: PromptFuelStatus,
  exportDir: string,
  nowMs = Date.now(),
  machineLabel?: string,
): Promise<string> {
  const snapshot = buildPromptFuelUsageSnapshot(status, nowMs, machineLabel);
  await fs.mkdir(exportDir, { recursive: true });
  const filePath = path.join(exportDir, EXPORT_FILE_NAME);
  const tmpPath = `${filePath}.tmp.${process.pid}.${nowMs}`;
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
  return filePath;
}

export function buildPromptFuelUsageSnapshot(status: PromptFuelStatus, nowMs = Date.now(), machineLabel?: string): unknown {
  const providerUsage = status.providerStates
    .map(provider => buildProviderUsage(provider.providerId, provider.localHistoryWindows?.today, provider.localHistoryModelWindows?.today, nowMs))
    .filter((provider): provider is ExportProviderUsage => provider !== undefined);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAtEpochMs: nowMs,
    machine: {
      label: getExportMachineLabel(machineLabel),
    },
    ...(providerUsage.length > 0 ? { providerUsage } : {}),
    exportMeta: {
      extensionVersion: 'promptfuel',
      schemaVersion: EXPORT_SCHEMA_VERSION,
      includeAnalytics: true,
    },
  };
}

function buildProviderUsage(
  providerIdValue: string,
  todayAggregate: AggregateUsage | undefined,
  todayModels: ModelUsageAggregate[] | undefined,
  nowMs: number,
): ExportProviderUsage | undefined {
  if (!isKnownProvider(providerIdValue)) {
    return undefined;
  }

  const bucket = buildTodayBucket(todayAggregate, todayModels, nowMs);
  return {
    provider: providerIdValue,
    laneLabel: PROVIDER_LABELS[providerIdValue],
    stale: false,
    source: 'snapshot',
    sourceConfidence: 'snapshotOnly',
    lastUpdatedEpochMs: nowMs,
    ...(bucket ? { historyBuckets: [bucket] } : {}),
  };
}

function buildTodayBucket(
  aggregate: AggregateUsage | undefined,
  models: ModelUsageAggregate[] | undefined,
  nowMs: number,
): ExportHistoryBucket | undefined {
  const safeAggregate = aggregate && aggregate.totalTokens > 0 ? aggregate : undefined;
  const safeModels = (models ?? [])
    .filter(model => model.totalTokens > 0 && isSafeExportLabel(model.modelLabel))
    .map(model => ({
      model: model.modelLabel,
      outputTokens: model.totalTokens,
      messages: model.totalAssistantMessages,
    }));

  if (!safeAggregate && safeModels.length === 0) {
    return undefined;
  }

  return {
    dateKey: localDateKey(nowMs),
    ...(safeAggregate ? {
      inputTokens: safeAggregate.totalInputTokens,
      outputTokens: safeAggregate.totalOutputTokens,
      cacheCreationTokens: safeAggregate.totalCacheCreationInputTokens,
      cacheReadTokens: safeAggregate.totalCacheReadInputTokens,
      messages: safeAggregate.totalAssistantMessages,
    } : {}),
    ...(safeModels.length > 0 ? { models: safeModels } : {}),
  };
}

function isSafeExportLabel(value: string): boolean {
  return value.length > 0 &&
    value.length <= 80 &&
    !/[\u0000-\u001f\u007f<>|\\/]/.test(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('..');
}

function localDateKey(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
