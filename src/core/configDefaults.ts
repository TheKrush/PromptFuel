import type { ProviderId } from './providers';

export type DashboardUsageSource = 'combined' | 'local' | 'snapshots';

export interface PromptFuelConfig {
  enabledProviders: ProviderId[];
  refreshIntervalMinutes: number;
  liveQuotaEnabled: boolean;
  snapshotImportPath: string;
  snapshotExportPath: string;
  dashboardUsageSource: DashboardUsageSource;
}

export const CONFIG_DEFAULTS: PromptFuelConfig = {
  enabledProviders: ['claude', 'codex'],
  refreshIntervalMinutes: 5,
  liveQuotaEnabled: true,
  snapshotImportPath: '',
  snapshotExportPath: '',
  dashboardUsageSource: 'combined',
};
