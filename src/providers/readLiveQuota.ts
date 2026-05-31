import type { LiveQuotaReader } from './liveQuotaReader';
import type { LiveQuotaStatus } from '../core/liveQuotaTypes';
import { getGenericQuotaUnavailableMessage } from '../core/liveQuotaTypes';

export async function runLiveQuotaReaders(
  readers: LiveQuotaReader[],
  enabledProviderIds: string[],
): Promise<LiveQuotaStatus[]> {
  const enabled = new Set(enabledProviderIds);
  const active = readers.filter(r => enabled.has(r.providerId));
  return Promise.all(active.map(async (reader) => {
    try {
      return await reader.read();
    } catch {
      return {
        providerId: reader.providerId,
        windows: [],
        status: 'error',
        freshness: 'error',
        lastUpdatedEpochMs: Date.now(),
        sanitizedMessage: getGenericQuotaUnavailableMessage(),
      };
    }
  }));
}
