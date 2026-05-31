import { PROVIDER_LABELS, ProviderId } from './providers';
import type { LiveQuotaFreshness, LiveQuotaStatus, LiveQuotaWindow } from './liveQuotaTypes';
import { PromptFuelStatus } from './statusModel';

// --- Freshness labels ---

const FRESHNESS_LABELS: Record<LiveQuotaFreshness, string> = {
  live: 'live',
  cached: 'cached',
  stale: 'stale',
  unavailable: 'unavailable',
  error: 'error',
};

export function getFreshnessLabel(freshness: LiveQuotaFreshness): string {
  return FRESHNESS_LABELS[freshness] ?? freshness;
}

// --- Sanitized error label ---

export function getSanitizedErrorLabel(): string {
  return 'Live quota unavailable';
}

// --- Countdown formatting ---

export function formatCountdownLabel(resetEpochMs: number, nowMs: number = Date.now()): string {
  const diffMs = resetEpochMs - nowMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 'reset';
  }
  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    return `${days}d${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

// --- Percentage formatting ---

export function formatPercentage(percentage: number | undefined): string | undefined {
  if (percentage === undefined || !Number.isFinite(percentage)) {
    return undefined;
  }
  return `${Math.round(percentage)}%`;
}

// --- Window line formatting ---

export function formatWindowLine(
  window: LiveQuotaWindow,
  nowMs: number = Date.now(),
): string {
  const parts: string[] = [window.windowId];

  const remaining = formatPercentage(window.remainingPercentage);
  if (remaining !== undefined) {
    parts.push(`${remaining} left`);
  }

  const used = formatPercentage(window.usedPercentage);
  if (used !== undefined && remaining === undefined) {
    parts.push(`${used} used`);
  }

  if (window.resetsAtEpochMs !== undefined) {
    const countdown = formatCountdownLabel(window.resetsAtEpochMs, nowMs);
    parts.push(countdown);
  }

  return parts.join(', ');
}

// --- Status bar text with live quota preference ---

export function formatLiveQuotaStatusBarText(status: PromptFuelStatus): string {
  const hasLiveQuota = status.liveQuotaStates.length > 0 &&
    status.liveQuotaStates.some(s => s.freshness !== 'unavailable' && s.freshness !== 'error');

  if (hasLiveQuota) {
    return formatLiveQuotaStatusBarTextFromLive(status);
  }

  return fallbackStatusBarText(status);
}

function formatLiveQuotaStatusBarTextFromLive(status: PromptFuelStatus): string {
  const usableStates = status.liveQuotaStates.filter(
    s => s.freshness !== 'unavailable' && s.freshness !== 'error',
  );

  if (usableStates.length === 0) {
    return fallbackStatusBarText(status);
  }

  const parts: string[] = [];

  for (const liveState of usableStates) {
    const label = PROVIDER_LABELS[liveState.providerId as ProviderId] ?? liveState.providerId;

    const usableWindows = liveState.windows.filter(
      w => w.remainingPercentage !== undefined || w.usedPercentage !== undefined,
    );

    if (usableWindows.length === 0) {
      continue;
    }

    const windowLabels = usableWindows.map(w => {
      const remaining = formatPercentage(w.remainingPercentage);
      if (remaining !== undefined) {
        return `${w.windowId} ${remaining}`;
      }
      const used = formatPercentage(w.usedPercentage);
      if (used !== undefined) {
        return `${w.windowId} ${used} used`;
      }
      return w.windowId;
    });

    parts.push(`${label} ${windowLabels.join(' · ')}`);
  }

  if (parts.length === 0) {
    return fallbackStatusBarText(status);
  }

  return `PromptFuel: ${parts.join(' | ')}`;
}

function fallbackStatusBarText(status: PromptFuelStatus): string {
  const hasError = status.providerStates.some(s => s.status === 'unknown');
  if (hasError) {
    return 'PromptFuel: refresh failed';
  }

  const allNoData = status.providerStates.length > 0 &&
    status.providerStates.every(s => s.status === 'no-data');
  if (allNoData) {
    return 'PromptFuel: local history';
  }

  let totalTokens = 0;
  let anyLoaded = false;
  for (const state of status.providerStates) {
    if (state.status === 'loaded' && (state.totalTokens ?? 0) > 0) {
      totalTokens += state.totalTokens ?? 0;
      anyLoaded = true;
    }
  }

  if (!anyLoaded) {
    return 'PromptFuel: local history';
  }

  return `PromptFuel: ${formatTokenCountCompact(totalTokens)} local history`;
}

function formatTokenCountCompact(count: number): string {
  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1)}B`;
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return `${count}`;
}

// --- Tooltip with live quota sections ---

const LINE_SEPARATOR = '\n';

