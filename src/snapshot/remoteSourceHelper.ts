import { formatCoarseAgeLabel, formatCountdown } from '../usageTime';

export interface RemoteSourceId {
  machineLabel: string;
  provider: 'claude' | 'codex';
}

const VALID_PROVIDERS = new Set(['claude', 'codex']);

export function parseRemoteSourceId(sourceId: string): RemoteSourceId | undefined {
  const slashIndex = sourceId.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= sourceId.length - 1) {
    return undefined;
  }
  const machineLabel = sourceId.slice(0, slashIndex);
  const provider = sourceId.slice(slashIndex + 1);
  if (!machineLabel || !provider) {
    return undefined;
  }
  if (provider !== 'claude' && provider !== 'codex') {
    return undefined;
  }
  return { machineLabel, provider };
}

export function getDisplayAlias(
  machineLabel: string,
  aliasMap: Record<string, string>
): string {
  return aliasMap[machineLabel] ?? machineLabel;
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex'
};

export function formatSourceLabel(
  provider: string,
  machineLabel: string,
  aliasMap: Record<string, string>
): string {
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;
  const alias = getDisplayAlias(machineLabel, aliasMap);
  return `${providerLabel} ${alias}`;
}

export interface PerWindowResetInfo {
  sevenDayResetEpoch?: number;
  fiveHourResetEpoch?: number;
  hasPerWindowReset: boolean;
}

export function parsePerWindowReset(
  sevenDayResetAtEpochSeconds: number | undefined,
  fiveHourResetAtEpochSeconds: number | undefined
): PerWindowResetInfo {
  const info: PerWindowResetInfo = { hasPerWindowReset: false };

  if (sevenDayResetAtEpochSeconds !== undefined || fiveHourResetAtEpochSeconds !== undefined) {
    info.hasPerWindowReset = true;
    info.sevenDayResetEpoch = sevenDayResetAtEpochSeconds;
    info.fiveHourResetEpoch = fiveHourResetAtEpochSeconds;
    return info;
  }

  return info;
}

export function formatStatusBarTooltipSuffix(
  stale: boolean,
  staleReason?: string,
  snapshotEpochMs?: number
): string {
  if (stale && staleReason) {
    return `\n— Snapshot stale: ${staleReason}`;
  }
  if (stale) {
    return '\n— Snapshot-backed (stale)';
  }
  if (snapshotEpochMs) {
    const ageLabel = formatCoarseAgeLabel(snapshotEpochMs);
    if (ageLabel) {
      if (ageLabel === 'just now') {
        return ' — snapshot-backed (just now)';
      }
      return ` — snapshot-backed (${ageLabel} old)`;
    }
  }
  return ' — snapshot-backed';
}
