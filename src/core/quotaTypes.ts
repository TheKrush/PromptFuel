export type QuotaWindowId = '5h' | '7d';

export const QUOTA_WINDOWS: ReadonlyArray<QuotaWindowId> = ['5h', '7d'];

export const QUOTA_WINDOW_LABELS: Record<QuotaWindowId, string> = {
  '5h': '5h',
  '7d': '7d',
};

export type ProviderQuotaStatus = 'no-data' | 'disabled' | 'unknown';

export interface ProviderQuotaState {
  providerId: string;
  status: ProviderQuotaStatus;
}
