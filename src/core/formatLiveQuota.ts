import { PROVIDER_LABELS, ProviderId } from './providers';
import type { LiveQuotaFreshness, LiveQuotaStatus, LiveQuotaWindow } from './liveQuotaTypes';
import { PromptFuelStatus } from './statusModel';

const STATUS_WINDOW_SEPARATOR = ' · ';
const STATUS_PROVIDER_SEPARATOR = ' | ';
const STATUS_WINDOW_ORDER: Record<string, number> = {
  '7d': 0,
  '5h': 1,
};

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
  const parts: string[] = [`${window.windowId}:`];

  const remaining = formatPercentage(getRemainingPercentage(window));
  if (remaining !== undefined) {
    parts.push(`${remaining} remaining`);
  }

  if (window.resetsAtEpochMs !== undefined) {
    const countdown = formatCountdownLabel(window.resetsAtEpochMs, nowMs);
    parts.push(`· resets in ${countdown}`);
  }

  return parts.join(' ');
}

// --- Status bar text with live quota preference ---

export function formatLiveQuotaStatusBarText(status: PromptFuelStatus): string {
  if (!status.liveQuotaEnabled) {
    return 'PromptFuel: live quota disabled';
  }

  if (status.liveQuotaStates.length > 0) {
    return formatLiveQuotaStatusBarTextFromLive(status);
  }

  return 'PromptFuel: live quota loading';
}

function formatLiveQuotaStatusBarTextFromLive(status: PromptFuelStatus): string {
  const parts: string[] = [];

  for (const liveState of status.liveQuotaStates) {
    const label = PROVIDER_LABELS[liveState.providerId as ProviderId] ?? liveState.providerId;

    if (liveState.freshness === 'unavailable' || liveState.freshness === 'error') {
      parts.push(`${label} unavailable`);
      continue;
    }

    const windowLabels = getStatusBarWindows(liveState)
      .map(w => formatStatusBarWindow(w, {
        includeWindowId: liveState.windows.length > 1,
      }))
      .filter((part): part is string => part !== undefined);

    if (windowLabels.length === 0) {
      parts.push(formatNoWindowLiveState(label, liveState.freshness));
      continue;
    }

    const freshnessPrefix = liveState.freshness === 'stale' ? 'stale ' : '';
    parts.push(`${label} ${freshnessPrefix}${windowLabels.join(STATUS_WINDOW_SEPARATOR)}`);
  }

  if (parts.length === 0) {
    return 'PromptFuel: live quota unavailable';
  }

  return `PromptFuel ${parts.join(STATUS_PROVIDER_SEPARATOR)}`;
}

function getStatusBarWindows(liveState: LiveQuotaStatus): LiveQuotaWindow[] {
  return liveState.windows
    .filter(w => getRemainingPercentage(w) !== undefined)
    .slice()
    .sort((a, b) => {
      const left = STATUS_WINDOW_ORDER[a.windowId] ?? 99;
      const right = STATUS_WINDOW_ORDER[b.windowId] ?? 99;
      return left - right;
    });
}

function formatStatusBarWindow(
  window: LiveQuotaWindow,
  options: { includeWindowId: boolean },
): string | undefined {
  const remaining = formatPercentage(getRemainingPercentage(window));
  if (remaining === undefined) {
    return undefined;
  }

  if (!options.includeWindowId && window.resetsAtEpochMs === undefined) {
    return remaining;
  }

  const label = window.resetsAtEpochMs !== undefined
    ? formatCountdownLabel(window.resetsAtEpochMs)
    : window.windowId;

  return `${label} ${remaining}`;
}

function formatNoWindowLiveState(label: string, freshness: LiveQuotaFreshness): string {
  if (freshness === 'stale') {
    return `${label} stale`;
  }
  if (freshness === 'cached') {
    return `${label} cached`;
  }
  return `${label} unavailable`;
}

