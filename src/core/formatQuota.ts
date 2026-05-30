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
    case 'loaded':
      if (state.totalTokens !== undefined && state.totalTokens > 0) {
        return `${label} ${formatTokenCount(state.totalTokens)}`;
      }
      return `${label} loaded`;
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
        const msgs = r.totalAssistantMessages ?? 0;
        const tokens = r.totalTokens ?? 0;
        return `${label}: ${n} file${n !== 1 ? 's' : ''}, ${msgs} messages, ${formatTokenCount(tokens)}`;
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

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M tokens`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K tokens`;
  }
  return `${count} tokens`;
}
