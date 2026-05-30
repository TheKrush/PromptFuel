import { PROVIDER_LABELS, ProviderId } from './providers';
import { ProviderQuotaState } from './quotaTypes';

export function formatProviderText(state: ProviderQuotaState): string {
  const label = PROVIDER_LABELS[state.providerId as ProviderId] ?? state.providerId;
  switch (state.status) {
    case 'disabled':
      return '';
    case 'no-data':
      return `${label} —`;
    case 'unknown':
    default:
      return `${label} …`;
  }
}

export function formatStatusBarText(states: ProviderQuotaState[]): string {
  const parts = states.map(formatProviderText).filter(s => s.length > 0);
  if (parts.length === 0) {
    return 'PromptFuel';
  }
  return `⛽ ${parts.join(' | ')}`;
}
