import type { ProviderId } from './providers';

export type DisplayMode = 'compact' | 'countdown';

export interface PromptFuelConfig {
  enabledProviders: ProviderId[];
  displayMode: DisplayMode;
  refreshIntervalMinutes: number;
  liveQuotaEnabled: boolean;
}

export const CONFIG_DEFAULTS: PromptFuelConfig = {
  enabledProviders: ['claude', 'codex'],
  displayMode: 'compact',
  refreshIntervalMinutes: 5,
  liveQuotaEnabled: false,
};
