import { PromptFuelStatus } from '../core/statusModel';
import { ProviderQuotaState } from '../core/quotaTypes';
import { PROVIDER_LABELS } from '../core/providers';
import type { LiveQuotaFreshness } from '../core/liveQuotaTypes';

export interface DashboardProviderCard {
  providerId: string;
  label: string;
  status: string;
  totalTokens: number;
  totalAssistantMessages: number;
  parseErrors: number;
}

export interface DashboardLiveQuotaWindow {
  windowId: string;
  usedPercentage?: number;
  remainingPercentage?: number;
  resetsAtEpochMs?: number;
}

export interface DashboardLiveQuotaCard {
  providerId: string;
  label: string;
  freshness: LiveQuotaFreshness;
  windows: DashboardLiveQuotaWindow[];
  lastUpdatedMs: number | undefined;
}

export interface DashboardModel {
  totalTokens: number;
  totalAssistantMessages: number;
  providers: DashboardProviderCard[];
  liveQuotaCards: DashboardLiveQuotaCard[];
  liveQuotaEnabled: boolean;
  lastRefreshedMs: number | undefined;
  localHistoryLastRefreshedMs: number | undefined;
  liveQuotaLastRefreshedMs: number | undefined;
}

export function buildDashboardModel(status: PromptFuelStatus): DashboardModel {
  let totalTokens = 0;
  let totalAssistantMessages = 0;

  const cards: DashboardProviderCard[] = status.providerStates.map((state: ProviderQuotaState) => {
    const tokens = state.totalTokens ?? 0;
    const messages = state.totalAssistantMessages ?? 0;
    const errors = state.parseErrors ?? 0;

    if (state.status === 'loaded') {
      totalTokens += tokens;
      totalAssistantMessages += messages;
    }

    return {
      providerId: state.providerId,
      label: PROVIDER_LABELS[state.providerId as keyof typeof PROVIDER_LABELS] ?? state.providerId,
      status: state.status,
      totalTokens: tokens,
      totalAssistantMessages: messages,
      parseErrors: errors,
    };
  });

  const liveQuotaCards: DashboardLiveQuotaCard[] = status.liveQuotaStates.map(s => ({
    providerId: s.providerId,
    label: PROVIDER_LABELS[s.providerId as keyof typeof PROVIDER_LABELS] ?? s.providerId,
    freshness: s.freshness,
    windows: s.windows.map(w => ({
      windowId: w.windowId,
      usedPercentage: w.usedPercentage,
      remainingPercentage: w.remainingPercentage,
      resetsAtEpochMs: w.resetsAtEpochMs,
    })),
    lastUpdatedMs: s.lastUpdatedEpochMs,
  }));

  return {
    totalTokens,
    totalAssistantMessages,
    providers: cards,
    liveQuotaCards,
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: status.lastRefreshedMs,
    localHistoryLastRefreshedMs: status.localHistoryLastRefreshedMs,
    liveQuotaLastRefreshedMs: status.liveQuotaLastRefreshedMs,
  };
}
