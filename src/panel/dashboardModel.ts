import { PromptFuelStatus } from '../core/statusModel';
import { ProviderQuotaState } from '../core/quotaTypes';
import { PROVIDER_LABELS } from '../core/providers';

export interface DashboardProviderCard {
  providerId: string;
  label: string;
  status: string;
  totalTokens: number;
  totalAssistantMessages: number;
  parseErrors: number;
}

export interface DashboardModel {
  totalTokens: number;
  totalAssistantMessages: number;
  providers: DashboardProviderCard[];
  lastRefreshedMs: number | undefined;
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

  return {
    totalTokens,
    totalAssistantMessages,
    providers: cards,
    lastRefreshedMs: status.lastRefreshedMs,
  };
}
