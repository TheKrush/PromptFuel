import { ProviderQuotaState, ProviderQuotaStatus } from './quotaTypes';
import { ReadResult } from './providerReader';

export interface PromptFuelStatus {
  providerStates: ProviderQuotaState[];
  lastRefreshedMs: number | undefined;
  enabledProviderIds: string[];
}

export function createInitialStatus(
  enabledProviderIds: string[],
): PromptFuelStatus {
  return {
    providerStates: enabledProviderIds.map(id => ({
      providerId: id,
      status: 'no-data' as const,
    })),
    lastRefreshedMs: undefined,
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
  };
}

export function applyRefreshResults(
  status: PromptFuelStatus,
  results: ReadResult[],
): PromptFuelStatus {
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
    lastRefreshedMs: Date.now(),
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
