import { PROVIDER_LABELS, ProviderId } from './providers';
import { ProviderQuotaState } from './quotaTypes';
import { PromptFuelStatus } from './statusModel';
import { formatLiveQuotaTooltip, hasUsableLiveQuota, hasAnyLiveQuota } from './formatLiveQuota';

export { formatLiveQuotaTooltip, hasUsableLiveQuota, hasAnyLiveQuota };

const LINE_SEPARATOR = '\n';

export function formatTooltip(status: PromptFuelStatus): string {
  if (status.liveQuotaStates.length > 0) {
    return formatLiveQuotaTooltip(status);
  }

  const lines: string[] = [];

  lines.push('PromptFuel');
  lines.push('Local history only');
  lines.push('Live quota not enabled');
  lines.push('Snapshots not included');
  lines.push('');

  let totalTokens = 0;
  let totalMessages = 0;
  let totalParseErrors = 0;

  for (const state of status.providerStates) {
    const label = PROVIDER_LABELS[state.providerId as ProviderId] ?? state.providerId;
    lines.push(formatProviderTooltipLine(label, state));
    if (state.status === 'loaded') {
      totalTokens += state.totalTokens ?? 0;
      totalMessages += state.totalAssistantMessages ?? 0;
    }
    totalParseErrors += state.parseErrors ?? 0;
  }

  if (totalTokens > 0) {
    lines.push('');
    lines.push(`Total local history: ${formatTokenCount(totalTokens)} (${totalMessages} messages)`);
  }

  if (totalParseErrors > 0) {
    lines.push(`Parse errors: ${totalParseErrors}`);
  }

  if (status.lastRefreshedMs) {
    lines.push('');
    lines.push(formatRefreshedAt(status.lastRefreshedMs));
  }

  return lines.join(LINE_SEPARATOR);
}

function formatProviderTooltipLine(
  label: string,
  state: ProviderQuotaState,
): string {
  const parts: string[] = [label];

  switch (state.status) {
    case 'loaded':
      parts.push('loaded');
      if (state.totalTokens !== undefined && state.totalTokens > 0) {
        parts.push(`${formatTokenCount(state.totalTokens)}`);
      }
      if (state.totalAssistantMessages !== undefined && state.totalAssistantMessages > 0) {
        parts.push(`${state.totalAssistantMessages} messages`);
      }
      break;

    case 'no-data':
      parts.push('no local data');
      break;

    case 'unknown':
      parts.push('read error');
      break;

    case 'disabled':
      parts.push('disabled');
      break;
  }

  return parts.join(' · ');
}

function formatRefreshedAt(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `Last refreshed: ${hours}:${minutes}:${seconds}`;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M tokens`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K tokens`;
  }
  return `${count} tokens`;
}
