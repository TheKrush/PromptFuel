import { PromptFuelStatus } from './statusModel';
import {
  formatLiveQuotaTooltip,
  formatTokenCount,
  hasAnyLiveQuota,
  hasUsableLiveQuota,
} from './formatLiveQuota';

export {
  formatLiveQuotaTooltip,
  formatTokenCount,
  hasAnyLiveQuota,
  hasUsableLiveQuota,
};

export function formatTooltip(status: PromptFuelStatus): string {
  return formatLiveQuotaTooltip(status);
}