export function formatLiveQuotaTooltip(status: PromptFuelStatus): string {
  const lines: string[] = [];

  const hasLiveQuota = status.liveQuotaStates.length > 0 &&
    status.liveQuotaStates.some(s => s.freshness !== 'unavailable' && s.freshness !== 'error');

  lines.push('PromptFuel');

  if (hasLiveQuota) {
    lines.push('Local history + live quota');
  } else {
    lines.push('Local history only');
  }

  lines.push('Snapshots not included');
  lines.push('');

  // Live quota sections (render even error states for sanitized label)
  if (status.liveQuotaStates.length > 0) {
    for (const liveState of status.liveQuotaStates) {
      lines.push(formatLiveQuotaProviderSection(liveState));
    }
    lines.push('');
  } else {
    lines.push('Live quota not enabled yet.');
    lines.push('');
  }

  // Local history sections
  lines.push('Local history:');

  let totalTokens = 0;
  let totalMessages = 0;
  let totalParseErrors = 0;

  for (const state of status.providerStates) {
    const label = PROVIDER_LABELS[state.providerId as ProviderId] ?? state.providerId;
    lines.push(formatProviderTooltipLine(label, state));
    if (state.status === 'loaded') {
      totalTokens += state.totalTokens ?? 0;
      totalMessages += state.totalAssistantMessages ?? 0;
    }
    totalParseErrors += state.parseErrors ?? 0;
  }

  if (totalTokens > 0) {
    lines.push('');
    lines.push(`Total local history: ${formatTokenCount(totalTokens)} (${totalMessages} messages)`);
  }

  if (totalParseErrors > 0) {
    lines.push(`Parse errors: ${totalParseErrors}`);
  }

  // Timestamps
  lines.push('');

  if (hasLiveQuota) {
    const liveTimestamp = getLatestLiveQuotaTimestamp(status);
    if (liveTimestamp) {
      lines.push(formatLiveQuotaRefreshedAt(liveTimestamp));
    }
  }

  if (status.localHistoryLastRefreshedMs) {
    lines.push(formatLocalHistoryRefreshedAt(status.localHistoryLastRefreshedMs));
  }

  return lines.join(LINE_SEPARATOR);
}

function getLatestLiveQuotaTimestamp(status: PromptFuelStatus): number | undefined {
  let latest: number | undefined;
  for (const liveState of status.liveQuotaStates) {
    if (liveState.lastUpdatedEpochMs && (!latest || liveState.lastUpdatedEpochMs > latest)) {
      latest = liveState.lastUpdatedEpochMs;
    }
  }
  return latest;
}

function formatLiveQuotaProviderSection(liveState: LiveQuotaStatus): string {
  const label = PROVIDER_LABELS[liveState.providerId as ProviderId] ?? liveState.providerId;
  const sectionLines: string[] = [];

  const freshness = getFreshnessLabel(liveState.freshness);

  if (liveState.freshness === 'unavailable' || liveState.freshness === 'error') {
    sectionLines.push(`${label} live quota: ${liveState.sanitizedMessage ?? getSanitizedErrorLabel()} [${freshness}]`);
    return sectionLines.join(LINE_SEPARATOR);
  }

  sectionLines.push(`${label} live quota [${freshness}]`);

  for (const window of liveState.windows) {
    sectionLines.push(`  ${formatWindowLine(window)}`);
  }

  return sectionLines.join(LINE_SEPARATOR);
}

function formatProviderTooltipLine(
  label: string,
  state: {
    status: string;
    totalTokens?: number;
    totalAssistantMessages?: number;
  },
): string {
  const parts: string[] = [label];

  switch (state.status) {
    case 'loaded':
      parts.push('loaded');
      if (state.totalTokens !== undefined && state.totalTokens > 0) {
        parts.push(`${formatTokenCount(state.totalTokens)}`);
      }
      if (state.totalAssistantMessages !== undefined && state.totalAssistantMessages > 0) {
        parts.push(`${state.totalAssistantMessages} messages`);
      }
      break;

    case 'no-data':
      parts.push('no local data');
      break;

    case 'unknown':
      parts.push('read error');
      break;

    case 'disabled':
      parts.push('disabled');
      break;
  }

  return parts.join(' · ');
}

function formatLiveQuotaRefreshedAt(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `Live quota refreshed: ${hours}:${minutes}:${seconds}`;
}

function formatLocalHistoryRefreshedAt(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `Local history refreshed: ${hours}:${minutes}:${seconds}`;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M tokens`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K tokens`;
  }
  return `${count} tokens`;
}

// --- Utility: check if any live quota is usable ---

export function hasUsableLiveQuota(status: PromptFuelStatus): boolean {
  return status.liveQuotaStates.length > 0 &&
    status.liveQuotaStates.some(s => s.freshness !== 'unavailable' && s.freshness !== 'error');
}

// --- Utility: check if any live quota data exists (even unavailable) ---

export function hasAnyLiveQuota(status: PromptFuelStatus): boolean {
  return status.liveQuotaStates.length > 0 &&
    status.liveQuotaStates.some(s => s.freshness !== 'unavailable');
}
