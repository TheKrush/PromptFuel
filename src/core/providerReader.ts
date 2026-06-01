import { LocalHistoryWindowAggregateMap } from './usageAggregate';
import type { ModelUsageAggregate, ModelUsageWindowAggregateMap } from './modelUsage';

export type ReadResultStatus = 'ok' | 'not-found' | 'no-data' | 'error';

export interface ReadResult {
  providerId: string;
  status: ReadResultStatus;
  filesFound?: number;
  detail?: string;
  parseErrors?: number;
  recordsRead?: number;
  recordsMatched?: number;
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalAssistantMessages?: number;
  localHistoryWindows?: LocalHistoryWindowAggregateMap;
  modelAggregates?: ModelUsageAggregate[];
  localHistoryModelWindows?: ModelUsageWindowAggregateMap;
}

export interface ProviderReader {
  readonly providerId: string;
  read(): Promise<ReadResult>;
}
