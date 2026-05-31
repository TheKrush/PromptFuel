import type { QuotaWindowId } from './quotaTypes';

export type LiveQuotaFreshness = 'live' | 'cached' | 'stale' | 'unavailable' | 'error';

export type LiveQuotaSourceKind = 'authenticated' | 'localSession' | 'cache' | 'stale' | 'unknown';

export type LiveQuotaAvailability = 'available' | 'stale' | 'unavailable' | 'error';

export interface LiveQuotaWindow {
  windowId: QuotaWindowId;
  label?: string;
  usedPercentage?: number;
  remainingPercentage?: number;
  resetsAtEpochMs?: number;
  resetInMs?: number;
  status?: LiveQuotaAvailability;
  sourceKind?: LiveQuotaSourceKind;
  sourceLabel?: string;
  sourceUpdatedEpochMs?: number;
  sourceAuthorityRank?: number;
}

export interface LiveQuotaStatus {
  providerId: string;
  windows: LiveQuotaWindow[];
  status?: LiveQuotaAvailability;
  freshness: LiveQuotaFreshness;
  lastUpdatedEpochMs?: number;
  sanitizedMessage?: string;
  error?: string;
}

export function availabilityFromFreshness(freshness: LiveQuotaFreshness): LiveQuotaAvailability {
  if (freshness === 'error') {
    return 'error';
  }
  if (freshness === 'unavailable') {
    return 'unavailable';
  }
  if (freshness === 'stale') {
    return 'stale';
  }
  return 'available';
}

export function getResetInMs(resetEpochMs: number | undefined, nowMs: number = Date.now()): number | undefined {
  if (resetEpochMs === undefined || !Number.isFinite(resetEpochMs)) {
    return undefined;
  }
  return Math.max(0, resetEpochMs - nowMs);
}

export function getGenericQuotaUnavailableMessage(): string {
  return 'Live quota unavailable';
}
