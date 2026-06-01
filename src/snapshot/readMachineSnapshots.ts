import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  isSupportedSchemaVersion,
  SNAPSHOT_SCHEMA_V2,
  SNAPSHOT_SCHEMA_V3,
  SNAPSHOT_SCHEMA_V4,
  type PromptFuelMachineSnapshotProvider,
  type SnapshotProviderUsageV2,
  type SnapshotBucketModel,
  type SanitizedHistorySource,
  type PromptFuelMachineSnapshotV2
} from './types';
import type { UsageDashboardProvider, UsageDashboardWindow, UsageDashboardSourceInfo } from '../panel/usageDashboardModel';
import { parseRemoteSourceId, formatSourceLabel, parsePerWindowReset } from './remoteSourceHelper';
import { formatCountdown } from '../usageTime';
import { archiveToSanitizedHistorySources, validateHistoryArchivePayload } from './historyArchive';

export interface SnapshotReaderConfig {
  readEnabled: boolean;
  readPath: string;
}

export interface ReadSnapshotResult {
  snapshots: ValidatedSnapshot[];
  errors: SnapshotReaderError[];
  archiveSources?: SanitizedHistorySource[];
}

export interface ValidatedSnapshot {
  snapshot: PromptFuelMachineSnapshotV2;
  filePath: string;
  stale: boolean;
  staleReason?: string;
}

export interface SnapshotReaderError {
  filePath: string;
  reason: string;
}

export const SNAPSHOT_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const MAX_READ_FILES = 20;
const MAX_ARCHIVE_FILES = 240;

const FORBIDDEN_FIELD_NAMES = new Set([
  'sessionId', 'session_id', 'token', 'apiKey', 'api_key',
  'credentials', 'authHeader', 'auth_header', 'prompt',
  'response', 'transcript', 'sessionToken', 'credential',
  'accessToken', 'refreshToken', 'authorization', 'auth',
  'secret', 'password', 'workspace', 'cwd', 'transcriptPath',
  'providerPayload', 'rawProviderPayload', 'rawPayload', 'payload'
]);

const FORBIDDEN_NORMALIZED_KEY_RULES: ReadonlyArray<(key: string) => boolean> = [
  key => key === 'token' || key.endsWith('token'),
  key => key.includes('credential'),
  key => key.includes('secret'),
  key => key.includes('password'),
  key => key === 'auth' || key.startsWith('auth') || key.endsWith('auth'),
  key => key.includes('prompt'),
  key => key.includes('response'),
  key => key.includes('transcript'),
  key => key === 'session' || key.startsWith('session'),
  key => key === 'workspace' || key.startsWith('workspace') || key === 'cwd' || key.startsWith('cwd'),
  key => key === 'payload' || key.includes('providerpayload') || key.includes('rawpayload')
];

