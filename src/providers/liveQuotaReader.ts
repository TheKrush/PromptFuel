import type { LiveQuotaStatus } from '../core/liveQuotaTypes';

export interface LiveQuotaReader {
  readonly providerId: string;
  read(): Promise<LiveQuotaStatus>;
}

export function createStubReader(providerId: string): LiveQuotaReader {
  return {
    providerId,
    async read(): Promise<LiveQuotaStatus> {
      return {
        providerId,
        windows: [],
        status: 'unavailable',
        freshness: 'unavailable',
        sanitizedMessage: 'Live quota unavailable',
      };
    },
  };
}
