import { PROVIDER_LABELS, ProviderId } from './providers';
import { ProviderQuotaState } from './quotaTypes';
import { ReadResult } from './providerReader';
import { PromptFuelStatus } from './statusModel';
import { formatTooltip, formatTokenCount } from './statusTooltip';

export { formatTooltip, formatTokenCount };

export function formatStatusBarText(status: PromptFuelStatus): string {
  const hasError = status.providerStates.some(s => s.status === 'unknown');
  if (hasError) {
    return 'PromptFuel: refresh failed';
  }

  const allNoData = status.providerStates.length > 0 &&
    status.providerStates.every(s => s.status === 'no-data');
  if (allNoData) {
    return 'PromptFuel: no local usage';
  }

  const parts: string[] = [];
  for (const state of status.providerStates) {
    const label = PROVIDER_LABELS[state.providerId as ProviderId] ?? state.providerId;
    const text = formatProviderCompact(label, state);
    if (text) {
      parts.push(text);
    }
  }

  if (parts.length === 0) {
    return 'PromptFuel: no local usage';
  }

  return `PromptFuel: ${parts.join(' | ')}`;
}

function formatProviderCompact(
  label: string,
  state: ProviderQuotaState,
): string {
  switch (state.status) {
    case 'disabled':
      return '';
    case 'loaded':
      if (state.totalTokens !== undefined && state.totalTokens > 0) {
        return `${label} ${formatTokenCountCompact(state.totalTokens)}`;
      }
      return label;
    case 'no-data':
      return `${label} —`;
    case 'unknown':
      return `${label} ✗`;
    default:
      return `${label} …`;
  }
}

function formatTokenCountCompact(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return `${count}`;
}

export function formatRefreshSummary(results: ReadResult[]): string {
  if (results.length === 0) {
    return 'no providers enabled';
  }
  const parts = results.map(r => {
    const label = PROVIDER_LABELS[r.providerId as ProviderId] ?? r.providerId;
    switch (r.status) {
      case 'ok': {
        const msgs = r.totalAssistantMessages ?? 0;
        const tokens = r.totalTokens ?? 0;
        const parseErr = r.parseErrors ?? 0;
        let text = `${label}: ${msgs} messages, ${formatTokenCount(tokens)}`;
        if (parseErr > 0) {
          text += ` (${parseErr} parse error${parseErr !== 1 ? 's' : ''})`;
        }
        return text;
      }
      case 'no-data':
        return `${label}: no local usage`;
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
