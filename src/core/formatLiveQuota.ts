import { PROVIDER_LABELS, ProviderId } from './providers';
import type { LiveQuotaFreshness, LiveQuotaStatus, LiveQuotaWindow } from './liveQuotaTypes';
import { PromptFuelStatus } from './statusModel';
import {
  mergeModelUsageAggregate,
  sortModelUsageAggregates,
  type ModelUsageAggregate,
} from './modelUsage';
import { formatSnapshotSourceLabels } from './snapshotTypes';

const STATUS_PROVIDER_SEPARATOR = ' | ';
const STATUS_WINDOW_JOINER = ' \u00B7 ';
const STATUS_WINDOW_ORDER: Record<string, number> = {
  '7d': 0,
  '5h': 1,
};
const QUOTA_BAR_WIDTH = 10;
const PROGRESS_FILLED = '\u25B0';
const PROGRESS_EMPTY = '\u25B1';

type QuotaLevel = 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'unavailable';

const QUOTA_LEVEL_COLORS: Record<Exclude<QuotaLevel, 'unavailable'>, string> = {
  blue: '#2196F3',
  green: '#4CAF50',
  yellow: '#FFC107',
  orange: '#FF9800',
  red: '#F44336',
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
  const parts: string[] = [window.windowId];

  const remaining = formatPercentage(getRemainingPercentage(window));
  if (remaining !== undefined) {
    parts.push(`${remaining} remaining`);
  } else {
    parts.push('remaining unavailable');
  }

  if (window.resetsAtEpochMs !== undefined) {
    const countdown = formatCountdownLabel(window.resetsAtEpochMs, nowMs);
    parts.push(`resets in ${countdown}`);
  }

  return parts.join(' | ');
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

    const freshnessPrefix = liveState.freshness === 'cached'
      ? `${liveState.freshness} `
      : '';
    parts.push(`${label} ${freshnessPrefix}${windowLabels.join(STATUS_WINDOW_JOINER)}`);
  }

  if (parts.length === 0) {
    return 'PromptFuel: live quota unavailable';
  }

  return parts.join(STATUS_PROVIDER_SEPARATOR);
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
  const indicator = formatQuotaIndicator(getRemainingPercentage(window));

  if (!options.includeWindowId && window.resetsAtEpochMs === undefined) {
    return `${indicator} ${remaining}`;
  }

  const label = window.resetsAtEpochMs !== undefined
    ? formatCountdownLabel(window.resetsAtEpochMs)
    : window.windowId;

  return `${label} ${indicator} ${remaining}`;
}

