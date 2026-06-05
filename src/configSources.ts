import { DisplayMode, KNOWN_PROVIDERS, LOCAL_PROVIDER_IDS, ProviderName, SourceConfigEntry } from './types';

export interface SourceConfigInspection {
  defaultValue?: Record<string, Partial<SourceConfigEntry>>;
  globalValue?: Record<string, Partial<SourceConfigEntry>>;
  workspaceValue?: Record<string, Partial<SourceConfigEntry>>;
  workspaceFolderValue?: Record<string, Partial<SourceConfigEntry>>;
}

export function resolveConfiguredSourcesFromInspection(
  inspection: SourceConfigInspection | undefined
): Record<string, Partial<SourceConfigEntry>> | undefined {
  if (!inspection) {
    return undefined;
  }

  const configured: Record<string, Partial<SourceConfigEntry>> = {};
  let hasConfiguredSources = false;

  for (const value of [inspection.globalValue, inspection.workspaceValue, inspection.workspaceFolderValue]) {
    if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
      continue;
    }
    Object.assign(configured, value);
    hasConfiguredSources = true;
  }

  return hasConfiguredSources ? configured : undefined;
}

export function resolveSourcesFromRaw(raw: Record<string, Partial<SourceConfigEntry>> | undefined): Record<string, SourceConfigEntry> {
  const result: Record<string, SourceConfigEntry> = {};

  if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
    for (const [id, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      const defaults = KNOWN_PROVIDERS[id];
      result[id] = {
        enabled: entry.enabled ?? defaults?.enabled ?? true,
        label: entry.label || defaults?.label || id,
        shortLabel: entry.shortLabel || defaults?.shortLabel || id.charAt(0).toUpperCase(),
        statusBar: entry.statusBar ?? defaults?.statusBar ?? true
      };
    }
  } else {
    for (const [id, defaults] of Object.entries(KNOWN_PROVIDERS)) {
      result[id] = { ...defaults };
    }
  }

  return result;
}

export function getEnabledProvidersFromSources(sources: Record<string, SourceConfigEntry>): ProviderName[] {
  return Object.entries(sources)
    .filter(([id, s]) => LOCAL_PROVIDER_IDS.has(id) && s.enabled)
    .map(([id]) => id as ProviderName);
}

export function getSnapshotSourcesFromSources(sources: Record<string, SourceConfigEntry>): {
  remoteSources: string[];
  statusBarSources: string[];
  remoteMachineLabels: Record<string, string>;
} {
  const remoteSources: string[] = [];
  const statusBarSources: string[] = [];
  const remoteMachineLabels: Record<string, string> = {};

  for (const [id, entry] of Object.entries(sources)) {
    if (LOCAL_PROVIDER_IDS.has(id)) continue;
    if (!entry.enabled) continue;
    remoteSources.push(id);
    if (entry.statusBar) {
      statusBarSources.push(id);
    }
    const slashIdx = id.indexOf('/');
    if (slashIdx > 0 && slashIdx < id.length - 1) {
      const machineLabel = id.slice(0, slashIdx);
      remoteMachineLabels[machineLabel] = machineLabel;
    }
  }

  return { remoteSources, statusBarSources, remoteMachineLabels };
}

export function normalizeStatusBarDensity(value: unknown): DisplayMode {
  return value === 'compact' ? 'compact' : 'standard';
}
