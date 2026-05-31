import {
  getGenericQuotaUnavailableMessage,
  type LiveQuotaStatus,
  type LiveQuotaWindow,
} from './liveQuotaTypes';
import type { QuotaWindowId } from './quotaTypes';

export const LIVE_QUOTA_CACHE_KEY = 'promptFuel.liveQuotaLastKnownGood.v1';

const CACHE_SCHEMA_VERSION = 1;

export interface LiveQuotaCacheStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void;
}

export interface LiveQuotaDiagnostics {
  info(message: string): void;
}

interface CachedLiveQuotaWindow {
  windowId: QuotaWindowId;
  label?: string;
  usedPercentage?: number;
  remainingPercentage?: number;
  resetsAtEpochMs?: number;
  refreshedEpochMs: number;
}

interface CachedLiveQuotaProvider {
  providerId: string;
  refreshedEpochMs: number;
  windows: CachedLiveQuotaWindow[];
}

interface CachedLiveQuotaState {
  schemaVersion: 1;
  providers: Record<string, CachedLiveQuotaProvider>;
}

export interface ApplyLiveQuotaCacheOptions {
  storage: LiveQuotaCacheStorage;
  enabledProviderIds: string[];
  liveQuotaEnabled: boolean;
  liveResults: LiveQuotaStatus[];
  nowMs?: number;
  diagnostics?: LiveQuotaDiagnostics;
}

export async function applyLiveQuotaCacheFallback(
  options: ApplyLiveQuotaCacheOptions,
): Promise<LiveQuotaStatus[]> {
  const nowMs = options.nowMs ?? Date.now();

  if (!options.liveQuotaEnabled) {
    options.diagnostics?.info('live quota disabled; stale cache not used');
    return [];
  }

  const enabled = new Set(options.enabledProviderIds);
  const resultByProvider = new Map(
    options.liveResults
      .filter(result => enabled.has(result.providerId))
      .map(result => [result.providerId, result]),
  );

  const resolved: LiveQuotaStatus[] = [];

  for (const providerId of options.enabledProviderIds) {
    const liveResult = resultByProvider.get(providerId) ?? createUnavailableStatus(providerId, nowMs);

    if (isSuccessfulLiveQuotaResult(liveResult)) {
      try {
        await cacheSuccessfulLiveQuota(options.storage, liveResult, nowMs);
        options.diagnostics?.info(
          `provider live read success; provider=${providerId}; windows=${liveResult.windows.length}; cache=stored`,
        );
      } catch {
        options.diagnostics?.info(
          `provider live read success; provider=${providerId}; windows=${liveResult.windows.length}; cache=store_failed`,
        );
      }
      resolved.push(liveResult);
      continue;
    }

    const stale = getStaleLiveQuotaStatus(options.storage, providerId, nowMs);
    if (stale) {
      options.diagnostics?.info(
        `provider live read failed with stale fallback used; provider=${providerId}; windows=${stale.windows.length}`,
      );
      resolved.push(stale);
      continue;
    }

    options.diagnostics?.info(`provider live read failed with no cache; provider=${providerId}`);
    resolved.push(liveResult);
  }

  return resolved;
}

export async function cacheSuccessfulLiveQuota(
  storage: LiveQuotaCacheStorage,
  result: LiveQuotaStatus,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!isSuccessfulLiveQuotaResult(result)) {
    return;
  }

  const windows = result.windows
    .map(window => toCachedWindow(window, result.lastUpdatedEpochMs ?? nowMs))
    .filter((window): window is CachedLiveQuotaWindow => window !== undefined);

  if (windows.length === 0) {
    return;
  }

  const state = readCacheState(storage);
  state.providers[result.providerId] = {
    providerId: result.providerId,
    refreshedEpochMs: result.lastUpdatedEpochMs ?? nowMs,
    windows,
  };

  await storage.update(LIVE_QUOTA_CACHE_KEY, state);
}

