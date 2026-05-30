import { PROVIDER_LABELS, ProviderId } from './providers';
import { ProviderQuotaState } from './quotaTypes';
import { ReadResult } from './providerReader';

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

export function formatRefreshSummary(results: ReadResult[]): string {
  if (results.length === 0) {
    return 'no providers enabled';
  }
  const parts = results.map(r => {
    const label = PROVIDER_LABELS[r.providerId as ProviderId] ?? r.providerId;
    switch (r.status) {
      case 'ok': {
        const n = r.filesFound ?? 0;
        return `${label}: ${n} session file${n !== 1 ? 's' : ''}`;
      }
      case 'no-data':
        return `${label}: no session files`;
      case 'not-found':
        return `${label}: not found`;
      case 'error':
        return `${label}: read error`;
      default:
        return `${label}: unknown`;
    }
  });
  return parts.join(' | ');
}
