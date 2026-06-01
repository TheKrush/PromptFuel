import * as vscode from 'vscode';
import { isKnownProvider, ProviderId } from './core/providers';
import { CONFIG_DEFAULTS, type DashboardUsageSource, PromptFuelConfig } from './core/configDefaults';

export type { PromptFuelConfig };
export { CONFIG_DEFAULTS };

export function getConfig(): PromptFuelConfig {
  const cfg = vscode.workspace.getConfiguration('promptFuel');

  const rawProviders = cfg.get<string[]>('enabledProviders', CONFIG_DEFAULTS.enabledProviders);
  const enabledProviders: ProviderId[] = Array.isArray(rawProviders)
    ? rawProviders.filter(isKnownProvider)
    : CONFIG_DEFAULTS.enabledProviders.slice();

  const rawInterval = cfg.get<number>(
    'refreshIntervalMinutes',
    CONFIG_DEFAULTS.refreshIntervalMinutes
  );
  const refreshIntervalMinutes = typeof rawInterval === 'number'
    ? Math.max(0, Math.min(1440, rawInterval))
    : CONFIG_DEFAULTS.refreshIntervalMinutes;

  const rawLiveQuota = cfg.get<boolean>(
    'liveQuotaEnabled',
    CONFIG_DEFAULTS.liveQuotaEnabled
  );
  const liveQuotaEnabled = typeof rawLiveQuota === 'boolean'
    ? rawLiveQuota
    : CONFIG_DEFAULTS.liveQuotaEnabled;

  const snapshotImportPath = readConfiguredPath(
    cfg.get<string>('snapshotImportPath', CONFIG_DEFAULTS.snapshotImportPath),
    CONFIG_DEFAULTS.snapshotImportPath,
  );
  const snapshotExportPath = readConfiguredPath(
    cfg.get<string>('snapshotExportPath', CONFIG_DEFAULTS.snapshotExportPath),
    CONFIG_DEFAULTS.snapshotExportPath,
  );
  const dashboardUsageSource = readDashboardUsageSource(
    cfg.get<string>('dashboardUsageSource', CONFIG_DEFAULTS.dashboardUsageSource),
  );

  return {
    enabledProviders,
    refreshIntervalMinutes,
    liveQuotaEnabled,
    snapshotImportPath,
    snapshotExportPath,
    dashboardUsageSource,
  };
}

function readConfiguredPath(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readDashboardUsageSource(value: unknown): DashboardUsageSource {
  return value === 'local' || value === 'snapshots' || value === 'combined'
    ? value
    : CONFIG_DEFAULTS.dashboardUsageSource;
}
