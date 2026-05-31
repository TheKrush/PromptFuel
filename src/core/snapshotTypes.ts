import type { ProviderId } from './providers';
import {
  cloneAggregate,
  createEmptyAggregate,
  type AggregateUsage,
  type LocalHistoryWindowAggregateMap,
} from './usageAggregate';

export const PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION = 1;

export interface PromptFuelSnapshotProviderAggregate {
  providerId: ProviderId;
  generatedAtEpochMs: number;
  aggregate: AggregateUsage;
  windowTotals?: Partial<LocalHistoryWindowAggregateMap>;
  sourceLabel?: string;
}

export interface PromptFuelSnapshotState {
  providers: PromptFuelSnapshotProviderAggregate[];
  snapshotCount: number;
  lastReadEpochMs: number | undefined;
}

export function createEmptySnapshotState(lastReadEpochMs?: number): PromptFuelSnapshotState {
  return {
    providers: [],
    snapshotCount: 0,
    lastReadEpochMs,
  };
}

export function cloneSnapshotState(state: PromptFuelSnapshotState): PromptFuelSnapshotState {
  return {
    providers: state.providers.map(provider => ({
      providerId: provider.providerId,
      generatedAtEpochMs: provider.generatedAtEpochMs,
      aggregate: cloneAggregate(provider.aggregate),
      ...(provider.windowTotals ? { windowTotals: cloneWindowTotals(provider.windowTotals) } : {}),
      ...(provider.sourceLabel ? { sourceLabel: provider.sourceLabel } : {}),
    })),
    snapshotCount: state.snapshotCount,
    lastReadEpochMs: state.lastReadEpochMs,
  };
}

export function createZeroSnapshotAggregate(): AggregateUsage {
  return createEmptyAggregate();
}

function cloneWindowTotals(
  windows: Partial<LocalHistoryWindowAggregateMap>,
): Partial<LocalHistoryWindowAggregateMap> {
  const cloned: Partial<LocalHistoryWindowAggregateMap> = {};
  if (windows.today) {
    cloned.today = cloneAggregate(windows.today);
  }
  if (windows.last5h) {
    cloned.last5h = cloneAggregate(windows.last5h);
  }
  if (windows.last7d) {
    cloned.last7d = cloneAggregate(windows.last7d);
  }
  if (windows.all) {
    cloned.all = cloneAggregate(windows.all);
  }
  return cloned;
}
