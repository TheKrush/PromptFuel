import { formatRemoteProviderTooltip, quotaIndicatorForRemaining, type FormattedProviderStatus } from './display/format';
import type { ValidatedSnapshot } from './snapshot/readMachineSnapshots';
import { formatSourceLabel, parsePerWindowReset } from './snapshot/remoteSourceHelper';
import type { DisplayMode, ProviderName, SourceConfigEntry } from './types';
import { formatAgeLabel, formatCountdown } from './usageTime';

export function buildRemoteStatusBarItems(
  snapshots: ReadonlyArray<ValidatedSnapshot>,
  statusBarSourceIds: string[],
  aliasMap: Record<string, string>,
  displayMode: DisplayMode,
  normalizedSources?: Record<string, SourceConfigEntry>
): FormattedProviderStatus[] {
  if (!statusBarSourceIds || statusBarSourceIds.length === 0) {
    return [];
  }

  const sourceSet = new Set(statusBarSourceIds);
  const items: FormattedProviderStatus[] = [];

  for (const vs of snapshots) {
    const machineLabel = vs.snapshot.machineLabel;
    const snapshotStale = vs.stale;
    for (const sp of vs.snapshot.providerUsage ?? []) {
      const sourceId = `${machineLabel}/${sp.provider}`;
      if (!sourceSet.has(sourceId)) {
        continue;
      }

      const sourceEntry = normalizedSources?.[sourceId];
      const fallbackLabel = formatSourceLabel(sp.provider, machineLabel, aliasMap);
      const statusBarLabel = sourceEntry
        ? (displayMode === 'compact' ? sourceEntry.shortLabel : sourceEntry.label)
        : fallbackLabel;
      const tooltipLabel = sourceEntry?.label ?? fallbackLabel;
      const windows: string[] = [];

      const sevenDay = sp.sevenDayUsedPercent;
      const fiveHour = sp.fiveHourUsedPercent;

      const hasSevenDay = typeof sevenDay === 'number' && sevenDay >= 0;
      const hasFiveHour = typeof fiveHour === 'number' && fiveHour >= 0;
      const resetInfo = parsePerWindowReset(
        sp.sevenDayResetAtEpochSeconds,
        sp.fiveHourResetAtEpochSeconds
      );
      const sevenDayResetEpoch = resetInfo.sevenDayResetEpoch;
      const fiveHourResetEpoch = resetInfo.fiveHourResetEpoch;

      if (hasSevenDay) {
        const remaining = Math.max(0, 100 - sevenDay);
        const emoji = quotaIndicatorForRemaining(remaining);
        if (displayMode === 'standard' && sevenDayResetEpoch) {
          windows.push(`${formatCountdown(sevenDayResetEpoch)} ${emoji}${Math.round(remaining)}%`);
        } else {
          windows.push(`${emoji}${Math.round(remaining)}%`);
        }
      }
      if (hasFiveHour) {
        const remaining = Math.max(0, 100 - (fiveHour as number));
        const emoji = quotaIndicatorForRemaining(remaining);
        if (displayMode === 'standard' && fiveHourResetEpoch) {
          windows.push(`${formatCountdown(fiveHourResetEpoch)} ${emoji}${Math.round(remaining)}%`);
        } else {
          windows.push(`${emoji}${Math.round(remaining)}%`);
        }
      }

      const windowSeparator = ' · ';
      const text = windows.length > 0
        ? `${statusBarLabel} ${windows.join(windowSeparator)}`
        : `${statusBarLabel} unavailable`;

      const snapshotAgeMs = vs.snapshot.generatedAtEpochMs;
      const ageStr = formatAgeLabel(snapshotAgeMs, true);

      const tooltip = formatRemoteProviderTooltip({
        label: tooltipLabel,
        provider: sp.provider as ProviderName,
        sevenDayRemainingPercent: hasSevenDay ? Math.max(0, 100 - (sevenDay as number)) : undefined,
        fiveHourRemainingPercent: hasFiveHour ? Math.max(0, 100 - (fiveHour as number)) : undefined,
        sevenDayResetEpochSeconds: sevenDayResetEpoch,
        fiveHourResetEpochSeconds: fiveHourResetEpoch,
        stale: snapshotStale,
        staleReason: vs.staleReason,
        snapshotAgeLabel: ageStr,
        snapshotEpochMs: snapshotAgeMs
      });

      items.push({
        provider: sp.provider,
        text,
        tooltip,
        severity: snapshotStale ? 'warning' : 'normal',
        remoteQuotaData: {
          label: tooltipLabel,
          sevenDayRemainingPercent: hasSevenDay ? Math.max(0, 100 - (sevenDay as number)) : undefined,
          fiveHourRemainingPercent: hasFiveHour ? Math.max(0, 100 - (fiveHour as number)) : undefined,
          sevenDayResetEpochSeconds: sevenDayResetEpoch,
          fiveHourResetEpochSeconds: fiveHourResetEpoch,
          stale: snapshotStale,
          snapshotAgeLabel: ageStr
        }
      });
    }
  }

  return items;
}
