import { PromptFuelStatus } from '../core/statusModel';
import { ProviderQuotaState } from '../core/quotaTypes';
import { PROVIDER_LABELS } from '../core/providers';
import type { LiveQuotaFreshness } from '../core/liveQuotaTypes';
import {
  DEFAULT_LOCAL_HISTORY_WINDOW_ID,
  LOCAL_HISTORY_WINDOW_IDS,
  LOCAL_HISTORY_WINDOW_LABELS,
  LocalHistoryWindowAggregateMap,
  LocalHistoryWindowId,
  createEmptyAggregate,
} from '../core/usageAggregate';

export interface DashboardLocalHistoryWindow {
  windowId: LocalHistoryWindowId;
  label: string;
  totalTokens: number;
  totalAssistantMessages: number;
}

export interface DashboardProviderCard {
  providerId: string;
  label: string;
  status: string;
  totalTokens: number;
  totalAssistantMessages: number;
  parseErrors: number;
  localHistoryWindows: DashboardLocalHistoryWindow[];
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
  localHistoryWindows: DashboardLocalHistoryWindow[];
  defaultLocalHistoryWindowId: LocalHistoryWindowId;
  liveQuotaCards: DashboardLiveQuotaCard[];
  liveQuotaEnabled: boolean;
  lastRefreshedMs: number | undefined;
  localHistoryLastRefreshedMs: number | undefined;
  liveQuotaLastRefreshedMs: number | undefined;
}

export function buildDashboardModel(status: PromptFuelStatus): DashboardModel {
  let totalTokens = 0;
  let totalAssistantMessages = 0;
  const combinedWindows = createEmptyLocalHistoryWindowTotals();

  const cards: DashboardProviderCard[] = status.providerStates.map((state: ProviderQuotaState) => {
    const tokens = state.totalTokens ?? 0;
    const messages = state.totalAssistantMessages ?? 0;
    const errors = state.parseErrors ?? 0;
    const providerWindows = buildLocalHistoryWindowCards(
      state.localHistoryWindows,
      tokens,
      messages,
    );

    if (state.status === 'loaded') {
      totalTokens += tokens;
      totalAssistantMessages += messages;
      mergeDashboardWindowTotals(combinedWindows, providerWindows);
    }

    return {
      providerId: state.providerId,
      label: PROVIDER_LABELS[state.providerId as keyof typeof PROVIDER_LABELS] ?? state.providerId,
      status: state.status,
      totalTokens: tokens,
      totalAssistantMessages: messages,
      parseErrors: errors,
      localHistoryWindows: providerWindows,
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
    localHistoryWindows: buildLocalHistoryWindowCards(combinedWindows, totalTokens, totalAssistantMessages),
    defaultLocalHistoryWindowId: DEFAULT_LOCAL_HISTORY_WINDOW_ID,
    liveQuotaCards,
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: status.lastRefreshedMs,
    localHistoryLastRefreshedMs: status.localHistoryLastRefreshedMs,
    liveQuotaLastRefreshedMs: status.liveQuotaLastRefreshedMs,
  };
}

function buildLocalHistoryWindowCards(
  windows: LocalHistoryWindowAggregateMap | undefined,
  totalTokens: number,
  totalAssistantMessages: number,
): DashboardLocalHistoryWindow[] {
  return LOCAL_HISTORY_WINDOW_IDS.map(windowId => {
    const aggregate = windows?.[windowId];
    if (aggregate) {
      return {
        windowId,
        label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
        totalTokens: aggregate.totalTokens,
        totalAssistantMessages: aggregate.totalAssistantMessages,
      };
    }

    return {
      windowId,
      label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
      totalTokens: windowId === 'all' ? totalTokens : 0,
      totalAssistantMessages: windowId === 'all' ? totalAssistantMessages : 0,
    };
  });
}

function createEmptyLocalHistoryWindowTotals(): LocalHistoryWindowAggregateMap {
  return {
    today: createEmptyAggregate(),
    last5h: createEmptyAggregate(),
    last7d: createEmptyAggregate(),
    all: createEmptyAggregate(),
  };
}

function mergeDashboardWindowTotals(
  totals: LocalHistoryWindowAggregateMap,
  windows: DashboardLocalHistoryWindow[],
): void {
  for (const window of windows) {
    totals[window.windowId].totalTokens += window.totalTokens;
    totals[window.windowId].totalAssistantMessages += window.totalAssistantMessages;
  }
}
