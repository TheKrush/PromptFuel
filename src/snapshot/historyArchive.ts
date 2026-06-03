import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EXTENSION_VERSION } from '../version';
import {
  SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_V1,
  isSupportedSchemaVersion,
  type PromptFuelMachineSnapshotV2,
  type PromptFuelSnapshotHistoryArchiveMonth,
  type SanitizedHistorySource,
  type SnapshotHistoryArchiveProvider,
  type SnapshotHistoryBucket,
  type SnapshotProviderName
} from './types';
import { cloneSnapshotHistoryBucket, mergeHistoryBucketsByDate } from './historyBucketMerge';

const ARCHIVE_ROOT_FIELDS = [
  'schemaVersion',
  'archiveSchemaVersion',
  'generatedAtEpochMs',
  'machineLabel',
  'month',
  'providers',
  'writerVersion'
];
const ARCHIVE_PROVIDER_FIELDS = ['provider', 'historyBuckets'];
const ARCHIVE_BUCKET_FIELDS = ['dateKey', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns', 'sourceConfidence', 'models'];
const ARCHIVE_MODEL_FIELDS = ['model', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderName(value: unknown): value is SnapshotProviderName {
  return value === 'claude' || value === 'codex';
}

function defaultSourceLabel(provider: SnapshotProviderName): string {
  return provider === 'claude' ? 'Claude' : 'Codex';
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return false;
    }
  }
  return true;
}

