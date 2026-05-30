import { ProviderReader, ReadResult } from '../core/providerReader';

export async function runEnabledReaders(
  readers: ProviderReader[],
  enabledProviderIds: string[]
): Promise<ReadResult[]> {
  const enabled = new Set(enabledProviderIds);
  const active = readers.filter(r => enabled.has(r.providerId));
  return Promise.all(active.map(r => r.read()));
}