function formatNoWindowLiveState(label: string, freshness: LiveQuotaFreshness): string {
  if (freshness === 'stale') {
    return `${label} unavailable`;
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
  const providerIds = getTooltipProviderIds(status);
  const overallState = getTooltipOverallStateLabel(status, hasLiveQuota, providerIds.length);
  const quotaRows = formatQuotaRows(status, providerIds, hasLiveQuota);

  lines.push('# PromptFuel');
  lines.push('');
  lines.push('## Quota');
  lines.push('');

  if (quotaRows.length === 0) {
    lines.push('No live quota data.');
  } else {
    lines.push('|  |  |  |  |  |  |  |');
    lines.push('| --- | ---: | --- | ---: | --- | ---: | --- |');
    lines.push(...quotaRows);
  }

  const totalParseErrors = status.providerStates.reduce(
    (sum, state) => sum + (state.parseErrors ?? 0),
    0,
  );

  lines.push('');
  lines.push('## Details');
  lines.push('');

  if (overallState !== undefined) {
    lines.push(`* State: ${overallState}`);
    const stateSummary = formatOverallStateSummary(overallState);
    if (stateSummary !== undefined) {
      lines.push(`* Status: ${stateSummary}`);
    }
  }
  lines.push(`* ${formatSnapshotTooltipLine(status)}`);
  if (hasLiveQuota) {
    const liveTimestamp = getLatestLiveQuotaTimestamp(status) ?? status.liveQuotaLastRefreshedMs;
    if (liveTimestamp) {
      lines.push(`* ${formatLiveQuotaRefreshedAt(liveTimestamp)}`);
    }
  }

  if (status.localHistoryLastRefreshedMs) {
    lines.push(`* ${formatLocalHistoryRefreshedAt(status.localHistoryLastRefreshedMs)}`);
  }

  if (totalParseErrors > 0) {
    lines.push(`* ${formatParseErrorLine(totalParseErrors)}`);
  }

  const modelRows = getTooltipModelRows(status);
  if (modelRows.length > 0) {
    lines.push('');
    lines.push('## Models');
    lines.push('');
    lines.push('| Provider | Model | Tokens | Msgs/Turns |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const row of modelRows.slice(0, 5)) {
      const provider = PROVIDER_LABELS[row.providerId] ?? row.providerId;
      lines.push(`| ${escapeTooltipCell(provider)} | ${escapeTooltipCell(row.modelLabel)} | **${formatTooltipTokenCount(row.totalTokens)}** | ${row.totalAssistantMessages} |`);
    }
  }

  return lines.join(LINE_SEPARATOR);
}

function getTooltipModelRows(status: PromptFuelStatus): ModelUsageAggregate[] {
  const merged: ModelUsageAggregate[] = [];
  for (const state of status.providerStates) {
    for (const model of state.modelAggregates ?? []) {
      mergeModelUsageAggregate(merged, model);
    }
  }
  for (const provider of status.snapshotState.providers) {
    for (const model of provider.modelAggregates ?? []) {
      mergeModelUsageAggregate(merged, model);
    }
  }
  return sortModelUsageAggregates(merged).filter(row => row.totalTokens > 0);
}

function formatQuotaRows(
  status: PromptFuelStatus,
  providerIds: string[],
  hasLiveQuota: boolean,
): string[] {
  const rows: string[] = [];

  for (const providerId of providerIds) {
    const liveState = status.liveQuotaStates.find(s => s.providerId === providerId);
    rows.push(...formatQuotaProviderRows(providerId, liveState, status.liveQuotaEnabled, hasLiveQuota));
  }

  return rows;
}

function formatQuotaProviderRows(
  providerId: string,
  liveState: LiveQuotaStatus | undefined,
  liveQuotaEnabled: boolean,
  hasLiveQuota: boolean,
): string[] {
  const label = PROVIDER_LABELS[providerId as ProviderId] ?? providerId;

  if (!liveQuotaEnabled) {
    return [formatQuotaTableRow(label, '-', formatQuotaIndicator(undefined, true), 'Live quota disabled', '', '-', 'DISABLED')];
  }

  if (liveState === undefined) {
    const state = hasLiveQuota ? 'UNAVAILABLE' : 'LOADING';
    const remaining = state === 'LOADING' ? 'Live quota loading' : getSanitizedErrorLabel();
    return [formatQuotaTableRow(label, '-', formatQuotaIndicator(undefined, true), remaining, '', '-', state)];
  }

  const state = getTooltipStateLabel(liveState.freshness);

  if (liveState.freshness === 'unavailable' || liveState.freshness === 'error') {
    return [formatQuotaTableRow(
      label,
      '-',
      formatQuotaIndicator(undefined, true),
      liveState.sanitizedMessage ?? getSanitizedErrorLabel(),
      '',
      '-',
      'UNAVAILABLE',
    )];
  }

  const windows = liveState.windows.slice().sort(compareTooltipWindows);
  if (windows.length === 0) {
    return [formatQuotaTableRow(label, '-', formatQuotaIndicator(undefined, true), 'remaining unavailable', '', '-', state)];
  }

  return windows.map(window => formatQuotaTableRow(
    label,
    window.windowId,
    formatQuotaIndicator(getRemainingPercentage(window)),
    formatRemainingLabel(window),
    formatQuotaBar(window),
    formatTooltipResetLabel(window),
    state,
  ));
}

function formatQuotaTableRow(
  provider: string,
  window: string,
  indicator: string,
  remaining: string,
  bar: string,
  reset: string,
  state: string,
): string {
  return `| ${provider} | ${window} | ${indicator} | ${remaining} | ${bar} | ${reset} | ${state} |`;
}

function formatRemainingLabel(window: LiveQuotaWindow): string {
  const remaining = getRemainingPercentage(window);
  const percentage = formatPercentage(remaining);
  if (percentage === undefined || remaining === undefined) {
    return 'remaining unavailable';
  }
  return `**${percentage}**`;
}

function formatQuotaBar(window: LiveQuotaWindow): string {
  const remaining = getRemainingPercentage(window);
  if (remaining === undefined) {
    return '';
  }
  const filled = Math.round(clampPercentage(remaining) / 100 * QUOTA_BAR_WIDTH);
  const safeFilled = remaining > 0 && filled < 1 ? 1 : Math.max(0, filled);
  const empty = QUOTA_BAR_WIDTH - safeFilled;
  const filledBlocks = PROGRESS_FILLED.repeat(safeFilled);
  const emptyBlocks = PROGRESS_EMPTY.repeat(Math.max(0, empty));
  if (safeFilled === 0) {
    return emptyBlocks;
  }

  return `<span style="color:${getQuotaLevelColor(getQuotaLevel(remaining))}">${filledBlocks}</span>${emptyBlocks}`;
}

function formatQuotaIndicator(remaining: number | undefined, unavailable = false): string {
  switch (getQuotaLevel(remaining, unavailable)) {
    case 'blue':
      return '\uD83D\uDD35';
    case 'green':
      return '\uD83D\uDFE2';
    case 'yellow':
      return '\uD83D\uDFE1';
    case 'orange':
      return '\uD83D\uDFE0';
    case 'red':
      return '\uD83D\uDD34';
    default:
      return '\u26AB';
  }
}

function getQuotaLevel(remaining: number | undefined, unavailable = false): QuotaLevel {
  if (unavailable || remaining === undefined) {
    return 'unavailable';
  }
  const clamped = clampPercentage(remaining);
  if (clamped >= 80) {
    return 'blue';
  }
  if (clamped >= 50) {
    return 'green';
  }
  if (clamped >= 30) {
    return 'yellow';
  }
  if (clamped >= 10) {
    return 'orange';
  }
  return 'red';
}

function getQuotaLevelColor(level: QuotaLevel): string {
  if (level === 'unavailable') {
    return '#808080';
  }
  return QUOTA_LEVEL_COLORS[level];
}

function formatTooltipResetLabel(window: LiveQuotaWindow): string {
  if (window.resetsAtEpochMs === undefined) {
    return '-';
  }
  return formatCountdownLabel(window.resetsAtEpochMs);
}

function formatOverallStateSummary(state: string): string | undefined {
  switch (state) {
    case 'DISABLED':
      return 'Live quota disabled';
    case 'LOADING':
      return 'Live quota loading';
    case 'NO DATA':
      return 'No live quota data.';
    default:
      return undefined;
  }
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
    const sourceSummary = formatSnapshotSourceLabels(
      status.snapshotState.providers.map(provider => provider.sourceLabel),
    );
    return sourceSummary ? `Snapshots: ${sourceSummary}` : 'Snapshots: available';
  }

  if (status.snapshotLastReadMs !== undefined) {
    return 'Snapshots: none';
  }

  return 'Snapshots: not checked';
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

function getTooltipStateLabel(freshness: LiveQuotaFreshness): string {
  if (freshness === 'error') {
    return 'UNAVAILABLE';
  }
  return getFreshnessLabel(freshness).toUpperCase();
}

function getTooltipOverallStateLabel(
  status: PromptFuelStatus,
  hasLiveQuota: boolean,
  providerCount: number,
): string | undefined {
  if (!status.liveQuotaEnabled) {
    return 'DISABLED';
  }
  if (!hasLiveQuota && providerCount === 0) {
    return 'NO DATA';
  }
  if (!hasLiveQuota) {
    return 'LOADING';
  }

  const states = status.liveQuotaStates.map(liveState => getTooltipStateLabel(liveState.freshness));
  const first = states[0];
  if (first !== undefined && states.every(state => state === first)) {
    return first;
  }
  return undefined;
}

function compareTooltipWindows(a: LiveQuotaWindow, b: LiveQuotaWindow): number {
  const left = STATUS_WINDOW_ORDER[a.windowId] ?? 99;
  const right = STATUS_WINDOW_ORDER[b.windowId] ?? 99;
  return left - right;
}

function formatParseErrorLine(count: number): string {
  return `Skipped local-history lines: ${count}`;
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

function formatTooltipTokenCount(count: number): string {
  return formatTokenCount(count).replace(/ tokens$/, '');
}

function escapeTooltipCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
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
