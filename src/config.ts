import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  DEFAULT_CRITICAL_REMAINING_PERCENT,
  DEFAULT_EMPTY_REMAINING_PERCENT,
  DEFAULT_LOW_REMAINING_PERCENT,
  DEFAULT_WARN_REMAINING_PERCENT,
  normalizeThresholds
} from './configThresholds';
import { DisplayMode, ProviderName } from './types';

export interface PromptFuelConfig {
  enabledProviders: ProviderName[];
  stateDirectory: string;
  claudeProjectsPath: string;
  refreshIntervalSeconds: number;
  authenticatedQuota: AuthenticatedQuotaConfig;
  codexSessionsPath: string;
  displayMode: DisplayMode;
  statusMode: 'remaining' | 'used';
  lowRemainingPercent: number;
  warnRemainingPercent: number;
  criticalRemainingPercent: number;
  emptyRemainingPercent: number;
  freshResetToleranceSeconds: number;
  snapshot: SnapshotConfig;
}

export interface AuthenticatedQuotaConfig {
  enabled: boolean;
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

function resolveDisplayMode(density: string): DisplayMode {
  return density === 'compact' ? 'compact' : 'standard';
}
const DEFAULT_FRESH_RESET_TOLERANCE_SECONDS = 120;

export function getConfig(): PromptFuelConfig {
  const cfg = vscode.workspace.getConfiguration('promptFuel');
  const configuredStateDir = cfg.get<string>('stateDirectory') ?? '';
  const configuredClaudeProjectsDir = cfg.get<string>('claudeProjectsPath') ?? '';
  const configuredCodexDir = cfg.get<string>('codexSessionsPath') ?? '';
  const configuredSnapshotPath = cfg.get<string>('snapshot.path') ?? '';
  const authenticatedProviders = cfg.get<ProviderName[]>('authenticatedQuota.providers') ?? ['claude', 'codex'];
  const rawLow = cfg.get<number>('lowRemainingPercent') ?? DEFAULT_LOW_REMAINING_PERCENT;
  const rawWarn = cfg.get<number>('warnRemainingPercent') ?? DEFAULT_WARN_REMAINING_PERCENT;
  const rawCritical = cfg.get<number>('criticalRemainingPercent') ?? DEFAULT_CRITICAL_REMAINING_PERCENT;
  const rawEmpty = DEFAULT_EMPTY_REMAINING_PERCENT;
  const { lowRemainingPercent, warnRemainingPercent, criticalRemainingPercent, emptyRemainingPercent } = normalizeThresholds(rawLow, rawWarn, rawCritical, rawEmpty);

  return {
    enabledProviders: cfg.get<ProviderName[]>('enabledProviders') ?? ['claude', 'codex'],
    stateDirectory: expandHome(configuredStateDir || defaultStateDirectory()),
    claudeProjectsPath: expandHome(configuredClaudeProjectsDir || path.join(os.homedir(), '.claude', 'projects')),
    refreshIntervalSeconds: cfg.get<number>('refreshIntervalSeconds') ?? 300,
    authenticatedQuota: {
      enabled: cfg.get<boolean>('authenticatedQuota.enabled') ?? false,
      providers: authenticatedProviders.filter((provider): provider is ProviderName => provider === 'claude' || provider === 'codex'),
      refreshIntervalMinutes: Math.max(1, cfg.get<number>('authenticatedQuota.refreshIntervalMinutes') ?? 5)
    },
    codexSessionsPath: expandHome(configuredCodexDir || path.join(os.homedir(), '.codex', 'sessions')),
    displayMode: resolveDisplayMode(cfg.get<string>('statusBarDensity') ?? 'standard'),
    statusMode: cfg.get<'remaining' | 'used'>('statusMode') ?? 'remaining',
    lowRemainingPercent,
    warnRemainingPercent,
    criticalRemainingPercent,
    emptyRemainingPercent,
    freshResetToleranceSeconds: DEFAULT_FRESH_RESET_TOLERANCE_SECONDS,
    snapshot: {
      enabled: cfg.get<boolean>('snapshot.enabled') ?? false,
      machineLabel: cfg.get<string>('snapshot.machineLabel') ?? '',
      path: expandHome(configuredSnapshotPath),
      remoteSources: cfg.get<string[]>('snapshot.remoteSources') ?? [],
      statusBarSources: cfg.get<string[]>('snapshot.statusBarSources') ?? [],
      remoteMachineLabels: cfg.get<Record<string, string>>('snapshot.remoteMachineLabels') ?? {}
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
