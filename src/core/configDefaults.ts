import type { ProviderId } from './providers';

export type DisplayMode = 'compact' | 'countdown';

export interface PromptFuelConfig {
  enabledProviders: ProviderId[];
  displayMode: DisplayMode;
  refreshIntervalMinutes: number;
}

export const CONFIG_DEFAULTS: PromptFuelConfig = {
  enabledProviders: ['claude', 'codex'],
  displayMode: 'compact',
  refreshIntervalMinutes: 5,
};
