import { PROVIDER_LABELS, ProviderId } from './providers';
import { ReadResult } from './providerReader';
import { formatTooltip, formatTokenCount } from './statusTooltip';
import { formatLiveQuotaStatusBarText } from './formatLiveQuota';
import { PromptFuelStatus } from './statusModel';

export { formatTooltip, formatTokenCount };

export function formatStatusBarText(status: PromptFuelStatus): string {
  return formatLiveQuotaStatusBarText(status);
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
        let text = `${label}: ${msgs} messages, ${formatTokenCount(tokens)} (local history)`;
        if (parseErr > 0) {
          text += `, ${parseErr} parse error${parseErr !== 1 ? 's' : ''}`;
        }
        return text;
      }
      case 'no-data':
        return `${label}: no local usage history`;
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
