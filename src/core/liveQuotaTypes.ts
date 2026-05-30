import type { QuotaWindowId } from './quotaTypes';

export type LiveQuotaFreshness = 'live' | 'cached' | 'stale' | 'unavailable' | 'error';

export type LiveQuotaSourceKind = 'authenticated' | 'localSession' | 'cache' | 'stale' | 'unknown';

export interface LiveQuotaWindow {
  windowId: QuotaWindowId;
  usedPercentage?: number;
  remainingPercentage?: number;
  resetsAtEpochMs?: number;
  sourceKind?: LiveQuotaSourceKind;
  sourceLabel?: string;
  sourceUpdatedEpochMs?: number;
  sourceAuthorityRank?: number;
}

export interface LiveQuotaStatus {
  providerId: string;
  windows: LiveQuotaWindow[];
  freshness: LiveQuotaFreshness;
  lastUpdatedEpochMs?: number;
  error?: string;
}