const PATH_LIKE_PATTERNS: RegExp[] = [
  /[A-Za-z]:[\\/]/,
  /^\\\\/,
  /(^|[\s"'`])\/(home|Users|var|tmp|mnt|Volumes|opt|etc|private|workspace)\//,
  /(^|[\s"'`])~[\\/]/,
  /(^|[\s"'`])\.\.?[\\/]/,
];

function isForbiddenFieldName(key: string): boolean {
  if (FORBIDDEN_FIELD_NAMES.has(key)) {
    return true;
  }

  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return FORBIDDEN_NORMALIZED_KEY_RULES.some(rule => rule(normalized));
}

function containsForbiddenValue(value: unknown, visited: Set<unknown>): boolean {
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);

  if (typeof value === 'string') {
    for (const pattern of PATH_LIKE_PATTERNS) {
      if (pattern.test(value)) {
        return true;
      }
    }
    if (/sess_[a-zA-Z0-9]/.test(value)) {
      return true;
    }
    return false;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsForbiddenValue(item, visited)) {
        return true;
      }
    }
    return false;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, val] of Object.entries(value)) {
      if (isForbiddenFieldName(key)) {
        return true;
      }
      if (containsForbiddenValue(val, visited)) {
        return true;
      }
    }
  }

  return false;
}

function hasForbiddenContent(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  return containsForbiddenValue(parsed, new Set());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Schema upgrade chain ---
// Each upgradeVNToVN1 validates that the incoming object matches the old schema
// and returns the upgraded object, or null if validation fails.
// upgradeSnapshotToCurrentVersion chains all steps from fromVersion to current.

const SNAPSHOT_SCHEMA_CURRENT = SNAPSHOT_SCHEMA_V4;

function isValidSnapshotProviderAtV2(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  if (value.provider !== 'claude' && value.provider !== 'codex') return false;
  if (typeof value.source !== 'string' ||
    !['authenticated', 'localSession', 'hook', 'snapshot', 'cache', 'stale', 'unknown'].includes(value.source as string)) {
    return false;
  }
  if (typeof value.sourceConfidence !== 'string' ||
    !['trustedCompletedTurnUsage', 'correlatedDayBucket', 'mixedDayBucket', 'quotaState', 'snapshotOnly', 'apiEquivalentEstimate', 'unavailable'].includes(value.sourceConfidence as string)) {
    return false;
  }
  if (typeof value.stale !== 'boolean') return false;
  return typeof value.laneLabel === 'string' || typeof value.sourceLabel === 'string';
}

function upgradeV2ToV3(obj: Record<string, unknown>): Record<string, unknown> | null {
  // Flatten machine: { label } → machineLabel; reject machine objects with extra fields
  let machineLabel: string | undefined;
  if (isObject(obj.machine)) {
    if (Object.keys(obj.machine).length !== 1 || typeof obj.machine.label !== 'string') {
      return null;
    }
    machineLabel = obj.machine.label;
  } else if (typeof obj.machineLabel === 'string') {
    machineLabel = obj.machineLabel;
  }
  if (!machineLabel) return null;

  // Upgrade provider sourceLabel (accept laneLabel or already-renamed sourceLabel)
  let providerUsage = obj.providerUsage;
  if (providerUsage !== undefined) {
    if (!Array.isArray(providerUsage)) return null;
    const upgraded: Record<string, unknown>[] = [];
    for (const item of providerUsage) {
      if (isObject(item) && typeof item.laneLabel === 'string' && item.sourceLabel === undefined) {
        const { laneLabel, ...rest } = item;
        upgraded.push({ ...rest, sourceLabel: laneLabel });
      } else if (isValidSnapshotProviderAtV2(item) || (isObject(item) && typeof item.sourceLabel === 'string')) {
        upgraded.push({ ...(item as Record<string, unknown>) });
      } else {
        return null;
      }
    }
    providerUsage = upgraded;
  }

  const { machine, ...rest } = obj;
  return {
    ...rest,
    machineLabel,
    schemaVersion: SNAPSHOT_SCHEMA_V3,
    exportMeta: { ...(isObject(obj.exportMeta) ? obj.exportMeta : {}), schemaVersion: SNAPSHOT_SCHEMA_V3 },
    ...(providerUsage !== undefined ? { providerUsage } : {})
  };
}

function upgradeV3ToV4(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (!isObject(obj.exportMeta) || typeof obj.exportMeta.extensionVersion !== 'string') {
    return null;
  }
  const writerVersion = obj.exportMeta.extensionVersion;
  const { exportMeta: _dropped, ...rest } = obj;
  return {
    ...rest,
    schemaVersion: SNAPSHOT_SCHEMA_V4,
    writerVersion,
  };
}

function upgradeSnapshotToCurrentVersion(
  obj: Record<string, unknown>,
  fromVersion: number
): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = obj;
  if (fromVersion < SNAPSHOT_SCHEMA_V3) {
    result = upgradeV2ToV3(result);
    if (!result) return null;
  }
  if (fromVersion < SNAPSHOT_SCHEMA_V4) {
    result = upgradeV3ToV4(result);
    if (!result) return null;
  }
  return result;
}

function isValidSnapshotProviderV1(value: unknown): value is PromptFuelMachineSnapshotProvider {
  if (!isObject(value)) {
    return false;
  }
  const provider = value.provider;
  if (provider !== 'claude' && provider !== 'codex') {
    return false;
  }
  const source = value.source;
  if (typeof source !== 'string' ||
    !['authenticated', 'localSession', 'hook', 'snapshot', 'cache', 'stale', 'unknown'].includes(source)) {
    return false;
  }
  const sourceConfidence = value.sourceConfidence;
  if (typeof sourceConfidence !== 'string' ||
    !['trustedCompletedTurnUsage', 'correlatedDayBucket', 'mixedDayBucket', 'quotaState', 'snapshotOnly', 'apiEquivalentEstimate', 'unavailable'].includes(sourceConfidence)) {
    return false;
  }
  if (typeof value.stale !== 'boolean') {
    return false;
  }
  return typeof value.sourceLabel === 'string';
}

function isValidSnapshotProviderV2(value: unknown): value is SnapshotProviderUsageV2 {
  if (!isValidSnapshotProviderV1(value)) {
    return false;
  }

  const v2 = value as unknown as Record<string, unknown>;
  const allowedProviderFields = [
    'provider',
    'sourceLabel',
    'fiveHourUsedPercent',
    'sevenDayUsedPercent',
    'fiveHourResetAtEpochSeconds',
    'sevenDayResetAtEpochSeconds',
    'lastUpdatedEpochMs',
    'stale',
    'source',
    'sourceConfidence',
    'historyBuckets'
  ];
  for (const key of Object.keys(v2)) {
    if (!allowedProviderFields.includes(key)) {
      return false;
    }
  }

  if (v2.fiveHourResetAtEpochSeconds !== undefined && typeof v2.fiveHourResetAtEpochSeconds !== 'number') {
    return false;
  }
  if (v2.sevenDayResetAtEpochSeconds !== undefined && typeof v2.sevenDayResetAtEpochSeconds !== 'number') {
    return false;
  }

  if (v2.historyBuckets !== undefined) {
    if (!Array.isArray(v2.historyBuckets)) {
      return false;
    }
    for (const bucket of v2.historyBuckets) {
      if (!isObject(bucket)) {
        return false;
      }
      if (typeof bucket.dateKey !== 'string' || !bucket.dateKey) {
        return false;
      }
      const allowedBucketFields = ['dateKey', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns', 'sourceConfidence', 'models'];
      for (const key of Object.keys(bucket)) {
        if (!allowedBucketFields.includes(key)) {
          return false;
        }
      }
      if (bucket.models !== undefined) {
        if (!Array.isArray(bucket.models)) {
          return false;
        }
        for (const model of bucket.models) {
          if (!isValidSnapshotModelContribution(model)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

function isValidSnapshotModelContribution(value: unknown): value is SnapshotBucketModel {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.model !== 'string' || !value.model) {
    return false;
  }
  const allowedMcFields = [
    'model',
    'inputTokens',
    'outputTokens',
    'cacheCreationTokens',
    'cacheReadTokens',
    'reasoningOutputTokens',
    'requests',
    'messages',
    'turns'
  ];
  for (const key of Object.keys(value)) {
    if (!allowedMcFields.includes(key)) {
      return false;
    }
    if (key !== 'model' && typeof value[key] !== 'number') {
      return false;
    }
  }
  return true;
}

function validateSnapshotPayload(obj: unknown): PromptFuelMachineSnapshotV2 | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const fromVersion = obj.schemaVersion as number;
  if (!isSupportedSchemaVersion(fromVersion)) {
    return undefined;
  }

  // Apply upgrade chain for any version older than current.
  const isLegacy = fromVersion < SNAPSHOT_SCHEMA_CURRENT;
  let target: Record<string, unknown> = obj;
  if (isLegacy) {
    const upgraded = upgradeSnapshotToCurrentVersion(obj, fromVersion);
    if (!upgraded) return undefined;
    target = upgraded;
  }

  const genAt = target.generatedAtEpochMs;
  if (typeof genAt !== 'number' || !Number.isFinite(genAt) || genAt <= 0) {
    return undefined;
  }

  if (typeof target.machineLabel !== 'string' || !target.machineLabel) {
    return undefined;
  }

  if (typeof target.writerVersion !== 'string' || !target.writerVersion) {
    return undefined;
  }

  const generatedAtEpochMs = target.generatedAtEpochMs as number;

  let providerUsage: SnapshotProviderUsageV2[] | undefined;
  if (target.providerUsage !== undefined) {
    if (!Array.isArray(target.providerUsage)) {
      return undefined;
    }
    providerUsage = [];
    for (const item of target.providerUsage) {
      if (!isValidSnapshotProviderV2(item)) {
        return undefined;
      }
      providerUsage.push(item as SnapshotProviderUsageV2);
    }
  }

  const snap: PromptFuelMachineSnapshotV2 = {
    schemaVersion: SNAPSHOT_SCHEMA_CURRENT,
    writerVersion: String(target.writerVersion),
    generatedAtEpochMs,
    machineLabel: target.machineLabel as string,
    ...(providerUsage !== undefined ? { providerUsage } : {}),
  };

  return snap;
}

function isStale(generatedAtEpochMs: number, nowEpochMs: number): { stale: boolean; reason?: string } {
  const ageMs = nowEpochMs - generatedAtEpochMs;
  if (ageMs < 0) {
    return { stale: true, reason: 'Snapshot timestamp is in the future' };
  }
  if (ageMs > SNAPSHOT_STALE_THRESHOLD_MS) {
    const ageMin = Math.round(ageMs / 60000);
    return { stale: true, reason: `Snapshot is ${ageMin} minutes old (threshold: ${SNAPSHOT_STALE_THRESHOLD_MS / 60000} minutes)` };
  }
  return { stale: false };
}

function logArchiveDiscoveryTruncated(): void {
  console.debug(`PromptFuel: snapshot archive discovery reached MAX_ARCHIVE_FILES=${MAX_ARCHIVE_FILES}; remaining monthly archive files were skipped.`);
}

async function collectArchiveFilePaths(readPath: string): Promise<string[]> {
  const archiveRoot = path.join(readPath, 'archive');
  const filePaths: string[] = [];

  let machineEntries: Dirent[];
  try {
    machineEntries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return filePaths;
  }

  for (const machineEntry of machineEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!machineEntry.isDirectory()) {
      continue;
    }
    const machineDir = path.join(archiveRoot, machineEntry.name);
    let archiveEntries: Dirent[];
    try {
      archiveEntries = await fs.readdir(machineDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const archiveEntry of archiveEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (archiveEntry.isFile() && /^\d{4}-\d{2}\.json$/.test(archiveEntry.name)) {
        filePaths.push(path.join(machineDir, archiveEntry.name));
        if (filePaths.length >= MAX_ARCHIVE_FILES) {
          logArchiveDiscoveryTruncated();
          return filePaths;
        }
        continue;
      }

      if (archiveEntry.isDirectory() && /^\d{4}$/.test(archiveEntry.name)) {
        const yearDir = path.join(machineDir, archiveEntry.name);
        let monthEntries: Dirent[];
        try {
          monthEntries = await fs.readdir(yearDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const monthEntry of monthEntries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!monthEntry.isFile() || !/^\d{2}\.json$/.test(monthEntry.name)) {
            continue;
          }
          filePaths.push(path.join(yearDir, monthEntry.name));
          if (filePaths.length >= MAX_ARCHIVE_FILES) {
            logArchiveDiscoveryTruncated();
            return filePaths;
          }
        }
      }
    }
  }

  return filePaths;
}

async function readArchiveSources(
  readPath: string,
  result: ReadSnapshotResult
): Promise<SanitizedHistorySource[]> {
  const sources: SanitizedHistorySource[] = [];
  const archiveFiles = await collectArchiveFilePaths(readPath);

  for (const filePath of archiveFiles) {
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) {
        result.errors.push({ filePath, reason: 'Archive path is not a regular file' });
        continue;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        result.errors.push({ filePath, reason: 'Invalid archive JSON' });
        continue;
      }

      if (hasForbiddenContent(parsed)) {
        result.errors.push({ filePath, reason: 'Archive contains forbidden field values' });
        continue;
      }

      const archive = validateHistoryArchivePayload(parsed);
      if (!archive) {
        result.errors.push({ filePath, reason: 'Archive validation failed: missing or invalid required fields' });
        continue;
      }
      sources.push(...archiveToSanitizedHistorySources(archive));
    } catch {
      result.errors.push({ filePath, reason: 'Failed to read archive file' });
    }
  }

  return sources;
}

export async function readMachineSnapshots(
  config: SnapshotReaderConfig
): Promise<ReadSnapshotResult> {
  const result: ReadSnapshotResult = { snapshots: [], errors: [] };

  if (!config.readEnabled || !config.readPath) {
    return result;
  }

  let files: string[];
  try {
    const entries = await fs.readdir(config.readPath, { withFileTypes: true });
    files = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name);
  } catch {
    return result;
  }

  const latestFiles = files
    .filter(f => f.endsWith('-latest.json'))
    .slice(0, MAX_READ_FILES);

  const nowEpochMs = Date.now();

  for (const fileName of latestFiles) {
    const filePath = path.join(config.readPath, fileName);
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) {
        result.errors.push({ filePath, reason: 'Snapshot path is not a regular file' });
        continue;
      }

      const content = await fs.readFile(filePath, 'utf-8');

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        result.errors.push({ filePath, reason: 'Invalid JSON' });
        continue;
      }

      if (hasForbiddenContent(parsed)) {
        result.errors.push({ filePath, reason: 'Snapshot contains forbidden field values' });
        continue;
      }

      const parsedVersion = isObject(parsed) ? (parsed.schemaVersion as number) : undefined;
      const validated = validateSnapshotPayload(parsed);
      if (!validated) {
        result.errors.push({ filePath, reason: 'Snapshot validation failed: missing or invalid required fields' });
        continue;
      }

      if (typeof parsedVersion === 'number' && parsedVersion < SNAPSHOT_SCHEMA_CURRENT) {
        try {
          await fs.writeFile(filePath, JSON.stringify(validated, null, 2), 'utf-8');
        } catch {
          // Write-back failure is non-fatal; in-memory snapshot is already upgraded.
        }
      }

      const { stale, reason: staleReason } = isStale(validated.generatedAtEpochMs, nowEpochMs);

      result.snapshots.push({
        snapshot: validated,
        filePath,
        stale,
        staleReason
      });
    } catch {
      result.errors.push({ filePath, reason: 'Failed to read snapshot file' });
    }
  }

  const archiveSources = await readArchiveSources(config.readPath, result);
  if (archiveSources.length > 0) {
    result.archiveSources = archiveSources;
  }

  return result;
}

function formatStaleTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) {
    return 'just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  const remainMin = diffMin % 60;
  if (diffHours < 24) {
    return remainMin > 0 ? `${diffHours}h ${remainMin}m ago` : `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function resolveResetEpoch(
  snapProvider: SnapshotProviderUsageV2,
  windowKey: 'fiveHour' | 'sevenDay'
): number | undefined {
  const resetInfo = parsePerWindowReset(
    snapProvider.sevenDayResetAtEpochSeconds,
    snapProvider.fiveHourResetAtEpochSeconds
  );
  return windowKey === 'fiveHour'
    ? resetInfo.fiveHourResetEpoch
    : resetInfo.sevenDayResetEpoch;
}

function buildSnapshotWindow(
  usedPercent: number | undefined,
  resetAtEpochSeconds: number | undefined
): UsageDashboardWindow {
  const available = typeof usedPercent === 'number' && Number.isFinite(usedPercent) && usedPercent >= 0;
  const used = available ? Math.min(usedPercent!, 100) : undefined;
  const remaining = used !== undefined ? Math.max(0, 100 - used) : undefined;
  const resetIso = typeof resetAtEpochSeconds === 'number' && Number.isFinite(resetAtEpochSeconds) && resetAtEpochSeconds > 0
    ? new Date(resetAtEpochSeconds * 1000).toISOString()
    : undefined;

  return {
    key: 'fiveHour',
    label: '5h',
    usedPercent: used,
    remainingPercent: remaining,
    level: remaining === undefined ? undefined
      : remaining <= 10 ? 'red'
        : remaining <= 20 ? 'orange'
          : remaining <= 40 ? 'yellow'
            : 'green',
    resetIso,
    available: available
  };
}

function buildSnapshotSevenDayWindow(
  usedPercent: number | undefined,
  resetAtEpochSeconds: number | undefined
): UsageDashboardWindow {
  const available = typeof usedPercent === 'number' && Number.isFinite(usedPercent) && usedPercent >= 0;
  const used = available ? Math.min(usedPercent!, 100) : undefined;
  const remaining = used !== undefined ? Math.max(0, 100 - used) : undefined;
  const resetIso = typeof resetAtEpochSeconds === 'number' && Number.isFinite(resetAtEpochSeconds) && resetAtEpochSeconds > 0
    ? new Date(resetAtEpochSeconds * 1000).toISOString()
    : undefined;

  return {
    key: 'sevenDay',
    label: '7d',
    usedPercent: used,
    remainingPercent: remaining,
    level: remaining === undefined ? undefined
      : remaining <= 10 ? 'red'
        : remaining <= 20 ? 'orange'
          : remaining <= 40 ? 'yellow'
            : 'green',
    resetIso,
    available: available
  };
}

export interface GroupedRemoteProvider {
  machineLabel: string;
  stale: boolean;
  lastUpdatedIso?: string;
  providers: UsageDashboardProvider[];
  hasSelectedSources?: boolean;
}

export function snapshotProviderToDashboardProvider(
  snapProvider: SnapshotProviderUsageV2,
  machineLabel: string,
  snapshotStale = false
): UsageDashboardProvider {
  const windows: UsageDashboardWindow[] = [];

  const sevenDayReset = resolveResetEpoch(snapProvider, 'sevenDay');
  const fiveHourReset = resolveResetEpoch(snapProvider, 'fiveHour');

  if (snapProvider.sevenDayUsedPercent !== undefined) {
    windows.push(buildSnapshotSevenDayWindow(snapProvider.sevenDayUsedPercent, sevenDayReset));
  }
  if (snapProvider.fiveHourUsedPercent !== undefined) {
    windows.push(buildSnapshotWindow(snapProvider.fiveHourUsedPercent, fiveHourReset));
  }

  if (windows.length === 0) {
    windows.push({
      key: 'sevenDay',
      label: '7d',
      available: false
    }, {
      key: 'fiveHour',
      label: '5h',
      available: false
    });
  }

  const stale = snapshotStale || snapProvider.stale;

  return {
    provider: snapProvider.provider === 'claude' ? 'claude' : snapProvider.provider === 'codex' ? 'codex' : 'codex',
    label: snapProvider.sourceLabel,
    stale,
    source: `Snapshot from ${machineLabel} ${formatStaleTime(snapProvider.lastUpdatedEpochMs ?? Date.now())}${snapshotStale ? ' (stale snapshot)' : ''}`,
    lastUpdatedIso: typeof snapProvider.lastUpdatedEpochMs === 'number' && snapProvider.lastUpdatedEpochMs > 0
      ? new Date(snapProvider.lastUpdatedEpochMs).toISOString()
      : undefined,
    windows,
    machineLabel
  };
}

export function buildRemoteProvidersFromSnapshots(
  snapshots: ValidatedSnapshot[],
  selectedSources?: Set<string>
): GroupedRemoteProvider[] {
  return snapshots.map(vs => {
    const machineLabel = vs.snapshot.machineLabel;
    const providers = (vs.snapshot.providerUsage ?? [])
      .map(sp => snapshotProviderToDashboardProvider(sp, machineLabel, vs.stale));

    const hasSelectedSources = selectedSources !== undefined && (vs.snapshot.providerUsage ?? []).some(sp =>
      selectedSources.has(`${machineLabel}/${sp.provider}`)
    );

    const filteredProviders = hasSelectedSources
      ? providers.filter(dp => !selectedSources!.has(`${machineLabel}/${dp.provider}`))
      : providers;

    return {
      machineLabel,
      stale: vs.stale,
      lastUpdatedIso: new Date(vs.snapshot.generatedAtEpochMs).toISOString(),
      providers: filteredProviders,
      hasSelectedSources
    };
  });
}

export function buildSelectedRemoteSourceProviders(
  snapshots: ValidatedSnapshot[],
  selectedSources: Set<string>,
  aliasMap: Record<string, string>
): UsageDashboardProvider[] {
  const providers: UsageDashboardProvider[] = [];

  for (const vs of snapshots) {
    const machineLabel = vs.snapshot.machineLabel;
    for (const sp of vs.snapshot.providerUsage ?? []) {
      const sourceId = `${machineLabel}/${sp.provider}`;
      if (!selectedSources.has(sourceId)) {
        continue;
      }
      const dp = snapshotProviderToDashboardProvider(sp, machineLabel, vs.stale);
      dp.label = formatSourceLabel(sp.provider, machineLabel, aliasMap);
      providers.push(dp);
    }
  }

  return providers;
}

// --- Sanitized history sources ---

export function buildSanitizedHistorySources(
  snapshots: ValidatedSnapshot[]
): SanitizedHistorySource[] {
  const sources: SanitizedHistorySource[] = [];

  for (const vs of snapshots) {
    const schemaVersion = vs.snapshot.schemaVersion;

    for (const sp of vs.snapshot.providerUsage ?? []) {
      const source: SanitizedHistorySource = {
        provider: sp.provider,
        sourceLabel: sp.sourceLabel,
        machineLabel: vs.snapshot.machineLabel,
        schemaVersion,
        quotaOnly: false,
        stale: vs.stale || sp.stale
      };

      if (sp.fiveHourResetAtEpochSeconds !== undefined) {
        source.fiveHourResetAtEpochSeconds = sp.fiveHourResetAtEpochSeconds;
      }
      if (sp.sevenDayResetAtEpochSeconds !== undefined) {
        source.sevenDayResetAtEpochSeconds = sp.sevenDayResetAtEpochSeconds;
      }
      if (sp.historyBuckets !== undefined && sp.historyBuckets.length > 0) {
        source.historyBuckets = sp.historyBuckets;
      }

      sources.push(source);
    }
  }

  return sources;
}

// --- Per-window countdown support ---

export function resolveRemoteResetEpoch(
  snapProvider: SnapshotProviderUsageV2,
  windowKey: 'fiveHour' | 'sevenDay'
): number | undefined {
  return resolveResetEpoch(snapProvider, windowKey);
}

export function formatRemoteCountdown(
  snapProvider: SnapshotProviderUsageV2,
  windowKey: 'fiveHour' | 'sevenDay'
): string | undefined {
  const resetEpoch = resolveResetEpoch(snapProvider, windowKey);
  if (resetEpoch === undefined) {
    return undefined;
  }
  return formatCountdown(resetEpoch);
}