function isNonNegativeNumberOrUndefined(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isValidArchiveModel(value: unknown): boolean {
  if (!isObject(value) || !hasOnlyKeys(value, ARCHIVE_MODEL_FIELDS)) {
    return false;
  }
  if (typeof value.model !== 'string' || !value.model) {
    return false;
  }
  for (const key of ARCHIVE_MODEL_FIELDS) {
    if (key !== 'model' && !isNonNegativeNumberOrUndefined(value[key])) {
      return false;
    }
  }
  return true;
}

function isValidArchiveBucket(value: unknown, month: string): value is SnapshotHistoryBucket {
  if (!isObject(value) || !hasOnlyKeys(value, ARCHIVE_BUCKET_FIELDS)) {
    return false;
  }
  if (typeof value.dateKey !== 'string' || !new RegExp(`^${month}-\\d{2}$`).test(value.dateKey)) {
    return false;
  }
  for (const key of ARCHIVE_BUCKET_FIELDS) {
    if (key === 'dateKey' || key === 'sourceConfidence' || key === 'models') {
      continue;
    }
    if (!isNonNegativeNumberOrUndefined(value[key])) {
      return false;
    }
  }
  if (value.sourceConfidence !== undefined && typeof value.sourceConfidence !== 'string') {
    return false;
  }
  if (value.models !== undefined) {
    if (!Array.isArray(value.models)) {
      return false;
    }
    for (const model of value.models) {
      if (!isValidArchiveModel(model)) {
        return false;
      }
    }
  }
  return true;
}

function isValidArchiveProvider(value: unknown, month: string): value is SnapshotHistoryArchiveProvider {
  if (!isObject(value) || !hasOnlyKeys(value, ARCHIVE_PROVIDER_FIELDS)) {
    return false;
  }
  if (!isProviderName(value.provider)) {
    return false;
  }
  if (!Array.isArray(value.historyBuckets)) {
    return false;
  }
  for (const bucket of value.historyBuckets) {
    if (!isValidArchiveBucket(bucket, month)) {
      return false;
    }
  }
  return true;
}

export function validateHistoryArchivePayload(value: unknown): PromptFuelSnapshotHistoryArchiveMonth | undefined {
  if (!isObject(value) || !hasOnlyKeys(value, ARCHIVE_ROOT_FIELDS)) {
    return undefined;
  }
  if (!isSupportedSchemaVersion(value.schemaVersion as number) ||
    value.archiveSchemaVersion !== SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION ||
    typeof value.generatedAtEpochMs !== 'number' ||
    !Number.isFinite(value.generatedAtEpochMs) ||
    value.generatedAtEpochMs <= 0 ||
    typeof value.month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(value.month)) {
    return undefined;
  }
  if (typeof value.machineLabel !== 'string' || !value.machineLabel) {
    return undefined;
  }
  const archiveMachineLabel = value.machineLabel;

  if (typeof value.writerVersion !== 'string' || !value.writerVersion) {
    return undefined;
  }
  const writerVersion = value.writerVersion;

  if (!Array.isArray(value.providers)) {
    return undefined;
  }

  const providers: SnapshotHistoryArchiveProvider[] = [];
  for (const provider of value.providers) {
    if (!isValidArchiveProvider(provider, value.month)) {
      return undefined;
    }
    providers.push(provider);
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    archiveSchemaVersion: SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION,
    writerVersion,
    generatedAtEpochMs: value.generatedAtEpochMs,
    machineLabel: archiveMachineLabel,
    month: value.month,
    providers,
  };
}

export function archiveToSanitizedHistorySources(
  archive: PromptFuelSnapshotHistoryArchiveMonth
): SanitizedHistorySource[] {
  return archive.providers
    .filter(provider => provider.historyBuckets.length > 0)
    .map(provider => ({
      provider: provider.provider,
      sourceLabel: defaultSourceLabel(provider.provider),
      machineLabel: archive.machineLabel,
      schemaVersion: archive.schemaVersion,
      quotaOnly: false,
      stale: false,
      historyBuckets: provider.historyBuckets
    }));
}

function groupSnapshotBucketsByMonth(
  snapshot: PromptFuelMachineSnapshotV2
): Map<string, Map<SnapshotProviderName, SnapshotHistoryBucket[]>> {
  const byMonth = new Map<string, Map<SnapshotProviderName, SnapshotHistoryBucket[]>>();

  for (const provider of snapshot.providerUsage ?? []) {
    for (const bucket of provider.historyBuckets ?? []) {
      const cloned = cloneSnapshotHistoryBucket(bucket);
      if (!cloned) {
        continue;
      }
      const month = cloned.dateKey.slice(0, 7);
      let providerMap = byMonth.get(month);
      if (!providerMap) {
        providerMap = new Map<SnapshotProviderName, SnapshotHistoryBucket[]>();
        byMonth.set(month, providerMap);
      }
      const buckets = providerMap.get(provider.provider) ?? [];
      buckets.push(cloned);
      providerMap.set(provider.provider, buckets);
    }
  }

  return byMonth;
}

function buildArchivePayload(
  snapshot: PromptFuelMachineSnapshotV2,
  month: string,
  incoming: Map<SnapshotProviderName, SnapshotHistoryBucket[]>,
  existing?: PromptFuelSnapshotHistoryArchiveMonth
): PromptFuelSnapshotHistoryArchiveMonth | undefined {
  const providersByName = new Map<SnapshotProviderName, SnapshotHistoryBucket[]>();

  if (existing?.month === month) {
    for (const provider of existing.providers) {
      providersByName.set(provider.provider, provider.historyBuckets);
    }
  }

  for (const [provider, buckets] of incoming) {
    const existingBuckets = providersByName.get(provider) ?? [];
    providersByName.set(provider, mergeHistoryBucketsByDate(existingBuckets, buckets));
  }

  const providers: SnapshotHistoryArchiveProvider[] = Array.from(providersByName.entries())
    .map(([provider, historyBuckets]) => ({ provider, historyBuckets }))
    .filter(provider => provider.historyBuckets.length > 0)
    .sort((a, b) => a.provider.localeCompare(b.provider));

  if (providers.length === 0) {
    return undefined;
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_V1,
    archiveSchemaVersion: SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION,
    writerVersion: EXTENSION_VERSION,
    generatedAtEpochMs: Date.now(),
    machineLabel: snapshot.machineLabel,
    month,
    providers,
  };
}

async function readExistingArchive(filePath: string): Promise<PromptFuelSnapshotHistoryArchiveMonth | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
    return validateHistoryArchivePayload(parsed);
  } catch {
    return undefined;
  }
}

async function writeArchiveToPath(
  filePath: string,
  archive: PromptFuelSnapshotHistoryArchiveMonth
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
  await fs.writeFile(tmpPath, JSON.stringify(archive, null, 2) + '\n', 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function writeSnapshotHistoryArchives(
  rootDir: string,
  snapshot: PromptFuelMachineSnapshotV2,
  machinePathSegment: string
): Promise<void> {
  const byMonth = groupSnapshotBucketsByMonth(snapshot);
  if (byMonth.size === 0) {
    return;
  }

  for (const [month, incoming] of byMonth) {
    const [year, monthPart] = month.split('-');
    if (!year || !monthPart) {
      continue;
    }
    const filePath = path.join(rootDir, 'archive', machinePathSegment, `${year}-${monthPart}.json`);
    const existing = await readExistingArchive(filePath);
    const archive = buildArchivePayload(snapshot, month, incoming, existing);
    if (archive) {
      await writeArchiveToPath(filePath, archive);
    }
  }
}
