import type { ProviderId } from './providers';

export interface PromptFuelConfig {
  enabledProviders: ProviderId[];
  refreshIntervalMinutes: number;
  liveQuotaEnabled: boolean;
  snapshotImportPath: string;
  snapshotExportPath: string;
}

export const CONFIG_DEFAULTS: PromptFuelConfig = {
  enabledProviders: ['claude', 'codex'],
  refreshIntervalMinutes: 5,
  liveQuotaEnabled: true,
  snapshotImportPath: '',
  snapshotExportPath: '',
};
