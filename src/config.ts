import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DisplayMode, ProviderName, SourceConfigEntry } from './types';
import {
  resolveConfiguredSourcesFromInspection,
  resolveSourcesFromRaw,
  getEnabledProvidersFromSources,
  getSnapshotSourcesFromSources,
  normalizeStatusBarDensity
} from './configSources';

export interface PromptFuelConfig {
  enabledProviders: ProviderName[];
  normalizedSources: Record<string, SourceConfigEntry>;
  refreshIntervalMinutes: number;
  stateDirectory: string;
  claudeProjectsPath: string;
  authenticatedQuota: AuthenticatedQuotaConfig;
  codexSessionsPath: string;
  displayMode: DisplayMode;
  statusMode: 'remaining' | 'used';
  freshResetToleranceSeconds: number;
  snapshot: SnapshotConfig;
}

export interface AuthenticatedQuotaConfig {
  providers: ProviderName[];
  refreshIntervalMinutes: number;
}

export interface SnapshotConfig {
  enabled: boolean;
  machineLabel: string;
  path: string;
  remoteSources: string[];
  statusBarSources: string[];
  remoteMachineLabels: Record<string, string>;
}

const DEFAULT_FRESH_RESET_TOLERANCE_SECONDS = 120;
const DEFAULT_STATUS_MODE: 'remaining' = 'remaining';

let internalStateDirectoryOverride: string | undefined;

export function setInternalStateDirectory(dirPath: string): void {
  internalStateDirectoryOverride = dirPath;
}

export function getConfig(): PromptFuelConfig {
  const cfg = vscode.workspace.getConfiguration('promptFuel');
  const configuredSnapshotPath = cfg.get<string>('snapshot.path') ?? '';
  const displayMode = normalizeStatusBarDensity(cfg.get<unknown>('statusBarDensity'));

  const rawSources = resolveConfiguredSourcesFromInspection(
    cfg.inspect<Record<string, Partial<SourceConfigEntry>>>('sources')
  );
  const normalizedSources = resolveSourcesFromRaw(rawSources);
  const enabledProviders = getEnabledProvidersFromSources(normalizedSources);
  const snapshotSources = getSnapshotSourcesFromSources(normalizedSources);
  const refreshIntervalMinutes = Math.max(1, cfg.get<number>('refreshIntervalMinutes') ?? 5);
  const authenticatedProviders = enabledProviders;

  return {
    enabledProviders,
    normalizedSources,
    refreshIntervalMinutes,
    stateDirectory: internalStateDirectoryOverride || defaultStateDirectory(),
    claudeProjectsPath: path.join(os.homedir(), '.claude', 'projects'),
    authenticatedQuota: {
      providers: authenticatedProviders,
      refreshIntervalMinutes
    },
    codexSessionsPath: path.join(os.homedir(), '.codex', 'sessions'),
    displayMode,
    statusMode: DEFAULT_STATUS_MODE,
    freshResetToleranceSeconds: DEFAULT_FRESH_RESET_TOLERANCE_SECONDS,
    snapshot: {
      enabled: cfg.get<boolean>('snapshot.enabled') ?? false,
      machineLabel: cfg.get<string>('snapshot.machineLabel') ?? '',
      path: expandHome(configuredSnapshotPath),
      remoteSources: snapshotSources.remoteSources,
      statusBarSources: snapshotSources.statusBarSources,
      remoteMachineLabels: snapshotSources.remoteMachineLabels
    }
  };
}

export function defaultStateDirectory(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'PromptFuel');
  }
  return path.join(os.homedir(), '.prompt-fuel');
}

export function expandHome(value: string): string {
  if (!value) {
    return value;
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