export function getRemainingPercentage(window: { usedPercentage?: number; remainingPercentage?: number }): number | undefined {
  if (window.remainingPercentage !== undefined && Number.isFinite(window.remainingPercentage)) {
    return clampPercentage(window.remainingPercentage);
  }
  if (window.usedPercentage !== undefined && Number.isFinite(window.usedPercentage)) {
    return clampPercentage(100 - window.usedPercentage);
  }
  return undefined;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// --- Tooltip with live quota sections ---

const LINE_SEPARATOR = '\n';

export function formatLiveQuotaTooltip(status: PromptFuelStatus): string {
  const lines: string[] = [];

  const hasLiveQuota = status.liveQuotaStates.length > 0;
  const hasUsableQuota = status.liveQuotaStates.some(
    s => s.freshness !== 'unavailable' && s.freshness !== 'error',
  );

  lines.push('PromptFuel');

  if (!status.liveQuotaEnabled) {
    lines.push('Live quota disabled');
  } else if (hasUsableQuota) {
    lines.push('Live quota first');
  } else if (hasLiveQuota) {
    lines.push('Live quota unavailable');
  } else {
    lines.push('Live quota loading');
  }

  lines.push(formatSnapshotTooltipLine(status));
  lines.push('');

  // Live quota sections render unavailable/error states with sanitized labels.
  for (const providerId of getTooltipProviderIds(status)) {
    const liveState = status.liveQuotaStates.find(s => s.providerId === providerId);
    lines.push(formatLiveQuotaProviderSection(providerId, liveState, status.liveQuotaEnabled));
  }
  lines.push('');

  lines.push('Local history (secondary):');

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
    lines.push(formatParseErrorLine(totalParseErrors));
  }

  lines.push('');

  if (hasLiveQuota) {
    const liveTimestamp = getLatestLiveQuotaTimestamp(status) ?? status.liveQuotaLastRefreshedMs;
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

function formatSnapshotTooltipLine(status: PromptFuelStatus): string {
  const snapshotCount = status.snapshotState.snapshotCount;
  const providerCount = status.snapshotState.providers.length;

  if (snapshotCount > 0 && providerCount > 0) {
    return `Imported snapshots: ${snapshotCount} aggregate snapshot${snapshotCount === 1 ? '' : 's'}, ${providerCount} provider aggregate${providerCount === 1 ? '' : 's'}.`;
  }

  if (status.snapshotLastReadMs !== undefined) {
    return 'Imported snapshots: none found.';
  }

  return 'Imported snapshots: not checked yet.';
}

function getTooltipProviderIds(status: PromptFuelStatus): string[] {
  const ids = new Set<string>();
  for (const id of status.enabledProviderIds) {
    ids.add(id);
  }
  for (const state of status.providerStates) {
    ids.add(state.providerId);
  }
  for (const state of status.liveQuotaStates) {
    ids.add(state.providerId);
  }
  return [...ids];
}

function formatLiveQuotaProviderSection(
  providerId: string,
  liveState: LiveQuotaStatus | undefined,
  liveQuotaEnabled: boolean,
): string {
  const label = PROVIDER_LABELS[providerId as ProviderId] ?? providerId;
  const sectionLines: string[] = [];

  if (!liveQuotaEnabled) {
    sectionLines.push(`${label} live quota [disabled]`);
    return sectionLines.join(LINE_SEPARATOR);
  }

  if (liveState === undefined) {
    sectionLines.push(`${label} live quota [unavailable]`);
    sectionLines.push(`  ${getSanitizedErrorLabel()}`);
    return sectionLines.join(LINE_SEPARATOR);
  }

  const freshness = getFreshnessLabel(liveState.freshness);

  if (liveState.freshness === 'unavailable' || liveState.freshness === 'error') {
    sectionLines.push(`${label} live quota [unavailable]`);
    sectionLines.push(`  ${liveState.sanitizedMessage ?? getSanitizedErrorLabel()}`);
    return sectionLines.join(LINE_SEPARATOR);
  }

  sectionLines.push(`${label} live quota [${freshness}]`);

  if (liveState.freshness === 'stale') {
    sectionLines.push('  Cached from last successful live refresh.');
  } else if (liveState.freshness === 'cached') {
    sectionLines.push('  Cached live quota.');
  }

  for (const window of liveState.windows) {
    sectionLines.push(`  ${formatWindowLine(window)}`);
  }

  return sectionLines.join(LINE_SEPARATOR);
}

function formatParseErrorLine(count: number): string {
  return `Parse errors: ${count} line${count === 1 ? '' : 's'} skipped`;
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

// --- Utility: check if any live quota state exists ---

export function hasAnyLiveQuota(status: PromptFuelStatus): boolean {
  return status.liveQuotaStates.length > 0;
}
