import type { ProviderName, ProviderUsageState, UsageMeter } from '../types';
import {
  isExtraUsageMeter,
  isMeterSelected,
  MeterVisibilityPolicy,
  normalizeUsageMeterId
} from './meterVisibility';

export interface UsageMeterDiscoveryItem {
  provider: ProviderName;
  id: string;
  label: string;
  category: 'extraUsage' | 'generic';
  usedPercentage?: number;
  resetsAtEpochSeconds?: number;
  windowSeconds?: number;
  visible: boolean;
}

export function buildUsageMeterDiscoveryItems(
  states: ReadonlyArray<Pick<ProviderUsageState, 'provider' | 'meters'>>,
  policy?: MeterVisibilityPolicy
): UsageMeterDiscoveryItem[] {
  const items: UsageMeterDiscoveryItem[] = [];
  const seen = new Set<string>();

  for (const state of states ?? []) {
    for (const meter of state.meters ?? []) {
      const item = buildDiscoveryItem(state.provider, meter, policy);
      const dedupeKey = `${item.provider}:${item.id}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      items.push(item);
    }
  }

  items.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  return items;
}

function buildDiscoveryItem(
  provider: ProviderName,
  meter: UsageMeter,
  policy: MeterVisibilityPolicy | undefined
): UsageMeterDiscoveryItem {
  const id = normalizeUsageMeterId(meter.id);
  return {
    provider,
    id,
    label: meter.label,
    category: isExtraUsageMeter(meter) ? 'extraUsage' : 'generic',
    ...(meter.window.usedPercentage !== undefined ? { usedPercentage: meter.window.usedPercentage } : {}),
    ...(meter.window.resetsAtEpochSeconds !== undefined ? { resetsAtEpochSeconds: meter.window.resetsAtEpochSeconds } : {}),
    ...(meter.windowSeconds !== undefined ? { windowSeconds: meter.windowSeconds } : {}),
    visible: isMeterSelected(meter, policy)
  };
}
