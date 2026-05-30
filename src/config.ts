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
    'refreshIntervalSeconds',
    CONFIG_DEFAULTS.refreshIntervalSeconds
  );
  const refreshIntervalSeconds = Math.max(
    10,
    typeof rawInterval === 'number' ? rawInterval : CONFIG_DEFAULTS.refreshIntervalSeconds
  );

  return { enabledProviders, displayMode, refreshIntervalSeconds };
}
