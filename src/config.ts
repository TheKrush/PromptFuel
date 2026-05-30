import * as vscode from 'vscode';
import { isKnownProvider, ProviderId } from './core/providers';
import { CONFIG_DEFAULTS, DisplayMode, PromptFuelConfig } from './core/configDefaults';

export type { PromptFuelConfig, DisplayMode };
export { CONFIG_DEFAULTS };

export function getConfig(): PromptFuelConfig {
  const cfg = vscode.workspace.getConfiguration('promptFuel');

  const rawProviders = cfg.get<string[]>('enabledProviders', CONFIG_DEFAULTS.enabledProviders);
  const enabledProviders: ProviderId[] = Array.isArray(rawProviders)
    ? rawProviders.filter(isKnownProvider)
    : CONFIG_DEFAULTS.enabledProviders.slice();

  const rawMode = cfg.get<string>('displayMode', CONFIG_DEFAULTS.displayMode);
  const displayMode: DisplayMode =
    rawMode === 'compact' || rawMode === 'countdown' ? rawMode : CONFIG_DEFAULTS.displayMode;

  const rawInterval = cfg.get<number>(
    'refreshIntervalMinutes',
    CONFIG_DEFAULTS.refreshIntervalMinutes
  );
  const refreshIntervalMinutes = typeof rawInterval === 'number'
    ? Math.max(0, Math.min(1440, rawInterval))
    : CONFIG_DEFAULTS.refreshIntervalMinutes;

  return { enabledProviders, displayMode, refreshIntervalMinutes };
}
