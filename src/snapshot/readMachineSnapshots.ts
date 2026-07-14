import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  isSupportedSchemaVersion,
  SNAPSHOT_SCHEMA_V1,
  type PromptFuelMachineSnapshotProvider,
  type PromptFuelMachineSnapshotV2,
  type SnapshotProviderUsageV2,
  type SnapshotBucketModel,
  type SnapshotUsageMeter,
  type SanitizedHistorySource,
} from './types';
import type { UsageDashboardProvider, UsageDashboardWindow } from '../panel/usageDashboardModel';
import { formatSourceLabel, parsePerWindowReset } from './remoteSourceHelper';
import { formatCountdown } from '../usageTime';
import { quotaLevelForRemaining } from '../display/format';
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

// V1 is the current public snapshot schema baseline.
// Legacy private dev versions (V2/V3) are no longer supported for reading.

const SNAPSHOT_SCHEMA_CURRENT = SNAPSHOT_SCHEMA_V1;

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
  // Unrecognized provider-entry fields are ignored (forward-compatible), not rejected.
  // Known fields are still type-validated below; malformed known fields still reject.

  if (v2.fiveHourResetAtEpochSeconds !== undefined && typeof v2.fiveHourResetAtEpochSeconds !== 'number') {
    return false;
  }
  if (v2.sevenDayResetAtEpochSeconds !== undefined && typeof v2.sevenDayResetAtEpochSeconds !== 'number') {
    return false;
  }

  if (v2.meters !== undefined) {
    if (!Array.isArray(v2.meters)) {
      return false;
    }
    for (const meter of v2.meters) {
      if (!isValidSnapshotUsageMeter(meter)) {
        return false;
      }
    }
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

function isValidSnapshotUsageMeter(value: unknown): value is SnapshotUsageMeter {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || !value.id) {
    return false;
  }
  if (typeof value.label !== 'string' || !value.label) {
    return false;
  }
  if (!['account', 'model', 'modelFamily', 'unknown'].includes(String(value.scope))) {
    return false;
  }
  // Unrecognized meter fields are ignored (forward-compatible); known fields are still type-validated.
  for (const key of Object.keys(value)) {
    if (['windowSeconds', 'usedPercent', 'resetAtEpochSeconds', 'expiresAtEpochSeconds'].includes(key) && value[key] !== undefined && typeof value[key] !== 'number') {
      return false;
    }
    if (['rollup', 'temporary'].includes(key) && value[key] !== undefined && typeof value[key] !== 'boolean') {
      return false;
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

  const genAt = obj.generatedAtEpochMs;
  if (typeof genAt !== 'number' || !Number.isFinite(genAt) || genAt <= 0) {
    return undefined;
  }

  if (typeof obj.machineLabel !== 'string' || !obj.machineLabel) {
    return undefined;
  }

  if (typeof obj.writerVersion !== 'string' || !obj.writerVersion) {
    return undefined;
  }

  const generatedAtEpochMs = obj.generatedAtEpochMs as number;

  let providerUsage: SnapshotProviderUsageV2[] | undefined;
  if (obj.providerUsage !== undefined) {
    if (!Array.isArray(obj.providerUsage)) {
      return undefined;
    }
    providerUsage = [];
    for (const item of obj.providerUsage) {
      if (!isValidSnapshotProviderV2(item)) {
        return undefined;
      }
      providerUsage.push(item as SnapshotProviderUsageV2);
    }
  }

  const snap: PromptFuelMachineSnapshotV2 = {
    schemaVersion: SNAPSHOT_SCHEMA_CURRENT,
    writerVersion: String(obj.writerVersion),
    generatedAtEpochMs,
    machineLabel: obj.machineLabel as string,
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
  config: SnapshotReaderConfig,
  nowEpochMs = Date.now()
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

      const validated = validateSnapshotPayload(parsed);
      if (!validated) {
        result.errors.push({ filePath, reason: 'Snapshot validation failed: missing or invalid required fields' });
        continue;
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

function snapshotLevel(remaining: number | undefined): UsageDashboardWindow['level'] {
  const level = remaining === undefined ? undefined : quotaLevelForRemaining(remaining);
  return level === 'unavailable' ? undefined : level;
}

function buildSnapshotWindow(
  key: string,
  label: string,
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
    key,
    label,
    usedPercent: used,
    remainingPercent: remaining,
    level: snapshotLevel(remaining),
    resetIso,
    available: available
  };
}

function buildSnapshotSevenDayWindow(
  usedPercent: number | undefined,
  resetAtEpochSeconds: number | undefined
): UsageDashboardWindow {
  return buildSnapshotWindow('sevenDay', '7d', usedPercent, resetAtEpochSeconds);
}

function buildSnapshotMeterWindow(meter: SnapshotUsageMeter): UsageDashboardWindow {
  return buildSnapshotWindow('meter:' + meter.id, meter.label, meter.usedPercent, meter.resetAtEpochSeconds);
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
  snapshotStale: boolean,
  snapshotGeneratedAtEpochMs: number | undefined
): UsageDashboardProvider {
  const sevenDayReset = resolveResetEpoch(snapProvider, 'sevenDay');
  const fiveHourReset = resolveResetEpoch(snapProvider, 'fiveHour');
  const snapshotEpochMs = typeof snapshotGeneratedAtEpochMs === 'number'
    && Number.isFinite(snapshotGeneratedAtEpochMs)
    && snapshotGeneratedAtEpochMs > 0
    ? snapshotGeneratedAtEpochMs
    : undefined;
  const stale = snapshotEpochMs === undefined || snapshotStale;
  const windows: UsageDashboardWindow[] = [
    snapProvider.sevenDayUsedPercent !== undefined
      ? buildSnapshotSevenDayWindow(snapProvider.sevenDayUsedPercent, sevenDayReset)
      : { key: 'sevenDay', label: '7d', available: false },
    snapProvider.fiveHourUsedPercent !== undefined
      ? buildSnapshotWindow('fiveHour', '5h', snapProvider.fiveHourUsedPercent, fiveHourReset)
      : { key: 'fiveHour', label: '5h', available: false },
    ...(snapProvider.meters ?? []).map(meter => buildSnapshotMeterWindow(meter))
  ].map(window => ({
    ...window,
    health: !window.available ? 'missing' : stale ? 'stale' : undefined,
    ...(window.available && stale && snapshotEpochMs === undefined
      ? { healthDetail: 'Quota value is stale.' }
      : {})
  }));

  return {
    provider: snapProvider.provider === 'claude' ? 'claude' : snapProvider.provider === 'codex' ? 'codex' : 'codex',
    label: snapProvider.sourceLabel,
    stale,
    source: snapshotEpochMs === undefined
      ? `Snapshot from ${machineLabel} (timestamp unavailable)`
      : `Snapshot from ${machineLabel} ${formatStaleTime(snapshotEpochMs)}${stale ? ' (stale snapshot)' : ''}`,
    lastUpdatedIso: typeof snapshotEpochMs === 'number' && snapshotEpochMs > 0
      ? new Date(snapshotEpochMs).toISOString()
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
      .map(sp => snapshotProviderToDashboardProvider(sp, machineLabel, vs.stale, vs.snapshot.generatedAtEpochMs));

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
      const dp = snapshotProviderToDashboardProvider(sp, machineLabel, vs.stale, vs.snapshot.generatedAtEpochMs);
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
        stale: vs.stale
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
