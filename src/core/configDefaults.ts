import type { ProviderId } from './providers';

export type DisplayMode = 'compact' | 'countdown';

export interface PromptFuelConfig {
  enabledProviders: ProviderId[];
  displayMode: DisplayMode;
  refreshIntervalSeconds: number;
}

export const CONFIG_DEFAULTS: PromptFuelConfig = {
  enabledProviders: ['claude', 'codex'],
  displayMode: 'compact',
  refreshIntervalSeconds: 300,
};
