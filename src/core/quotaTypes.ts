import { LocalHistoryWindowAggregateMap } from './usageAggregate';
import type { ModelUsageAggregate, ModelUsageWindowAggregateMap } from './modelUsage';

export type QuotaWindowId = '5h' | '7d';

export const QUOTA_WINDOWS: ReadonlyArray<QuotaWindowId> = ['5h', '7d'];

export const QUOTA_WINDOW_LABELS: Record<QuotaWindowId, string> = {
  '5h': '5h',
  '7d': '7d',
};

export type ProviderQuotaStatus = 'no-data' | 'disabled' | 'unknown' | 'loaded' | 'not-found';

export interface ProviderQuotaState {
  providerId: string;
  status: ProviderQuotaStatus;
  totalTokens?: number;
  totalAssistantMessages?: number;
  parseErrors?: number;
  localHistoryWindows?: LocalHistoryWindowAggregateMap;
  modelAggregates?: ModelUsageAggregate[];
  localHistoryModelWindows?: ModelUsageWindowAggregateMap;
}
