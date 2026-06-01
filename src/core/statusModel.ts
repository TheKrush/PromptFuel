import { ProviderQuotaState, ProviderQuotaStatus, QUOTA_WINDOW_LABELS } from './quotaTypes';
import { ReadResult } from './providerReader';
import { cloneAggregate, LocalHistoryWindowAggregateMap } from './usageAggregate';
import {
  cloneModelUsageAggregates,
  cloneModelUsageWindowAggregates,
  type ModelUsageWindowAggregateMap,
} from './modelUsage';
import {
  availabilityFromFreshness,
  getGenericQuotaUnavailableMessage,
  getResetInMs,
  type LiveQuotaStatus,
} from './liveQuotaTypes';
import {
  cloneSnapshotState,
  createEmptySnapshotState,
  type PromptFuelSnapshotState,
} from './snapshotTypes';

export interface PromptFuelStatus {
  providerStates: ProviderQuotaState[];
  liveQuotaStates: LiveQuotaStatus[];
  liveQuotaEnabled: boolean;
  lastRefreshedMs: number | undefined;
  localHistoryLastRefreshedMs: number | undefined;
  liveQuotaLastRefreshedMs: number | undefined;
  snapshotLastReadMs: number | undefined;
  snapshotState: PromptFuelSnapshotState;
  enabledProviderIds: string[];
}

export function createInitialStatus(
  enabledProviderIds: string[],
  liveQuotaEnabled = true,
): PromptFuelStatus {
  return {
    providerStates: enabledProviderIds.map(id => ({
      providerId: id,
      status: 'no-data' as const,
    })),
    liveQuotaStates: [],
    liveQuotaEnabled,
    lastRefreshedMs: undefined,
    localHistoryLastRefreshedMs: undefined,
    liveQuotaLastRefreshedMs: undefined,
    snapshotLastReadMs: undefined,
    snapshotState: createEmptySnapshotState(),
    enabledProviderIds: enabledProviderIds.slice(),
  };
}

function readResultToQuotaState(
  result: ReadResult,
): ProviderQuotaState {
  let status: ProviderQuotaStatus = 'no-data';

  if (result.status === 'error') {
    status = 'unknown';
  } else if (result.status === 'not-found') {
    status = 'no-data';
  } else if (result.status === 'ok' && (result.totalTokens ?? 0) > 0) {
    status = 'loaded';
  }

  return {
    providerId: result.providerId,
    status,
    totalTokens: result.totalTokens,
    totalAssistantMessages: result.totalAssistantMessages,
    parseErrors: result.parseErrors,
    localHistoryWindows: cloneLocalHistoryWindows(result.localHistoryWindows),
    modelAggregates: cloneModelUsageAggregates(result.modelAggregates),
    localHistoryModelWindows: cloneModelUsageWindowAggregates(result.localHistoryModelWindows) as ModelUsageWindowAggregateMap | undefined,
  };
}

function cloneLocalHistoryWindows(
  windows: LocalHistoryWindowAggregateMap | undefined,
): LocalHistoryWindowAggregateMap | undefined {
  if (!windows) {
    return undefined;
  }

  return {
    today: cloneAggregate(windows.today),
    last5h: cloneAggregate(windows.last5h),
    last7d: cloneAggregate(windows.last7d),
    all: cloneAggregate(windows.all),
  };
}

export function applyRefreshResults(
  status: PromptFuelStatus,
  results: ReadResult[],
): PromptFuelStatus {
  const refreshedMs = Date.now();
  const providerIdSet = new Set(status.enabledProviderIds);
  const stateMap = new Map<string, ProviderQuotaState>();

  for (const state of status.providerStates) {
    stateMap.set(state.providerId, state);
  }

  for (const result of results) {
    if (!providerIdSet.has(result.providerId)) {
      continue;
    }
    stateMap.set(result.providerId, readResultToQuotaState(result));
  }

  return {
    providerStates: [...stateMap.values()],
    liveQuotaStates: status.liveQuotaStates.slice(),
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: refreshedMs,
    localHistoryLastRefreshedMs: refreshedMs,
    liveQuotaLastRefreshedMs: status.liveQuotaLastRefreshedMs,
    snapshotLastReadMs: status.snapshotLastReadMs,
    snapshotState: cloneSnapshotState(status.snapshotState),
    enabledProviderIds: status.enabledProviderIds.slice(),
  };
}

export function getProviderState(
  status: PromptFuelStatus,
  providerId: string,
): ProviderQuotaState | undefined {
  return status.providerStates.find(s => s.providerId === providerId);
}

export function hasAnyLoaded(status: PromptFuelStatus): boolean {
  return status.providerStates.some(s => s.status === 'loaded');
}

export function hasAnyError(status: PromptFuelStatus): boolean {
  return status.providerStates.some(s => s.status === 'unknown');
}

export function applyLiveQuotaResults(
  status: PromptFuelStatus,
  results: LiveQuotaStatus[],
): PromptFuelStatus {
  const refreshedMs = Date.now();
  const providerIdSet = new Set(status.enabledProviderIds);
  const filtered = results
    .filter(r => providerIdSet.has(r.providerId))
    .map(r => normalizeLiveQuotaStatus(r, refreshedMs));

  return {
    providerStates: status.providerStates.slice(),
    liveQuotaStates: filtered,
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: refreshedMs,
    localHistoryLastRefreshedMs: status.localHistoryLastRefreshedMs,
    liveQuotaLastRefreshedMs: refreshedMs,
    snapshotLastReadMs: status.snapshotLastReadMs,
    snapshotState: cloneSnapshotState(status.snapshotState),
    enabledProviderIds: status.enabledProviderIds.slice(),
  };
}

export function applySnapshotReadResults(
  status: PromptFuelStatus,
  snapshotState: PromptFuelSnapshotState,
): PromptFuelStatus {
  const readMs = snapshotState.lastReadEpochMs ?? Date.now();
  return {
    providerStates: status.providerStates.slice(),
    liveQuotaStates: status.liveQuotaStates.slice(),
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: status.lastRefreshedMs,
    localHistoryLastRefreshedMs: status.localHistoryLastRefreshedMs,
    liveQuotaLastRefreshedMs: status.liveQuotaLastRefreshedMs,
    snapshotLastReadMs: readMs,
    snapshotState: cloneSnapshotState(snapshotState),
    enabledProviderIds: status.enabledProviderIds.slice(),
  };
}

export function getLiveQuotaState(
  status: PromptFuelStatus,
  providerId: string,
): LiveQuotaStatus | undefined {
  return status.liveQuotaStates.find(s => s.providerId === providerId);
}

function normalizeLiveQuotaStatus(
  result: LiveQuotaStatus,
  nowMs: number,
): LiveQuotaStatus {
  const status = result.status ?? availabilityFromFreshness(result.freshness);
  const sanitizedMessage = status === 'unavailable' || status === 'error'
    ? getGenericQuotaUnavailableMessage()
    : result.sanitizedMessage;

  return {
    providerId: result.providerId,
    windows: result.windows.map(window => ({
      ...window,
      label: window.label ?? QUOTA_WINDOW_LABELS[window.windowId],
      resetInMs: getResetInMs(window.resetsAtEpochMs, nowMs),
      status: window.status ?? status,
    })),
    status,
    freshness: result.freshness,
    lastUpdatedEpochMs: result.lastUpdatedEpochMs,
    sanitizedMessage,
  };
}