export function getStaleLiveQuotaStatus(
  storage: LiveQuotaCacheStorage,
  providerId: string,
  nowMs: number = Date.now(),
): LiveQuotaStatus | undefined {
  const cached = readCacheState(storage).providers[providerId];
  if (!cached || cached.windows.length === 0) {
    return undefined;
  }

  const windows: LiveQuotaWindow[] = cached.windows.map(window => ({
    windowId: window.windowId,
    label: window.label,
    usedPercentage: window.usedPercentage,
    remainingPercentage: window.remainingPercentage,
    resetsAtEpochMs: window.resetsAtEpochMs,
    resetInMs: window.resetsAtEpochMs !== undefined
      ? Math.max(0, window.resetsAtEpochMs - nowMs)
      : undefined,
    status: 'stale',
    sourceKind: 'stale',
    sourceLabel: 'cached live quota',
    sourceUpdatedEpochMs: window.refreshedEpochMs,
    sourceAuthorityRank: 1,
  }));

  return {
    providerId,
    windows,
    status: 'stale',
    freshness: 'stale',
    lastUpdatedEpochMs: cached.refreshedEpochMs,
    sanitizedMessage: 'Using cached live quota from the last successful refresh',
  };
}

export function readCachedLiveQuotaStateForTest(
  storage: LiveQuotaCacheStorage,
): unknown {
  return readCacheState(storage);
}

function isSuccessfulLiveQuotaResult(result: LiveQuotaStatus): boolean {
  const status = result.status;
  return result.freshness === 'live'
    && status !== 'unavailable'
    && status !== 'error'
    && result.windows.length > 0;
}

function toCachedWindow(
  window: LiveQuotaWindow,
  refreshedEpochMs: number,
): CachedLiveQuotaWindow | undefined {
  const usedPercentage = sanitizePercentage(window.usedPercentage);
  const remainingPercentage = sanitizePercentage(window.remainingPercentage);
  const resetsAtEpochMs = sanitizeEpochMs(window.resetsAtEpochMs);

  if (
    usedPercentage === undefined
    && remainingPercentage === undefined
    && resetsAtEpochMs === undefined
  ) {
    return undefined;
  }

  return {
    windowId: window.windowId,
    label: typeof window.label === 'string' ? window.label : undefined,
    usedPercentage,
    remainingPercentage,
    resetsAtEpochMs,
    refreshedEpochMs: sanitizeEpochMs(refreshedEpochMs) ?? Date.now(),
  };
}

function readCacheState(storage: LiveQuotaCacheStorage): CachedLiveQuotaState {
  const raw = storage.get<unknown>(LIVE_QUOTA_CACHE_KEY);
  if (!isRecord(raw) || raw.schemaVersion !== CACHE_SCHEMA_VERSION || !isRecord(raw.providers)) {
    return emptyCacheState();
  }

  const providers: Record<string, CachedLiveQuotaProvider> = {};
  for (const [providerId, provider] of Object.entries(raw.providers)) {
    if (!isRecord(provider) || provider.providerId !== providerId || !Array.isArray(provider.windows)) {
      continue;
    }
    const refreshedEpochMs = sanitizeEpochMs(provider.refreshedEpochMs);
    if (refreshedEpochMs === undefined) {
      continue;
    }

    const windows = provider.windows
      .map(window => isRecord(window) ? readCachedWindow(window) : undefined)
      .filter((window): window is CachedLiveQuotaWindow => window !== undefined);

    if (windows.length > 0) {
      providers[providerId] = {
        providerId,
        refreshedEpochMs,
        windows,
      };
    }
  }

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    providers,
  };
}

function readCachedWindow(window: Record<string, unknown>): CachedLiveQuotaWindow | undefined {
  if (window.windowId !== '5h' && window.windowId !== '7d') {
    return undefined;
  }

  const usedPercentage = sanitizePercentage(window.usedPercentage);
  const remainingPercentage = sanitizePercentage(window.remainingPercentage);
  const resetsAtEpochMs = sanitizeEpochMs(window.resetsAtEpochMs);
  const refreshedEpochMs = sanitizeEpochMs(window.refreshedEpochMs);

  if (
    refreshedEpochMs === undefined
    || (
      usedPercentage === undefined
      && remainingPercentage === undefined
      && resetsAtEpochMs === undefined
    )
  ) {
    return undefined;
  }

  return {
    windowId: window.windowId,
    label: typeof window.label === 'string' ? window.label : undefined,
    usedPercentage,
    remainingPercentage,
    resetsAtEpochMs,
    refreshedEpochMs,
  };
}

function emptyCacheState(): CachedLiveQuotaState {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    providers: {},
  };
}

function createUnavailableStatus(providerId: string, nowMs: number): LiveQuotaStatus {
  return {
    providerId,
    windows: [],
    status: 'unavailable',
    freshness: 'unavailable',
    lastUpdatedEpochMs: nowMs,
    sanitizedMessage: getGenericQuotaUnavailableMessage(),
  };
}

function sanitizePercentage(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, value));
}

function sanitizeEpochMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
