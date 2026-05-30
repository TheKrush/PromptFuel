import type { LiveQuotaReader } from './liveQuotaReader';
import type { LiveQuotaStatus } from '../core/liveQuotaTypes';

export async function runLiveQuotaReaders(
  readers: LiveQuotaReader[],
  enabledProviderIds: string[],
): Promise<LiveQuotaStatus[]> {
  const enabled = new Set(enabledProviderIds);
  const active = readers.filter(r => enabled.has(r.providerId));
  return Promise.all(active.map(r => r.read()));
}
