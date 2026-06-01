import * as vscode from 'vscode';
import {
  DashboardLiveQuotaCard,
  DashboardHistoryPoint,
  DashboardHistoryProviderSegment,
  DashboardLocalHistoryWindow,
  DashboardModel,
  DashboardModelUsageAggregate,
  DashboardProviderCard,
  DashboardSourceModeProviderCard,
  DashboardSourceModeTotals,
} from './dashboardModel';
import { formatTokenCount } from '../core/formatQuota';
import { formatCountdownLabel, getRemainingPercentage, getSanitizedErrorLabel } from '../core/formatLiveQuota';
import { formatSnapshotSourceLabels } from '../core/snapshotTypes';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRefreshTime(ts: number | undefined): string {
  if (ts === undefined) {
    return 'Not yet refreshed';
  }
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function generateNonce(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf).map(b => b.toString(36)).join('');
}

function stateChip(label: string, variant: string, extraClass = ''): string {
  const classes = ['badge', variant, 'chip', `chip-${variant}`, extraClass]
    .filter(Boolean)
    .join(' ');
  const key = label.toLowerCase().replace(/\s+/g, '-');
  return `<span class="${classes}" data-state-chip="${esc(key)}"><span class="chip-mark"></span>${esc(label)}</span>`;
}

function freshnessBadge(freshness: string): string {
  const map: Record<string, string> = {
    'live': stateChip('LIVE', 'live'),
    'cached': stateChip('CACHED', 'cached'),
    'stale': stateChip('STALE', 'stale'),
    'unavailable': stateChip('UNAVAILABLE', 'unavailable', 'error'),
    'error': stateChip('UNAVAILABLE', 'unavailable', 'error'),
  };
  return map[freshness] ?? stateChip(freshness.toUpperCase(), 'unknown');
}

function sourceModeChip(sourceMode: string): string {
  const map: Record<string, string> = {
    local: stateChip('LOCAL', 'local'),
    snapshots: stateChip('SNAPSHOT', 'snapshot'),
    combined: stateChip('COMBINED', 'combined'),
  };
  return map[sourceMode] ?? stateChip(sourceMode.toUpperCase(), 'unknown');
}

function sectionHeader(title: string, chip: string, subtitle?: string): string {
  return `
    <div class="section-header">
      <div>
        <div class="section-title">${esc(title)}</div>
        ${subtitle ? `<div class="section-subtitle">${esc(subtitle)}</div>` : ''}
      </div>
      ${chip}
    </div>`;
}

function liveQuotaSectionChip(model: DashboardModel): string {
  if (!model.liveQuotaEnabled) {
    return stateChip('DISABLED', 'disabled');
  }
  if (model.liveQuotaCards.some(card => card.freshness === 'live')) {
    return stateChip('LIVE', 'live');
  }
  if (model.liveQuotaCards.some(card => card.freshness === 'cached')) {
    return stateChip('CACHED', 'cached');
  }
  if (model.liveQuotaCards.some(card => card.freshness === 'stale')) {
    return stateChip('STALE', 'stale');
  }
  return stateChip('UNAVAILABLE', 'unavailable', 'error');
}

function progressBarClass(remainingPercentage: number | undefined): string {
  if (remainingPercentage === undefined) {
    return 'green';
  }
  if (remainingPercentage >= 50) {
    return 'green';
  }
  if (remainingPercentage >= 25) {
    return 'yellow';
  }
  if (remainingPercentage >= 10) {
    return 'orange';
  }
  return 'red';
}

function renderLiveQuotaWindow(window: { windowId: string; usedPercentage?: number; remainingPercentage?: number; resetsAtEpochMs?: number }): string {
  const remaining = getRemainingPercentage(window);
  const fillWidth = remaining ?? 0;
  const clampedWidth = Math.max(0, Math.min(100, fillWidth));
  const barClass = progressBarClass(clampedWidth);
  const countdown = window.resetsAtEpochMs !== undefined
    ? `resets in ${formatCountdownLabel(window.resetsAtEpochMs)}`
    : '';
  const valueText = remaining !== undefined
    ? `${Math.round(remaining)}% remaining${countdown ? ` · ${countdown}` : ''}`
    : countdown;
  const primaryText = remaining !== undefined
    ? `${Math.round(remaining)}% remaining`
    : 'Quota unavailable';
  const lowClass = remaining !== undefined && remaining < 10 ? ' is-low' : '';
  const progressAttributes = remaining !== undefined
    ? `role="progressbar" aria-label="${esc(`${window.windowId} quota remaining`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clampedWidth)}"`
    : `role="progressbar" aria-label="${esc(`${window.windowId} quota unavailable`)}" aria-valuemin="0" aria-valuemax="100"`;

  return `
      <div class="live-quota-window${lowClass}">
        <span class="live-quota-window-label">${esc(window.windowId)}</span>
        <div class="live-quota-window-bar" ${progressAttributes}>
          <div class="live-quota-window-fill ${barClass}" style="width: ${clampedWidth}%"></div>
        </div>
        <div class="live-quota-window-copy" title="${esc(valueText)}">
          <span class="live-quota-window-value">${esc(primaryText)}</span>
          ${countdown ? `<span class="live-quota-window-countdown">${esc(countdown)}</span>` : ''}
        </div>
      </div>`;
}

function renderLiveQuotaCard(card: DashboardLiveQuotaCard): string {
  const windowsHtml = card.windows.map(w => renderLiveQuotaWindow(w)).join('\n');
  const hasLowWindow = card.windows.some(w => {
    const remaining = getRemainingPercentage(w);
    return remaining !== undefined && remaining < 10;
  });
  const footerLabel = card.freshness === 'stale' || card.freshness === 'cached'
    ? 'Cached'
    : 'Updated';
  const staleNote = card.freshness === 'stale' || card.freshness === 'cached'
    ? '<div class="live-quota-note">Showing cached quota from the last successful live refresh.</div>'
    : '';
  const footer = card.lastUpdatedMs !== undefined
    ? `<div class="live-quota-footer">${footerLabel}: ${esc(formatRefreshTime(card.lastUpdatedMs))}</div>`
    : '';

  return `
    <div class="live-quota-card quota-state-${esc(card.freshness)}${hasLowWindow ? ' quota-low' : ''}" data-live-quota-card="${esc(card.providerId)}">
      <div class="live-quota-header card-header">
        <div>
          <span class="live-quota-label">${esc(card.label)}</span>
          <span class="card-kicker">Provider quota windows</span>
        </div>
        <div class="chip-row">${freshnessBadge(card.freshness)}</div>
      </div>
      <div class="live-quota-windows">
        ${windowsHtml}
      </div>
      ${staleNote}
      ${footer}
    </div>`;
}

function renderLiveQuotaEmptyState(model: DashboardModel, label?: string): string {
  const stateText = model.liveQuotaEnabled
    ? 'Live quota loading'
    : 'Live quota disabled';
  const badge = model.liveQuotaEnabled
    ? ''
    : stateChip('DISABLED', 'disabled');
  const prefix = label ? `${esc(label)}: ` : '';

  return `<div class="live-quota-not-enabled calm-state">
    <div class="calm-state-header">${prefix}${esc(stateText)} ${badge}</div>
    <div class="calm-state-copy">Live provider quota will appear here when available.</div>
  </div>`;
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    'loaded': 'loaded',
    'no-data': 'no-data',
    'unknown': 'error',
    'disabled': 'disabled',
    'not-found': 'no-data',
  };
  return map[status] ?? '';
}

function statusBadgeLabel(status: string): string {
  const map: Record<string, string> = {
    'loaded': 'loaded',
    'no-data': 'no data',
    'unknown': 'error',
    'disabled': 'disabled',
    'not-found': 'not found',
  };
  return map[status] ?? status;
}

function renderLiveQuotaCards(cards: DashboardLiveQuotaCard[]): string {
  const rendered = cards.map(card => {
    if (card.freshness === 'unavailable' || card.freshness === 'error') {
      return `
    <div class="live-quota-unavailable calm-state" data-live-quota-card="${esc(card.providerId)}">
      <div class="calm-state-header">
        <span class="live-quota-label">${esc(card.label)}</span>
        ${freshnessBadge(card.freshness)}
      </div>
      <div class="calm-state-copy">${esc(getSanitizedErrorLabel())}</div>
    </div>`;
    }
    return renderLiveQuotaCard(card);
  }).join('\n');

  return `<div class="card-grid live-quota-grid">${rendered}</div>`;
}

function renderLiveQuotaSection(model: DashboardModel): string {
  if (model.liveQuotaCards.length === 0) {
    const stateText = model.liveQuotaEnabled
      ? 'Live quota loading'
      : 'Live quota disabled';
    const badge = model.liveQuotaEnabled
      ? ''
      : stateChip('DISABLED', 'disabled');
    return `
  <div class="live-quota-section">
    ${sectionHeader('At a glance', liveQuotaSectionChip(model), 'Current quota window state per provider.')}
    <div class="live-quota-not-enabled calm-state">
      <div class="calm-state-header">${esc(stateText)} ${badge}</div>
      <div class="calm-state-copy">Live provider quota will appear here when available.</div>
    </div>
  </div>`;
  }

  return `
  <div class="live-quota-section">
    ${sectionHeader('At a glance', liveQuotaSectionChip(model), 'Current quota window state per provider.')}
    ${renderLiveQuotaCards(model.liveQuotaCards)}
  </div>`;
}

function renderProviderLiveQuotaSection(model: DashboardModel, provider: DashboardProviderCard): string {
  const card = model.liveQuotaCards.find(c => c.providerId === provider.providerId);
  const body = card
    ? renderLiveQuotaCards([card])
    : renderLiveQuotaEmptyState(model, provider.label);
  const chip = card
    ? freshnessBadge(card.freshness)
    : model.liveQuotaEnabled ? stateChip('UNAVAILABLE', 'unavailable', 'error') : stateChip('DISABLED', 'disabled');

  return `
  <div class="live-quota-section" data-provider-live-quota="${esc(provider.providerId)}">
    ${sectionHeader(`${provider.label} live quota`, chip, 'Provider-reported remaining quota for this provider.')}
    ${body}
  </div>`;
}

function formatParseErrorText(count: number): string {
  return `Parse errors: ${count} line${count === 1 ? '' : 's'} skipped`;
}

function liveQuotaRefreshSummary(model: DashboardModel): string {
  if (!model.liveQuotaEnabled) {
    return 'Live quota disabled';
  }
  if (model.liveQuotaLastRefreshedMs === undefined) {
    return 'Live quota refreshed: Not yet refreshed';
  }
  const staleCount = model.liveQuotaCards.filter(c => c.freshness === 'stale' || c.freshness === 'cached').length;
  const cacheText = staleCount > 0 ? ` (${staleCount} cached/stale)` : '';
  return `Live quota refreshed: ${formatRefreshTime(model.liveQuotaLastRefreshedMs)}${cacheText}`;
}

function findLocalHistoryWindow(
  windows: DashboardLocalHistoryWindow[],
  windowId: string,
): DashboardLocalHistoryWindow {
  return windows.find(w => w.windowId === windowId)
    ?? windows.find(w => w.windowId === 'all')
    ?? { windowId: 'all', label: 'All local history', totalTokens: 0, totalAssistantMessages: 0 };
}

function findSourceModeTotals(
  totals: DashboardSourceModeTotals[],
  sourceMode: string,
): DashboardSourceModeTotals {
  return totals.find(t => t.sourceMode === sourceMode)
    ?? totals.find(t => t.sourceMode === 'local')
    ?? {
      sourceMode: 'local',
      label: 'Local only',
      totalTokens: 0,
      totalAssistantMessages: 0,
      providers: [],
      windows: [],
      modelWindows: { today: [], last5h: [], last7d: [], all: [] },
      historyPoints: [],
      sourceLabels: [],
      missingSnapshotWindowIds: [],
    };
}

function findSourceProvider(
  sourceTotals: DashboardSourceModeTotals,
  providerId: string,
): DashboardSourceModeProviderCard {
  return sourceTotals.providers.find(p => p.providerId === providerId)
    ?? {
      providerId: providerId as 'claude' | 'codex',
      label: providerId,
      status: 'no-data',
      totalTokens: 0,
      totalAssistantMessages: 0,
      parseErrors: 0,
      sourceLabels: [],
      windows: [],
      modelWindows: { today: [], last5h: [], last7d: [], all: [] },
      historyPoints: [],
    };
}

function localHistoryDataAttributes(
  windows: DashboardLocalHistoryWindow[],
  value: 'tokens' | 'messages',
): string {
  return windows.map(w => {
    const raw = value === 'tokens' ? formatTokenCount(w.totalTokens) : String(w.totalAssistantMessages);
    return `data-${value}-${esc(w.windowId)}="${esc(raw)}"`;
  }).join(' ');
}

function sourceModeDataAttributes(
  totals: DashboardSourceModeTotals[],
  value: 'tokens' | 'messages',
  providerId?: string,
): string {
  return totals.flatMap(sourceTotals => {
    const windows = providerId
      ? findSourceProvider(sourceTotals, providerId).windows
      : sourceTotals.windows;
    return windows.map(w => {
      const raw = value === 'tokens' ? formatTokenCount(w.totalTokens) : String(w.totalAssistantMessages);
      return `data-${value}-${esc(sourceTotals.sourceMode)}-${esc(w.windowId)}="${esc(raw)}"`;
    });
  }).join(' ');
}

function sourceProviderStatusAttributes(
  totals: DashboardSourceModeTotals[],
  providerId: string,
): string {
  return totals.map(sourceTotals => {
    const provider = findSourceProvider(sourceTotals, providerId);
    return [
      `data-status-${esc(sourceTotals.sourceMode)}="${esc(provider.status)}"`,
      `data-status-label-${esc(sourceTotals.sourceMode)}="${esc(statusBadgeLabel(provider.status))}"`,
      `data-status-class-${esc(sourceTotals.sourceMode)}="${esc(statusBadgeClass(provider.status))}"`,
    ].join(' ');
  }).join(' ');
}

function formatMessageCount(count: number): string {
  return `${count} message${count === 1 ? '' : 's'}`;
}

function formatDistributionPercent(value: number, total: number): string {
  if (total <= 0 || value <= 0) {
    return '0%';
  }
  const percent = Math.round((value / total) * 100);
  return `${Math.max(1, Math.min(100, percent))}%`;
}

function distributionWidth(value: number, total: number): string {
  if (total <= 0 || value <= 0) {
    return '0';
  }
  return String(Math.max(1, Math.min(100, Math.round((value / total) * 10) / 10)));
}

function historyWindowsForSource(
  sourceTotals: DashboardSourceModeTotals,
  providerId?: string,
): DashboardLocalHistoryWindow[] {
  return providerId
    ? findSourceProvider(sourceTotals, providerId).windows
    : sourceTotals.windows;
}

function historyWindowBarHeight(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return '0';
  }
  return String(Math.max(2, Math.min(100, Math.round((value / maxValue) * 100))));
}

type DashboardHistoryRangeKey = '1W' | '1M' | '1Y' | 'ALL';

interface DashboardHistoryRangeView {
  key: DashboardHistoryRangeKey;
  label: string;
  granularityLabel: string;
  points: DashboardHistoryPoint[];
  modelRows: DashboardModelUsageAggregate[];
  maxTotalTokens: number;
  totalTokens: number;
  totalAssistantMessages: number;
  totalCacheTokens: number;
  activeBinCount: number;
  unavailableReason?: string;
}

const DASHBOARD_HISTORY_RANGE_KEYS: ReadonlyArray<DashboardHistoryRangeKey> = ['1W', '1M', '1Y', 'ALL'];
const DEFAULT_HISTORY_RANGE_KEY: DashboardHistoryRangeKey = '1M';

function historyRangeLabel(rangeKey: DashboardHistoryRangeKey): string {
  const labels: Record<DashboardHistoryRangeKey, string> = {
    '1W': '1W',
    '1M': '1M',
    '1Y': '1Y',
    'ALL': 'ALL',
  };
  return labels[rangeKey];
}

function historyRangeMeta(rangeKey: DashboardHistoryRangeKey): string {
  const labels: Record<DashboardHistoryRangeKey, string> = {
    '1W': '7 daily bins',
    '1M': 'Daily bins',
    '1Y': 'Weekly bins',
    'ALL': 'Monthly bins',
  };
  return labels[rangeKey];
}

function parseDateKey(dateKey: string | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) {
    return undefined;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function buildHistoryBins(rangeKey: DashboardHistoryRangeKey, anchorDate = new Date()): Array<{ start: Date; end: Date; label: string }> {
  const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  if (rangeKey === 'ALL') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() - 11, 1);
    return Array.from({ length: 12 }, (_, i) => {
      const month = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      return {
        start: month,
        end: end > anchor ? anchor : end,
        label: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      };
    });
  }

  const days = rangeKey === '1W' ? 7 : rangeKey === '1M' ? 30 : 365;
  const start = addDays(anchor, -(days - 1));
  if (rangeKey === '1Y') {
    const bins: Array<{ start: Date; end: Date; label: string }> = [];
    let cursor = start;
    while (cursor <= anchor) {
      const end = addDays(cursor, 6) > anchor ? anchor : addDays(cursor, 6);
      bins.push({
        start: cursor,
        end,
        label: `${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      });
      cursor = addDays(end, 1);
    }
    return bins;
  }

  return Array.from({ length: days }, (_, i) => {
    const day = addDays(start, i);
    return {
      start: day,
      end: day,
      label: `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    };
  });
}

function pointInBin(point: DashboardHistoryPoint, start: Date, end: Date): boolean {
  const date = parseDateKey(point.dateKey);
  if (!date) {
    return false;
  }
  return date >= start && date <= end;
}

function mergeHistoryProviderSegments(
  target: DashboardHistoryProviderSegment[],
  source: DashboardHistoryProviderSegment[],
): void {
  for (const segment of source) {
    const existing = target.find(candidate =>
      candidate.providerId === segment.providerId &&
      candidate.label === segment.label
    );
    if (existing) {
      existing.totalTokens += segment.totalTokens;
      existing.totalAssistantMessages += segment.totalAssistantMessages;
    } else {
      target.push({ ...segment });
    }
  }
}

function buildHistoryRangeView(
  points: DashboardHistoryPoint[],
  rangeKey: DashboardHistoryRangeKey,
): DashboardHistoryRangeView {
  const bins = buildHistoryBins(rangeKey);
  const modelRows: DashboardModelUsageAggregate[] = [];
  const binned = bins.map(bin => {
    const matching = points.filter(point => pointInBin(point, bin.start, bin.end));
    const providerSegments: DashboardHistoryProviderSegment[] = [];
    const binModelRows: DashboardModelUsageAggregate[] = [];
    let totalTokens = 0;
    let totalAssistantMessages = 0;
    let totalCacheTokens = 0;
    for (const point of matching) {
      totalTokens += point.totalTokens;
      totalAssistantMessages += point.totalAssistantMessages;
      totalCacheTokens += point.totalCacheTokens ?? 0;
      mergeHistoryProviderSegments(providerSegments, point.providerSegments);
      mergeDashboardModelRows(modelRows, point.modelAggregates);
      mergeDashboardModelRows(binModelRows, point.modelAggregates);
    }
    return {
      dateKey: formatDateKey(bin.start),
      label: bin.label,
      totalTokens,
      totalAssistantMessages,
      totalCacheTokens,
      providerSegments,
      modelAggregates: sortDashboardModelRows(filterDominatedUnknownModels(binModelRows)),
    };
  });
  const totalTokens = binned.reduce((sum, point) => sum + point.totalTokens, 0);
  const totalAssistantMessages = binned.reduce((sum, point) => sum + point.totalAssistantMessages, 0);
  const totalCacheTokens = binned.reduce((sum, point) => sum + (point.totalCacheTokens ?? 0), 0);
  const activeBinCount = binned.filter(point => point.totalTokens > 0 || point.totalAssistantMessages > 0).length;

  return {
    key: rangeKey,
    label: historyRangeLabel(rangeKey),
    granularityLabel: historyRangeMeta(rangeKey),
    points: binned,
    modelRows: sortDashboardModelRows(filterDominatedUnknownModels(modelRows)),
    maxTotalTokens: binned.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    totalTokens,
    totalAssistantMessages,
    totalCacheTokens,
    activeBinCount,
    unavailableReason: activeBinCount > 0 ? undefined : `No usage records in the ${historyRangeLabel(rangeKey)} range.`,
  };
}

function mergeDashboardModelRows(
  target: DashboardModelUsageAggregate[],
  source: ReadonlyArray<DashboardModelUsageAggregate> | undefined,
): void {
  for (const row of source ?? []) {
    const existing = target.find(candidate =>
      candidate.providerId === row.providerId &&
      candidate.modelLabel.toLowerCase() === row.modelLabel.toLowerCase()
    );
    if (existing) {
      existing.totalTokens += row.totalTokens;
      existing.totalAssistantMessages += row.totalAssistantMessages;
      existing.sourceLabels = uniqueLabels([
        ...existing.sourceLabels,
        ...row.sourceLabels,
      ]);
      continue;
    }
    target.push({ ...row, sourceLabels: row.sourceLabels.slice() });
  }
}

function sortDashboardModelRows(rows: DashboardModelUsageAggregate[]): DashboardModelUsageAggregate[] {
  return rows.slice().sort((a, b) => {
    const tokenDelta = b.totalTokens - a.totalTokens;
    if (tokenDelta !== 0) {
      return tokenDelta;
    }
    const providerDelta = a.providerLabel.localeCompare(b.providerLabel);
    return providerDelta !== 0 ? providerDelta : a.modelLabel.localeCompare(b.modelLabel);
  });
}

function filterDominatedUnknownModels(rows: DashboardModelUsageAggregate[]): DashboardModelUsageAggregate[] {
  const hasNamedModel = rows.some(row => row.modelLabel.toLowerCase() !== 'unknown model');
  return hasNamedModel
    ? rows.filter(row => row.modelLabel.toLowerCase() !== 'unknown model')
    : rows;
}

function uniqueLabels(labels: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function historyPointsForSource(
  sourceTotals: DashboardSourceModeTotals,
  providerId?: string,
): DashboardHistoryPoint[] {
  return providerId
    ? findSourceProvider(sourceTotals, providerId).historyPoints
    : sourceTotals.historyPoints;
}

function buildHistoryRangeViews(
  sourceTotals: DashboardSourceModeTotals,
  providerId?: string,
): DashboardHistoryRangeView[] {
  const points = historyPointsForSource(sourceTotals, providerId);
  return DASHBOARD_HISTORY_RANGE_KEYS.map(rangeKey => buildHistoryRangeView(points, rangeKey));
}

function historyRangeViewForSource(
  sourceTotals: DashboardSourceModeTotals,
  rangeKey: DashboardHistoryRangeKey,
  providerId?: string,
): DashboardHistoryRangeView {
  return buildHistoryRangeView(historyPointsForSource(sourceTotals, providerId), rangeKey);
}

function historyChartAttributes(
  model: DashboardModel,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals =>
    buildHistoryRangeViews(sourceTotals, providerId).map(view => {
      const key = `${sourceTotals.sourceMode}-${view.key}`;
      return [
        `data-history-source-label-${esc(sourceTotals.sourceMode)}="${esc(sourceTotals.label)}"`,
        `data-history-total-label-${esc(key)}="${esc(formatTokenCount(view.totalTokens))}"`,
        `data-history-selected-messages-${esc(key)}="${esc(formatMessageCount(view.totalAssistantMessages))}"`,
        `data-history-cache-label-${esc(key)}="${view.totalCacheTokens > 0 ? esc(formatTokenCount(view.totalCacheTokens)) : ''}"`,
        `data-history-range-meta-${esc(key)}="${esc(view.granularityLabel)}"`,
        `data-history-empty-${esc(key)}="${view.totalTokens <= 0 && view.totalAssistantMessages <= 0 ? 'true' : 'false'}"`,
      ].join(' ');
    })).join(' ');
}

function renderUsageHistoryChart(
  model: DashboardModel,
  _defaultWindowId: DashboardLocalHistoryWindow['windowId'],
  provider?: DashboardProviderCard,
): string {
  const scope = provider ? provider.providerId : 'overview';
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedView = buildHistoryRangeView(historyPointsForSource(selectedSource, provider?.providerId), DEFAULT_HISTORY_RANGE_KEY);
  const chartTitle = provider ? `${provider.label} history chart` : 'History chart';
  const chartCopy = provider
    ? 'Range-controlled daily trend for this provider when day buckets are available.'
    : 'Range-controlled usage trend by provider using local and imported day buckets where available.';
  const rangeButtons = DASHBOARD_HISTORY_RANGE_KEYS.map(rangeKey => {
    const selected = rangeKey === DEFAULT_HISTORY_RANGE_KEY;
    return `<button type="button" class="history-range-btn${selected ? ' active' : ''}" data-history-range="${esc(rangeKey)}" aria-pressed="${selected ? 'true' : 'false'}">${esc(historyRangeLabel(rangeKey))}</button>`;
  }).join('\n');
  const groups = model.sourceModeTotals.flatMap(sourceTotals =>
    buildHistoryRangeViews(sourceTotals, provider?.providerId).map(view => {
      const groupKey = `${sourceTotals.sourceMode}-${view.key}`;
      const isVisible = sourceTotals.sourceMode === model.defaultSourceMode && view.key === DEFAULT_HISTORY_RANGE_KEY;
      const bars = view.points.map(point => {
        const height = historyWindowBarHeight(point.totalTokens, view.maxTotalTokens);
        const isEmpty = point.totalTokens <= 0 && point.totalAssistantMessages <= 0;
        const modelSegmentsHtml = renderHistoryModelSegments(point.modelAggregates, point.totalTokens);
        const tipData = esc(JSON.stringify({
          kind: 'history',
          title: point.label,
          tokens: formatTokenCount(point.totalTokens),
          messages: formatMessageCount(point.totalAssistantMessages),
          cache: point.totalCacheTokens ? formatTokenCount(point.totalCacheTokens) : '',
          source: groupKey.split('-')[0],
          models: point.modelAggregates.filter(m => m.totalTokens > 0).slice(0, 5).map(m => ({
            label: m.modelLabel,
            color: modelColorIndex(m.modelLabel),
            tokens: formatTokenCount(m.totalTokens),
          })),
        }));
        return `
      <div class="usage-history-bin">
        <div class="usage-history-bar${isEmpty ? ' empty' : ''}" data-history-bin-bar="${esc(point.dateKey)}" tabindex="0" data-pf-tip="${tipData}" role="meter" aria-label="${esc(`${point.label}: ${formatTokenCount(point.totalTokens)}, ${formatMessageCount(point.totalAssistantMessages)}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(height)}">
          <div class="usage-history-bar-fill stacked" style="height: ${esc(height)}%">
            ${modelSegmentsHtml}
          </div>
        </div>
        <div class="usage-history-bin-label">${esc(point.label)}</div>
      </div>`;
      }).join('\n');
      const legendItems = view.modelRows.slice(0, 8).map(row =>
        `<span><span class="usage-history-legend-swatch" style="background: ${modelColorVar(row.modelLabel)}; border-radius: 2px"></span>${esc(row.modelLabel)}</span>`
      ).join('\n');

      return `
      <div class="usage-history-range-group" data-history-range-group="${esc(groupKey)}"${isVisible ? '' : ' hidden'}>
        <div class="usage-history-empty calm-state"${view.activeBinCount > 0 ? ' hidden' : ''}>
          <div class="calm-state-header">${esc(view.unavailableReason ?? 'No history data for this selection')}</div>
          <div class="calm-state-copy">Try another source mode or wait for daily snapshot buckets.</div>
        </div>
        <div class="usage-history-bars" style="--history-bin-count: ${view.points.length}">
          ${bars}
        </div>
        <div class="history-summary-grid">
          <div class="history-summary-card"><span>History</span><strong>${esc(String(view.activeBinCount))} active ${view.key === '1Y' ? 'weeks' : view.key === 'ALL' ? 'months' : 'days'}</strong></div>
          <div class="history-summary-card"><span>Tokens</span><strong>${esc(formatTokenCount(view.totalTokens))}</strong></div>
          <div class="history-summary-card"><span>Activity</span><strong>${esc(formatMessageCount(view.totalAssistantMessages))}</strong></div>
          ${view.totalCacheTokens > 0 ? `<div class="history-summary-card"><span>Cache</span><strong>${esc(formatTokenCount(view.totalCacheTokens))}</strong></div>` : ''}
        </div>
        ${legendItems ? `<div class="usage-history-legend" aria-label="Model color legend">${legendItems}</div>` : ''}
      </div>`;
    })).join('\n');

  return `
    <div class="usage-history-chart" data-history-chart="${esc(scope)}" ${historyChartAttributes(model, provider?.providerId)}>
      <div class="usage-history-chart-head">
        <div>
          <div class="usage-history-chart-title">${esc(chartTitle)}</div>
          <div class="usage-history-chart-meta"><span class="source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span> - <span class="usage-history-range-meta">${esc(selectedView.granularityLabel)}</span></div>
        </div>
        <div class="distribution-total">
          <span class="distribution-total-value usage-history-total-value">${esc(formatTokenCount(selectedView.totalTokens))}</span>
          <span class="distribution-total-messages usage-history-selected-messages">${esc(formatMessageCount(selectedView.totalAssistantMessages))}</span>
        </div>
      </div>
      <div class="history-range-selector" aria-label="History range">
        ${rangeButtons}
      </div>
      ${groups}
      <div class="usage-history-chart-copy">${esc(chartCopy)}</div>
    </div>`;
}

function renderHistoryModelSegments(
  models: ReadonlyArray<DashboardModelUsageAggregate>,
  totalTokens: number,
): string {
  if (totalTokens <= 0 || !models || models.length === 0) {
    return '';
  }
  return models
    .filter(model => model.totalTokens > 0)
    .slice(0, 8)
    .map(model => {
      const height = distributionWidth(model.totalTokens, totalTokens);
      return `<div class="usage-history-bar-segment" style="height: ${esc(height)}%; background: ${modelColorVar(model.modelLabel)}"></div>`;
    }).join('');
}

function formatModelProviderLabel(row: DashboardModelUsageAggregate): string {
  const sourceSummary = formatSnapshotSourceLabels(row.sourceLabels, 2);
  if (!sourceSummary) {
    return row.providerLabel;
  }
  if (row.sourceMode === 'combined') {
    return `${row.providerLabel} + ${row.providerLabel} (${sourceSummary})`;
  }
  return `${row.providerLabel} (${sourceSummary})`;
}

function formatModelRowTitle(base: string, row: DashboardModelUsageAggregate): string {
  const sourceSummary = formatSnapshotSourceLabels(row.sourceLabels, 3);
  return sourceSummary ? `${base} - Snapshots: ${sourceSummary}` : base;
}

const MODEL_SERIES_COLOR_COUNT = 12;

function modelColorIndex(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = Math.imul(31, hash) + label.charCodeAt(i) | 0;
  }
  return Math.abs(hash) % MODEL_SERIES_COLOR_COUNT;
}

function modelColorVar(label: string): string {
  return `var(--pf-model-${modelColorIndex(label)})`;
}

function providerColorVar(providerId: string): string {
  if (providerId === 'claude') {
    return 'var(--pf-provider-claude)';
  }
  if (providerId === 'codex') {
    return 'var(--pf-provider-codex)';
  }
  return 'var(--vscode-focusBorder, #007acc)';
}

function modelDonutGradient(
  rows: Array<{ modelLabel: string; totalTokens: number }>,
  totalTokens: number,
): string {
  if (totalTokens <= 0) {
    return 'conic-gradient(rgba(127,127,127,0.18) 0% 100%)';
  }

  let cursor = 0;
  const parts = rows
    .filter(row => row.totalTokens > 0)
    .map(row => {
      const start = cursor;
      const end = Math.min(100, cursor + (row.totalTokens / totalTokens) * 100);
      cursor = end;
      return `${modelColorVar(row.modelLabel)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });

  if (parts.length === 0) {
    return 'conic-gradient(rgba(127,127,127,0.18) 0% 100%)';
  }

  if (cursor < 100) {
    parts.push(`rgba(127,127,127,0.18) ${cursor.toFixed(2)}% 100%`);
  }

  return `conic-gradient(${parts.join(', ')})`;
}

function modelRowsForSourceRange(
  sourceTotals: DashboardSourceModeTotals,
  rangeKey: DashboardHistoryRangeKey,
  providerId?: string,
): DashboardModelUsageAggregate[] {
  const rangeRows = historyRangeViewForSource(sourceTotals, rangeKey, providerId).modelRows;
  const fallbackWindow = rangeKey === '1W' ? 'last7d' : 'all';
  const fallbackRows = sourceTotals.modelWindows[fallbackWindow] ?? [];
  const rows = rangeRows.length > 0 ? rangeRows : fallbackRows;
  const scopedRows = providerId
    ? rows.filter(row => row.providerId === providerId)
    : rows;
  return filterDominatedUnknownModels(scopedRows);
}

function modelRowKey(row: Pick<DashboardModelUsageAggregate, 'providerId' | 'modelLabel'>): string {
  return `${row.providerId}--${row.modelLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function modelDistributionTotal(
  rows: DashboardModelUsageAggregate[],
): { totalTokens: number; totalAssistantMessages: number } {
  return rows.reduce((sum, row) => ({
    totalTokens: sum.totalTokens + row.totalTokens,
    totalAssistantMessages: sum.totalAssistantMessages + row.totalAssistantMessages,
  }), { totalTokens: 0, totalAssistantMessages: 0 });
}

function modelRowsForCard(
  model: DashboardModel,
  providerId?: string,
): DashboardModelUsageAggregate[] {
  const rowsByKey = new Map<string, DashboardModelUsageAggregate>();
  for (const sourceTotals of model.sourceModeTotals) {
    for (const rangeKey of DASHBOARD_HISTORY_RANGE_KEYS) {
      for (const row of modelRowsForSourceRange(sourceTotals, rangeKey, providerId)) {
        const key = modelRowKey(row);
        const existing = rowsByKey.get(key);
        if (!existing || row.totalTokens > existing.totalTokens) {
          rowsByKey.set(key, row);
        }
      }
    }
  }
  return Array.from(rowsByKey.values()).sort((a, b) => {
    const tokenDelta = b.totalTokens - a.totalTokens;
    if (tokenDelta !== 0) {
      return tokenDelta;
    }
    const providerDelta = a.providerLabel.localeCompare(b.providerLabel);
    return providerDelta !== 0 ? providerDelta : a.modelLabel.localeCompare(b.modelLabel);
  });
}

function modelDistributionCardAttributes(
  model: DashboardModel,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => DASHBOARD_HISTORY_RANGE_KEYS.map(rangeKey => {
    const rows = modelRowsForSourceRange(sourceTotals, rangeKey, providerId);
    const total = modelDistributionTotal(rows);
    const key = `${sourceTotals.sourceMode}-${rangeKey}`;
    const isEmpty = total.totalTokens <= 0 && total.totalAssistantMessages <= 0;
    return [
      `data-model-total-label-${esc(key)}="${esc(formatTokenCount(total.totalTokens))}"`,
      `data-model-total-messages-${esc(key)}="${esc(formatMessageCount(total.totalAssistantMessages))}"`,
      `data-model-gradient-${esc(key)}="${esc(modelDonutGradient(rows, total.totalTokens))}"`,
      `data-model-empty-${esc(key)}="${isEmpty ? 'true' : 'false'}"`,
    ].join(' ');
  })).join(' ');
}

function modelDistributionRowAttributes(
  model: DashboardModel,
  rowKey: string,
  scopeProviderId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => DASHBOARD_HISTORY_RANGE_KEYS.map(rangeKey => {
    const rows = modelRowsForSourceRange(sourceTotals, rangeKey, scopeProviderId);
    const row = rows.find(candidate => modelRowKey(candidate) === rowKey);
    const total = modelDistributionTotal(rows);
    const sorted = rows.slice().sort((a, b) => b.totalTokens - a.totalTokens);
    const rank = row ? sorted.findIndex(candidate => modelRowKey(candidate) === rowKey) + 1 : 999;
    const key = `${sourceTotals.sourceMode}-${rangeKey}`;
    const tokens = row?.totalTokens ?? 0;
    const messages = row?.totalAssistantMessages ?? 0;
    const providerLabel = row ? formatModelProviderLabel(row) : '';
    const title = row ? formatModelRowTitle(formatMessageCount(messages), row) : formatMessageCount(messages);
    return [
      `data-model-visible-${esc(key)}="${row && tokens > 0 && rank <= 8 ? 'true' : 'false'}"`,
      `data-model-rank-${esc(key)}="${esc(String(rank))}"`,
      `data-model-tokens-${esc(key)}="${esc(String(tokens))}"`,
      `data-model-value-${esc(key)}="${esc(formatTokenCount(tokens))}"`,
      `data-model-messages-${esc(key)}="${esc(formatMessageCount(messages))}"`,
      `data-model-provider-label-${esc(key)}="${esc(providerLabel)}"`,
      `data-model-title-${esc(key)}="${esc(title)}"`,
      `data-model-percent-${esc(key)}="${esc(formatDistributionPercent(tokens, total.totalTokens))}"`,
      `data-model-width-${esc(key)}="${esc(distributionWidth(tokens, total.totalTokens))}"`,
    ].join(' ');
  })).join(' ');
}

function renderModelBreakdownDistribution(
  model: DashboardModel,
  _defaultWindowId: DashboardLocalHistoryWindow['windowId'],
  provider?: DashboardProviderCard,
): string {
  const scope = provider ? provider.providerId : 'overview';
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedRows = modelRowsForSourceRange(selectedSource, DEFAULT_HISTORY_RANGE_KEY, provider?.providerId);
  const selectedTotal = modelDistributionTotal(selectedRows);
  const allRows = modelRowsForCard(model, provider?.providerId);
  const rowHtml = allRows.map(row => {
    const key = modelRowKey(row);
    const selectedRow = selectedRows.find(candidate => modelRowKey(candidate) === key);
    const tokens = selectedRow?.totalTokens ?? 0;
    const messages = selectedRow?.totalAssistantMessages ?? 0;
    const percent = formatDistributionPercent(tokens, selectedTotal.totalTokens);
    const width = distributionWidth(tokens, selectedTotal.totalTokens);
    const rank = selectedRows.findIndex(candidate => modelRowKey(candidate) === key) + 1;
    const visible = tokens > 0 && rank > 0 && rank <= 8;
    const providerLabel = formatModelProviderLabel(selectedRow ?? row);
    const modelTitle = formatModelRowTitle(formatMessageCount(messages), selectedRow ?? row);
    const tipData = esc(JSON.stringify({ kind: 'model', label: row.modelLabel, provider: row.providerLabel }));
    return `
      <div class="usage-model-row provider-${esc(row.providerId)}" data-model-row="${esc(key)}" ${modelDistributionRowAttributes(model, key, provider?.providerId)} ${visible ? '' : 'hidden'} style="order: ${esc(String(rank > 0 ? rank : 999))}; --model-color: ${modelColorVar(row.modelLabel)}" tabindex="0" data-pf-tip="${tipData}" aria-label="${esc(modelTitle)}">
        <span class="usage-model-swatch" aria-hidden="true"></span>
        <span class="usage-model-provider">${esc(providerLabel)}</span>
        <span class="usage-model-name">${esc(row.modelLabel)}</span>
        <span class="usage-model-value">${esc(formatTokenCount(tokens))}</span>
        <span class="usage-model-count">${esc(formatMessageCount(messages))}</span>
        <span class="usage-model-percent">${esc(percent)}</span>
      </div>`;
  }).join('\n');
  const title = provider ? `${provider.label} model breakdown` : 'Model breakdown';
  const rowBody = rowHtml || '<div class="usage-model-empty-inline">No model breakdown available.</div>';

  return `
    <div class="usage-model-distribution" data-model-breakdown="${esc(scope)}" ${modelDistributionCardAttributes(model, provider?.providerId)}>
      <div class="usage-model-distribution-head">
        <div>
          <div class="usage-model-distribution-title">${esc(title)}</div>
          <div class="usage-model-distribution-meta"><span class="source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span> - selected history range</div>
        </div>
        ${sourceModeChip(model.defaultSourceMode)}
      </div>
      <div class="usage-model-empty calm-state">
        <div class="calm-state-header">No model breakdown available.</div>
        <div class="calm-state-copy">Safe aggregate model totals will appear here when local history or snapshots provide them.</div>
      </div>
      <div class="usage-model-distribution-body">
        <div class="usage-model-donut" data-model-donut="${esc(scope)}" style="background: ${esc(modelDonutGradient(selectedRows, selectedTotal.totalTokens))}">
          <div class="usage-model-donut-core">
            <span class="usage-model-donut-total">${esc(formatTokenCount(selectedTotal.totalTokens))}</span>
            <span class="usage-model-donut-label">${esc(formatMessageCount(selectedTotal.totalAssistantMessages))}</span>
          </div>
        </div>
        <div class="usage-model-legend">
          ${rowBody}
        </div>
      </div>
    </div>`;
}

function laneLabelForSource(
  sourceTotals: DashboardSourceModeTotals,
  providerId?: string,
): string {
  const providers = providerId
    ? [findSourceProvider(sourceTotals, providerId)]
    : sourceTotals.providers;
  const parts: string[] = [];
  for (const provider of providers) {
    const hasLocal = sourceTotals.sourceMode !== 'snapshots' &&
      findLocalHistoryWindow(provider.windows, 'all').totalTokens > 0;
    const sourceSummary = formatSnapshotSourceLabels(provider.sourceLabels, 2);
    if (hasLocal) {
      parts.push(provider.label);
    }
    if (sourceSummary) {
      parts.push(`${provider.label} (${sourceSummary})`);
    }
    if (!hasLocal && !sourceSummary && findLocalHistoryWindow(provider.windows, 'today').totalTokens > 0) {
      parts.push(provider.label);
    }
  }
  return parts.length > 0 ? parts.join(' + ') : (providerId ? findSourceProvider(sourceTotals, providerId).label : sourceTotals.label);
}

function renderTodaySection(
  model: DashboardModel,
  provider?: DashboardProviderCard,
): string {
  const title = provider ? `${provider.label} today` : 'Today';
  const groups = model.sourceModeTotals.map(sourceTotals => {
    const today = provider
      ? findLocalHistoryWindow(findSourceProvider(sourceTotals, provider.providerId).windows, 'today')
      : findLocalHistoryWindow(sourceTotals.windows, 'today');
    const todayModels = sourceTotals.modelWindows.today ?? [];
    const modelRows = provider
      ? todayModels.filter(row => row.providerId === provider.providerId)
      : todayModels;
    const topModels = modelRows
      .filter(row => row.totalTokens > 0)
      .slice(0, 3)
      .map(row => row.modelLabel)
      .join(', ');
    const laneLabel = laneLabelForSource(sourceTotals, provider?.providerId);
    const empty = today.totalTokens <= 0 && today.totalAssistantMessages <= 0;
    const hidden = sourceTotals.sourceMode === model.defaultSourceMode ? '' : ' hidden';

    if (empty) {
      return `
      <div class="today-source-group" data-today-source-group="${esc(sourceTotals.sourceMode)}"${hidden}>
        <div class="today-empty calm-state">
          <div class="calm-state-header">Today unavailable</div>
          <div class="calm-state-copy">${esc(provider ? `${provider.label} has no ${sourceTotals.label.toLowerCase()} usage for today.` : `${sourceTotals.label} has no usage for today.`)}</div>
        </div>
      </div>`;
    }

    const cacheTokens = (today.totalCacheCreationInputTokens ?? 0) + (today.totalCacheReadInputTokens ?? 0);
    const cacheCard = cacheTokens > 0
      ? `<div class="today-card">
            <span class="metric-label">Cache</span>
            <span class="today-card-value">${esc(formatTokenCount(cacheTokens))}</span>
            <span class="today-card-copy">Prompt cache activity</span>
          </div>`
      : '';
    return `
      <div class="today-source-group" data-today-source-group="${esc(sourceTotals.sourceMode)}"${hidden}>
        <div class="today-card-grid">
          <div class="today-card">
            <span class="metric-label">Tokens</span>
            <span class="today-card-value">${esc(formatTokenCount(today.totalTokens))}</span>
            <span class="today-card-copy">${esc(`${formatMessageCount(today.totalAssistantMessages)}${topModels ? ` - ${topModels}` : ''}`)}</span>
          </div>
          <div class="today-card">
            <span class="metric-label">Activity</span>
            <span class="today-card-value">${esc(formatMessageCount(today.totalAssistantMessages))}</span>
            <span class="today-card-copy">${esc(laneLabel)}</span>
          </div>
          ${cacheCard}
        </div>
        <div class="snapshot-note">${esc(`${title} - ${laneLabel}`)}</div>
      </div>
    `;
  }).join('\n');

  return `
    <div class="today-panel" data-today-section="${esc(provider?.providerId ?? 'overview')}">
      ${groups}
    </div>`;
}


function renderLocalHistoryWindowSelector(model: DashboardModel): string {
  const buttons = model.localHistoryWindows.map(w => {
    const selected = w.windowId === model.defaultLocalHistoryWindowId;
    return `<button type="button" class="window-btn${selected ? ' active' : ''}" data-local-window="${esc(w.windowId)}" aria-pressed="${selected ? 'true' : 'false'}">${esc(w.label)}</button>`;
  }).join('\n');

  return `
  <div class="window-selector" aria-label="Local history window">
    ${buttons}
  </div>`;
}

function renderSourceModeSelector(model: DashboardModel): string {
  const buttons = model.sourceModes.map(mode => {
    const selected = mode.sourceMode === model.defaultSourceMode;
    const disabled = !mode.available;
    const disabledLabel = disabled ? ' unavailable' : '';
    return `<button type="button" class="source-btn${selected ? ' active' : ''}" data-source-mode="${esc(mode.sourceMode)}" aria-pressed="${selected ? 'true' : 'false'}"${disabled ? ' disabled aria-disabled="true"' : ''} aria-label="${esc(`${mode.label}${disabledLabel}`)}">${sourceModeChip(mode.sourceMode)}<span class="control-label">${esc(mode.label)}</span></button>`;
  }).join('\n');

  return `
  <div class="source-selector" aria-label="Usage history source">
    ${buttons}
  </div>`;
}

function sourceModeRangeDataAttributes(
  totals: DashboardSourceModeTotals[],
  value: 'tokens' | 'messages',
  providerId?: string,
): string {
  return totals.flatMap(sourceTotals => DASHBOARD_HISTORY_RANGE_KEYS.map(rangeKey => {
    const view = historyRangeViewForSource(sourceTotals, rangeKey, providerId);
    const raw = value === 'tokens' ? formatTokenCount(view.totalTokens) : String(view.totalAssistantMessages);
    return `data-${value}-${esc(sourceTotals.sourceMode)}-${esc(rangeKey)}="${esc(raw)}"`;
  })).join(' ');
}


function renderProviderTab(model: DashboardModel, providerId: string): string {
  const provider = model.providers.find(p => p.providerId === providerId);
  if (!provider) {
    return '';
  }

  const parseErrorNote = provider.parseErrors > 0
    ? `<div class="parse-error-note">${esc(formatParseErrorText(provider.parseErrors))} in local history</div>`
    : '';
  return `
  <section class="tab-panel" id="tab-${esc(provider.providerId)}" data-dashboard-tab-panel="${esc(provider.providerId)}" role="tabpanel" aria-labelledby="tab-button-${esc(provider.providerId)}" hidden>
    <div class="usage-section-title">Usage</div>
    ${renderProviderLiveQuotaSection(model, provider)}

    ${sectionHeader(`${provider.label} today`, sourceModeChip(model.defaultSourceMode), 'Selected source usage for the local day.')}
    ${parseErrorNote}
    ${renderTodaySection(model, provider)}

    ${sectionHeader(`${provider.label} history`, sourceModeChip(model.defaultSourceMode), 'Range-controlled token trend from daily bins where available.')}
    ${renderUsageHistoryChart(model, model.defaultLocalHistoryWindowId, provider)}

    ${sectionHeader(`${provider.label} model breakdown`, sourceModeChip(model.defaultSourceMode), 'Safe aggregate model totals for this provider.')}
    ${renderModelBreakdownDistribution(model, model.defaultLocalHistoryWindowId, provider)}
  </section>`;
}

function renderSourceModeCopy(model: DashboardModel): string {
  if (model.snapshotAggregate.snapshotCount === 0 || model.snapshotAggregate.providers.length === 0) {
    return `${model.defaultSourceMode === 'snapshots' ? 'Snapshot source mode is configured; no imported snapshots are currently available.' : 'No imported snapshots found.'} Dashboard usage source: ${DASHBOARD_SOURCE_MODE_LABELS_FOR_COPY[model.defaultSourceMode]}.`;
  }
  const sourceSummary = formatSnapshotSourceLabels(model.snapshotAggregate.sourceLabels);
  return sourceSummary
    ? `Imported snapshots available from ${sourceSummary}. Dashboard usage source: ${DASHBOARD_SOURCE_MODE_LABELS_FOR_COPY[model.defaultSourceMode]}.`
    : `Imported snapshots available. Dashboard usage source: ${DASHBOARD_SOURCE_MODE_LABELS_FOR_COPY[model.defaultSourceMode]}.`;
}

const DASHBOARD_SOURCE_MODE_LABELS_FOR_COPY: Record<string, string> = {
  local: 'Local only',
  snapshots: 'Snapshots only',
  combined: 'Combined',
};

function renderFooterSnapshotSummary(model: DashboardModel): string {
  const aggregate = model.snapshotAggregate;
  if (aggregate.snapshotCount === 0 || aggregate.providers.length === 0) {
    return '<div>Imported snapshots: 0</div>';
  }
  const sourceSummary = formatSnapshotSourceLabels(aggregate.sourceLabels);
  const providerCoverage = Array.from(new Set(aggregate.providers.map(p => p.label))).sort().join(', ');
  const parts = [
    `Imported snapshots: ${aggregate.snapshotCount}`,
    sourceSummary ? `Snapshot sources: ${sourceSummary}` : undefined,
    providerCoverage ? `Providers: ${providerCoverage}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return `<div>${esc(parts.join(' | '))}</div>`;
}

function renderSnapshotSummary(model: DashboardModel): string {
  const aggregate = model.snapshotAggregate;
  if (aggregate.snapshotCount === 0 || aggregate.providers.length === 0) {
    return `
  <div class="snapshot-summary">
    ${sectionHeader('Imported snapshots', stateChip('SNAPSHOT', 'snapshot'), 'Optional aggregate imports for usage history.')}
    <div class="snapshot-empty calm-state">
      <div class="calm-state-header">No snapshots found</div>
      <div class="calm-state-copy">Snapshot imports are optional; local history remains available.</div>
    </div>
  </div>`;
  }

  const providerCoverage = Array.from(new Set(aggregate.providers.map(p => p.label))).sort().join(', ');
  const sourceSummary = formatSnapshotSourceLabels(aggregate.sourceLabels);
  const latestGeneratedMs = aggregate.providers.reduce<number | undefined>((latest, provider) => {
    if (latest === undefined || provider.generatedAtMs > latest) {
      return provider.generatedAtMs;
    }
    return latest;
  }, undefined);
  const generated = latestGeneratedMs !== undefined
    ? formatRefreshTime(latestGeneratedMs)
    : 'Not provided';
  const refreshed = aggregate.lastReadMs !== undefined
    ? formatRefreshTime(aggregate.lastReadMs)
    : 'Not yet refreshed';
  const topProviderRows = aggregate.providers
    .slice()
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 6)
    .map(provider => `
      <div class="snapshot-provider-row">
        <span>${esc(provider.label)}${provider.sourceLabel ? ` (${esc(provider.sourceLabel)})` : ''}</span>
        <strong>${esc(formatTokenCount(provider.totalTokens))}</strong>
        <span>${esc(formatMessageCount(provider.totalAssistantMessages))}</span>
      </div>`)
    .join('\n');

  return `
  <div class="snapshot-summary">
    ${sectionHeader('Imported snapshots', `${stateChip('SNAPSHOT', 'snapshot')}${stateChip('AGGREGATE ONLY', 'aggregate-only')}`, 'Optional aggregate imports for usage history.')}
    <div class="overview">
      <div class="overview-row">
        <span class="overview-label">Snapshots</span>
        <span class="overview-value">${esc(String(aggregate.snapshotCount))}</span>
      </div>
      <div class="overview-row">
        <span class="overview-label">Provider coverage</span>
        <span class="overview-value">${esc(providerCoverage)}</span>
      </div>
      ${sourceSummary ? `
      <div class="overview-row">
        <span class="overview-label">Snapshot sources</span>
        <span class="overview-value">${esc(sourceSummary)}</span>
      </div>` : ''}
      <div class="overview-row">
        <span class="overview-label">Latest generated</span>
        <span class="overview-value">${esc(generated)}</span>
      </div>
      <div class="overview-row">
        <span class="overview-label">Snapshot refresh</span>
        <span class="overview-value">${esc(refreshed)}</span>
      </div>
      <div class="overview-row">
        <span class="overview-label">Limit</span>
        <span class="overview-value">Aggregate only</span>
      </div>
    </div>
    <div class="snapshot-provider-list">
      ${topProviderRows}
    </div>
  </div>`;
}

function renderSnapshotWindowNotes(model: DashboardModel): string {
  return model.sourceModeTotals
    .filter(t => t.sourceMode !== 'local' && t.missingSnapshotWindowIds.length > 0)
    .map(t => {
      const labels = t.missingSnapshotWindowIds.map(windowId => findLocalHistoryWindow(t.windows, windowId).label).join(', ');
      return `<div class="source-window-note" data-source-window-note="${esc(t.sourceMode)}" data-missing-windows="${esc(t.missingSnapshotWindowIds.join(','))}" hidden>Imported snapshots do not provide ${esc(labels)} totals; missing snapshot windows contribute 0.</div>`;
    })
    .join('\n');
}

export function buildDashboardHtml(
  webview: vscode.Webview,
  model: DashboardModel,
): string {
  const nonce = generateNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>PromptFuel Dashboard</title>
<style>
  :root {
    --pf-provider-claude: var(--vscode-charts-blue, #75beff);
    --pf-provider-codex: var(--vscode-charts-purple, #b180d7);
    --pf-keyline: rgba(127,127,127,0.12);
    --pf-model-0: var(--vscode-charts-blue, #4f8fd6);
    --pf-model-1: var(--vscode-charts-yellow, #c79538);
    --pf-model-2: var(--vscode-charts-purple, #9b7bd3);
    --pf-model-3: var(--vscode-charts-orange, #c77737);
    --pf-model-4: #3aa99f;
    --pf-model-5: #c96f8a;
    --pf-model-6: #2f9ec2;
    --pf-model-7: #8da653;
    --pf-model-8: #6f83d8;
    --pf-model-9: #a87854;
    --pf-model-10: #7f9bb3;
    --pf-model-11: #b76ac4;
  }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #cccccc);
    background-color: var(--vscode-editor-background, #1e1e1e);
    margin: 0;
    padding: 16px 20px;
    font-size: var(--vscode-font-size, 13px);
    max-width: none;
    min-height: 100vh;
  }
  .dashboard {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0 0 16px;
    container-type: inline-size;
  }
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 14px;
  }
  .title {
    font-size: 24px;
    font-weight: 600;
    line-height: 1.15;
    margin-bottom: 5px;
  }
  .subtitle {
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .header-chip-row,
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 7px;
    min-width: 0;
  }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    text-transform: uppercase;
  }
  .section-subtitle,
  .card-kicker {
    display: block;
    margin-top: 3px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    margin: 24px 0 11px;
    min-width: 0;
  }
  .disclaimer {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 18px;
    line-height: 1.5;
  }
  .overview {
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .window-selector,
  .source-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    margin-bottom: 12px;
    row-gap: 6px;
  }
  .window-btn,
  .source-btn {
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 0;
    min-height: 30px;
    padding: 6px 11px;
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-left: -1px;
    max-width: 100%;
  }
  .window-btn:first-child,
  .source-btn:first-child {
    margin-left: 0;
    border-top-left-radius: 6px;
    border-bottom-left-radius: 6px;
  }
  .window-btn:last-child,
  .source-btn:last-child {
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
  }
  .window-btn:hover,
  .source-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(127,127,127,0.12));
  }
  .window-btn.active,
  .source-btn.active {
    background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-secondaryBackground, rgba(127,127,127,0.2)));
    color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground, #cccccc));
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: inset 0 -2px 0 var(--vscode-focusBorder, #007acc);
    font-weight: 600;
  }
  .window-btn:focus-visible,
  .source-btn:focus-visible,
  .tab-btn:focus-visible,
  .refresh-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 2px;
  }
  .source-btn:disabled,
  .source-btn[aria-disabled="true"] {
    background: var(--vscode-input-background, rgba(127,127,127,0.04));
    color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #999999));
    border-style: dashed;
    opacity: 0.75;
    cursor: default;
    box-shadow: none;
  }
  .source-btn:disabled .badge {
    color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #999999));
    border-color: var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .control-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 18px;
    margin-bottom: 6px;
  }
  .control-group .section-header {
    margin-top: 0;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 16px 0 18px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    padding-bottom: 0;
  }
  .tab-btn {
    background: transparent;
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 7px 7px 0 0;
    padding: 8px 14px 9px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    position: relative;
    top: 1px;
  }
  .tab-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(127,127,127,0.12));
  }
  .tab-btn.active {
    background: var(--vscode-tab-activeBackground, var(--vscode-sideBar-background, rgba(127,127,127,0.08)));
    color: var(--vscode-tab-activeForeground, var(--vscode-foreground, #cccccc));
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: inset 0 2px 0 var(--vscode-focusBorder, #007acc);
  }
  .tab-panel[hidden] {
    display: none;
  }
  .overview-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 5px 0;
  }
  .overview-label {
    color: var(--vscode-descriptionForeground, #999999);
    min-width: 0;
  }
  .overview-value {
    font-weight: 600;
    min-width: 0;
    text-align: right;
    overflow-wrap: anywhere;
  }
  .provider-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 15px 16px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
  }
  .snapshot-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 15px 16px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
  }
  .provider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .provider-label {
    font-weight: 600;
    font-size: 14px;
  }
  .badge {
    font-size: 11px;
    padding: 3px 7px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.2px;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    line-height: 1.2;
  }
  .chip-mark {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    border: 1px solid currentColor;
    display: inline-block;
  }
  .badge.loaded {
    background: rgba(56, 139, 56, 0.2);
    color: var(--vscode-charts-green, #3c963c);
  }
  .badge.no-data {
    background: rgba(136, 136, 136, 0.2);
    color: var(--vscode-descriptionForeground, #888888);
  }
  .badge.error {
    background: rgba(233, 50, 98, 0.2);
    color: var(--vscode-errorForeground, #e93262);
  }
  .badge.disabled {
    background: rgba(136, 136, 136, 0.15);
    color: var(--vscode-disabledForeground, #777777);
  }
  .badge.live {
    background: rgba(56, 139, 56, 0.2);
    color: var(--vscode-charts-green, #3c963c);
  }
  .badge.live .chip-mark,
  .badge.local .chip-mark,
  .badge.combined .chip-mark {
    background: currentColor;
  }
  .badge.cached {
    background: rgba(136, 136, 136, 0.2);
    color: var(--vscode-descriptionForeground, #a0a0a0);
  }
  .badge.stale {
    background: rgba(233, 185, 50, 0.2);
    color: var(--vscode-charts-yellow, #d4a017);
  }
  .badge.pending {
    background: rgba(127, 127, 127, 0.14);
    color: var(--vscode-descriptionForeground, #999999);
    border-color: var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .badge.snapshot,
  .badge.aggregate-only,
  .badge.combined,
  .badge.local {
    background: rgba(80, 150, 180, 0.14);
    color: var(--vscode-foreground, #cccccc);
    border-color: rgba(80, 150, 180, 0.35);
  }
  .badge.aggregate-only {
    background: rgba(180, 120, 80, 0.14);
    border-color: rgba(180, 120, 80, 0.35);
  }
  .badge.unavailable .chip-mark,
  .badge.disabled .chip-mark {
    position: relative;
  }
  .badge.unavailable .chip-mark::after,
  .badge.disabled .chip-mark::after {
    content: '';
    position: absolute;
    left: 1px;
    right: 1px;
    top: 3px;
    border-top: 1px solid currentColor;
    transform: rotate(-35deg);
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .visual-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .provider-visual-grid {
    grid-template-columns: 1fr;
  }
  .distribution-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 15px 16px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
  }
  .distribution-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    min-width: 0;
  }
  .distribution-card-title {
    font-size: 14px;
    font-weight: 600;
  }
  .distribution-card-copy {
    margin-top: 3px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
    line-height: 1.35;
  }
  .distribution-total {
    text-align: right;
    white-space: nowrap;
    min-width: 0;
  }
  .distribution-total-value {
    display: block;
    font-size: 14px;
    font-weight: 600;
  }
  .distribution-total-messages {
    display: block;
    margin-top: 2px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
  }
  .distribution-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .distribution-row-header,
  .distribution-row-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }
  .distribution-label,
  .distribution-value {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .distribution-percent,
  .distribution-messages {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    white-space: nowrap;
  }
  .distribution-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(127,127,127,0.18);
    overflow: hidden;
    margin: 6px 0 5px;
  }
  .distribution-fill {
    height: 100%;
    border-radius: 4px;
    background: var(--vscode-focusBorder, #007acc);
    transition: width 0.25s;
  }
  .provider-claude .distribution-fill {
    background: var(--pf-provider-claude);
  }
  .provider-codex .distribution-fill {
    background-color: var(--pf-provider-codex);
    background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.34) 0, rgba(255,255,255,0.34) 2px, rgba(0,0,0,0.16) 2px, rgba(0,0,0,0.16) 4px);
  }
  .source-local .distribution-fill {
    background: var(--vscode-charts-green, #3c963c);
  }
  .source-snapshots .distribution-fill {
    background: var(--vscode-charts-blue, #5096b4);
  }
  .distribution-empty {
    display: none;
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 15px 14px;
    font-size: 12px;
  }
  .distribution-card.is-empty .distribution-empty {
    display: block;
  }
  .distribution-card.is-empty .distribution-list {
    display: none;
  }
  .usage-history-chart {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 6px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.04));
    padding: 12px 14px;
    margin-bottom: 16px;
  }
  .usage-history-chart-head,
  .usage-model-distribution-head {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
  }
  .usage-history-chart-title,
  .usage-model-distribution-title {
    font-weight: 650;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    line-height: 1.35;
  }
  .usage-history-chart-meta,
  .usage-model-distribution-meta,
  .usage-history-chart-copy,
  .usage-model-placeholder-note {
    margin-top: 3px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
    line-height: 1.4;
  }
  .usage-history-bars {
    display: grid;
    grid-template-columns: repeat(var(--history-bin-count, 4), minmax(0, 1fr));
    align-items: end;
    gap: 6px;
    min-height: 150px;
    padding: 10px 0 4px;
    border-top: 1px solid var(--pf-keyline);
    overflow: hidden;
  }
  .usage-history-bin {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    height: 100%;
  }
  .usage-history-bar {
    min-width: 0;
    display: flex;
    align-items: flex-end;
    height: 120px;
    border-radius: 3px 3px 0 0;
    background: rgba(127,127,127,0.11);
    overflow: hidden;
    border: 1px solid transparent;
  }
  .usage-history-bin.active .usage-history-bar {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 0 0 1px rgba(0, 122, 204, 0.15);
  }
  .usage-history-bar-fill {
    width: 100%;
    min-height: 2px;
    background: rgba(127,127,127,0.22);
    border-radius: 3px 3px 0 0;
    display: flex;
    flex-direction: column-reverse;
    overflow: hidden;
    transition: height 0.25s;
  }
  .usage-history-bar-segment {
    width: 100%;
    min-height: 1px;
  }
  .usage-history-bar.empty {
    background: rgba(127,127,127,0.07);
  }
  .usage-history-bar.empty .usage-history-bar-fill {
    min-height: 1px;
    background: var(--vscode-descriptionForeground, #999999);
    opacity: 0.22;
  }
  .usage-history-bin-label,
  .usage-history-bin-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .usage-history-bin-label {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 10px;
  }
  .usage-history-bin-value {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
  }
  .usage-history-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
    margin-top: 8px;
  }
  .usage-history-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .usage-history-legend-swatch {
    width: 12px;
    height: 8px;
    border-radius: 2px;
    border: 1px solid var(--pf-keyline);
    flex: 0 0 auto;
  }
  .usage-history-empty,
  .usage-model-empty {
    display: none;
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 6px;
    padding: 15px 14px;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .usage-history-chart.is-empty .usage-history-empty,
  .usage-model-distribution.is-empty .usage-model-empty {
    display: block;
  }
  .usage-model-distribution.is-empty .usage-model-distribution-body {
    display: none;
  }
  .usage-model-distribution {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 6px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.04));
    padding: 12px 14px;
    margin-bottom: 16px;
  }
  .usage-model-distribution-body {
    display: flex;
    gap: 16px;
    align-items: center;
    border-top: 1px solid var(--pf-keyline);
    padding-top: 12px;
  }
  .usage-model-donut {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    position: relative;
    flex: 0 0 auto;
    background: rgba(127,127,127,0.18);
  }
  .usage-model-donut-core {
    position: absolute;
    inset: 28px;
    border-radius: 50%;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    border: 1px solid var(--pf-keyline);
  }
  .usage-model-donut-total {
    font-weight: 700;
    font-size: 12px;
  }
  .usage-model-donut-label {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 9px;
    text-transform: uppercase;
  }
  .usage-model-legend {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .usage-model-row {
    display: grid;
    grid-template-columns: 10px 52px minmax(60px, 1fr) 64px 84px 36px;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    border-radius: 4px;
    min-width: 0;
  }
  .usage-model-row[hidden] {
    display: none;
  }
  .usage-model-swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid rgba(127,127,127,0.2);
    background: var(--model-color, var(--vscode-focusBorder, #007acc));
    flex: 0 0 auto;
  }
  .usage-model-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .usage-model-provider {
    color: var(--vscode-descriptionForeground, #999999);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .usage-model-value,
  .usage-model-count,
  .usage-model-percent {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: nowrap;
  }
  .usage-model-count,
  .usage-model-percent {
    color: var(--vscode-descriptionForeground, #999999);
  }
  .usage-model-empty-inline {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
  }
  .live-quota-section {
    margin-top: 8px;
    margin-bottom: 22px;
  }
  .live-quota-not-enabled {
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 18px 16px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    text-align: center;
  }
  .live-quota-unavailable {
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 18px 16px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
  }
  .live-quota-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 8px;
    padding: 15px 16px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.06));
  }
  .live-quota-card.quota-low {
    border-color: var(--vscode-errorForeground, rgba(233, 50, 98, 0.55));
    box-shadow: inset 0 0 0 1px rgba(233, 50, 98, 0.12);
  }
  .live-quota-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .live-quota-label {
    font-weight: 600;
    font-size: 14px;
  }
  .live-quota-windows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .live-quota-window {
    display: grid;
    grid-template-columns: 36px minmax(80px, 1fr) minmax(112px, auto);
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid rgba(127,127,127,0.1);
  }
  .live-quota-window:first-child {
    border-top: none;
    padding-top: 0;
  }
  .live-quota-window-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .live-quota-window-bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(127,127,127,0.18);
    overflow: hidden;
  }
  .live-quota-window-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s;
  }
  .live-quota-window-fill.green {
    background: var(--vscode-charts-green, #3c963c);
  }
  .live-quota-window-fill.yellow {
    background: var(--vscode-charts-yellow, #d4a017);
  }
  .live-quota-window-fill.orange {
    background: var(--vscode-charts-orange, #d18616);
  }
  .live-quota-window-fill.red {
    background: var(--vscode-errorForeground, #e93262);
  }
  .live-quota-window-value {
    display: block;
    font-size: 16px;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
  }
  .live-quota-window.is-low .live-quota-window-value {
    color: var(--vscode-errorForeground, #e93262);
  }
  .live-quota-window-countdown {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    text-align: right;
    white-space: nowrap;
  }
  .live-quota-footer {
    margin-top: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .live-quota-note {
    margin-top: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .calm-state {
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.05));
  }
  .calm-state-header {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    color: var(--vscode-foreground, #cccccc);
    font-weight: 600;
    margin-bottom: 5px;
  }
  .calm-state-copy {
    color: var(--vscode-descriptionForeground, #999999);
    line-height: 1.45;
    text-align: center;
  }
  .provider-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .metric-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .metric-value {
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .metric-value.small {
    font-size: 12px;
    font-weight: 500;
  }
  .metric-value.errors {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    font-weight: 500;
  }
  .snapshot-note,
  .source-window-note {
    margin: -2px 0 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .usage-section-title {
    margin: 14px 0 10px;
    font-size: 15px;
    font-weight: 700;
    color: var(--vscode-foreground, #cccccc);
  }
  .today-card-grid,
  .history-summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 12px;
  }
  .today-card,
  .history-summary-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 6px;
    background: var(--vscode-sideBar-background, rgba(127,127,127,0.05));
    padding: 12px;
    min-width: 0;
  }
  .today-card-value,
  .history-summary-card strong {
    display: block;
    margin-top: 6px;
    color: var(--vscode-foreground, #cccccc);
    font-size: 20px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .today-card-copy,
  .history-summary-card span {
    display: block;
    margin-top: 4px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 11px;
    line-height: 1.35;
  }
  .history-range-selector {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin: 10px 0 8px;
  }
  .history-range-btn {
    background: transparent;
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 999px;
    padding: 3px 9px;
    cursor: pointer;
    font-size: 11px;
  }
  .history-range-btn.active {
    border-color: var(--vscode-focusBorder, #007acc);
    background: rgba(0, 122, 204, 0.16);
  }
  .history-summary-grid {
    margin-top: 12px;
  }
  .history-summary-card strong {
    font-size: 16px;
  }
  .snapshot-provider-list {
    margin-top: 12px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .snapshot-provider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.18));
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
  }
  .snapshot-provider-row strong {
    color: var(--vscode-foreground, #cccccc);
  }
  .source-window-note[hidden] {
    display: none;
  }
  .footer {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .refresh-btn {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 12px;
  }
  .refresh-btn:hover {
    background: var(--vscode-button-hoverBackground, #1a85c5);
  }
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .parse-error-note {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    margin: -4px 0 10px;
    padding: 6px 10px;
    background: rgba(233, 185, 50, 0.08);
    border: 1px solid rgba(233, 185, 50, 0.25);
    border-radius: 4px;
  }
  .pf-tip {
    position: fixed;
    z-index: 50;
    width: min(260px, calc(100vw - 16px));
    background: var(--vscode-editorHoverWidget-background, var(--vscode-sideBar-background, #252526));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border, rgba(128,128,128,0.4)));
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.28);
    color: var(--vscode-foreground, #cccccc);
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
  }
  .pf-tip.hidden {
    display: none;
  }
  .pf-tip-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid var(--pf-keyline);
    padding-bottom: 6px;
    margin-bottom: 7px;
  }
  .pf-tip-title {
    min-width: 0;
    font-weight: 650;
    color: var(--vscode-foreground, #cccccc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pf-tip-source {
    flex: 0 1 auto;
    color: var(--vscode-descriptionForeground, #999999);
    text-align: right;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pf-tip-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 7px;
  }
  .pf-tip-stat {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .pf-tip-stat span {
    color: var(--vscode-descriptionForeground, #999999);
  }
  .pf-tip-stat strong {
    color: var(--vscode-foreground, #cccccc);
    font-size: 12px;
  }
  .pf-tip-list {
    display: grid;
    gap: 4px;
    margin-top: 6px;
  }
  .pf-tip-list-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .pf-tip-model-row,
  .pf-tip-provider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .pf-tip-model-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
  }
  .pf-tip-model-label span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pf-tip-model-row > span:last-child,
  .pf-tip-provider-row > span:last-child {
    flex: 0 0 auto;
    color: var(--vscode-descriptionForeground, #999999);
  }
  .pf-tip-swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    border: 1px solid var(--pf-keyline);
    flex: 0 0 auto;
  }
  .pf-tip-provider-row.claude span:first-child::before,
  .pf-tip-provider-row.codex span:first-child::before {
    content: "";
    display: inline-block;
    width: 12px;
    height: 8px;
    border-radius: 2px;
    margin-right: 5px;
    vertical-align: middle;
    background: var(--vscode-charts-blue, var(--vscode-focusBorder));
  }
  .pf-tip-provider-row.codex span:first-child::before {
    background-color: var(--vscode-charts-purple, #b180d7);
    background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.38) 0, rgba(255,255,255,.38) 2px, rgba(0,0,0,.18) 2px, rgba(0,0,0,.18) 4px);
  }
  .pf-tip-empty {
    color: var(--vscode-descriptionForeground, #999999);
  }
  @container (max-width: 720px) {
    .page-header,
    .section-header,
    .footer {
      flex-direction: column;
      align-items: stretch;
    }
    .header-chip-row,
    .chip-row {
      justify-content: flex-start;
    }
    .control-panel,
    .card-grid,
    .visual-grid {
      grid-template-columns: 1fr;
    }
    .overview-row {
      flex-direction: column;
      gap: 2px;
    }
    .distribution-card-header,
    .distribution-row-meta,
    .usage-history-chart-head,
    .usage-model-distribution-head,
    .usage-model-distribution-body {
      flex-direction: column;
      gap: 2px;
    }
    .usage-model-row {
      grid-template-columns: 10px 44px minmax(0, 1fr) auto auto;
    }
    .usage-model-count,
    .usage-model-percent {
      grid-column: 3 / -1;
    }
    .distribution-total {
      text-align: left;
    }
    .live-quota-window {
      grid-template-columns: 32px minmax(70px, 1fr);
    }
    .live-quota-window-copy {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .live-quota-window-value,
    .live-quota-window-countdown {
      text-align: left;
    }
    .provider-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
</head>
<body>
<div class="dashboard">
  <div class="page-header">
    <div>
      <div class="title">PromptFuel</div>
      <div class="subtitle">Live quota first, usage history second</div>
    </div>
    <div class="header-chip-row">
      ${model.liveQuotaEnabled ? stateChip('LIVE', 'live') : stateChip('DISABLED', 'disabled')}
      ${sourceModeChip(model.defaultSourceMode)}
    </div>
  </div>
  <div class="disclaimer">Live quota is shown first when provider APIs are available. Totals can use local history, imported snapshots, or both. ${esc(renderSourceModeCopy(model))}</div>

  <div class="tabs" role="tablist" aria-label="Dashboard provider views">
    <button type="button" class="tab-btn active" id="tab-button-overview" data-dashboard-tab="overview" role="tab" aria-controls="tab-overview" aria-selected="true">Overview</button>
    <button type="button" class="tab-btn" id="tab-button-claude" data-dashboard-tab="claude" role="tab" aria-controls="tab-claude" aria-selected="false">Claude</button>
    <button type="button" class="tab-btn" id="tab-button-codex" data-dashboard-tab="codex" role="tab" aria-controls="tab-codex" aria-selected="false">Codex</button>
  </div>

  <section class="tab-panel" id="tab-overview" data-dashboard-tab-panel="overview" role="tabpanel" aria-labelledby="tab-button-overview">
    <div class="usage-section-title">Usage</div>
    ${renderLiveQuotaSection(model)}

    ${sectionHeader('Today', sourceModeChip(model.defaultSourceMode), 'Selected source and provider-aware usage for the local day.')}
    ${renderTodaySection(model)}

    ${sectionHeader('History', sourceModeChip(model.defaultSourceMode), 'Range-controlled token trend from daily bins where available.')}
    ${renderUsageHistoryChart(model, model.defaultLocalHistoryWindowId)}

    ${sectionHeader('Model breakdown', sourceModeChip(model.defaultSourceMode), 'Safe aggregate model totals follow the selected history source and range.')}
    ${renderModelBreakdownDistribution(model, model.defaultLocalHistoryWindowId)}
  </section>

  ${renderProviderTab(model, 'claude')}
  ${renderProviderTab(model, 'codex')}

  <div class="footer">
    <div>
      <div>${esc(liveQuotaRefreshSummary(model))}</div>
      <div>Local history refreshed: ${esc(formatRefreshTime(model.localHistoryLastRefreshedMs))}</div>
      ${renderFooterSnapshotSummary(model)}
    </div>
    <button type="button" class="refresh-btn" id="refreshBtn">Refresh</button>
  </div>
</div>
<script nonce="${nonce}">
  (function() {
    var acquired = acquireVsCodeApi();
    var btn = document.getElementById('refreshBtn');
    var tabButtons = Array.prototype.slice.call(document.querySelectorAll('[data-dashboard-tab]'));
    var tabPanels = Array.prototype.slice.call(document.querySelectorAll('[data-dashboard-tab-panel]'));
    var historyRangeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-history-range]'));
    var activeSourceMode = '${model.defaultSourceMode}';
    var activeHistoryRange = '${DEFAULT_HISTORY_RANGE_KEY}';
    function statusClass(statusClassName) {
      return statusClassName ? 'badge source-provider-status ' + statusClassName : 'badge source-provider-status';
    }
    function updateSourceModeLabels() {
      Array.prototype.forEach.call(document.querySelectorAll('.source-mode-label-value'), function(el) {
        var label = el.getAttribute('data-source-label-' + activeSourceMode);
        if (label !== null) {
          el.textContent = label;
        }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.source-provider-status'), function(el) {
        var label = el.getAttribute('data-status-label-' + activeSourceMode);
        var className = el.getAttribute('data-status-class-' + activeSourceMode);
        if (label !== null) {
          el.textContent = label;
        }
        el.className = statusClass(className);
      });
    }
    function updateDistributionVisuals() {
      var key = activeSourceMode + '-' + activeHistoryRange;
      Array.prototype.forEach.call(document.querySelectorAll('[data-distribution-card]'), function(card) {
        var isEmpty = card.getAttribute('data-empty-' + key) === 'true';
        var totalLabel = card.getAttribute('data-total-label-' + key);
        var totalMessages = card.getAttribute('data-total-messages-' + key);
        card.classList.toggle('is-empty', isEmpty);
        var totalValueEl = card.querySelector('.distribution-total-value');
        var totalMessagesEl = card.querySelector('.distribution-total-messages');
        if (totalValueEl && totalLabel !== null) {
          totalValueEl.textContent = totalLabel;
        }
        if (totalMessagesEl && totalMessages !== null) {
          totalMessagesEl.textContent = totalMessages;
        }
        Array.prototype.forEach.call(card.querySelectorAll('.distribution-row'), function(row) {
          var value = row.getAttribute('data-value-' + key) || '0 tokens';
          var messages = row.getAttribute('data-messages-' + key) || '0 messages';
          var percent = row.getAttribute('data-percent-' + key) || '0%';
          var width = row.getAttribute('data-width-' + key) || '0';
          var valueEl = row.querySelector('.distribution-value');
          var messagesEl = row.querySelector('.distribution-messages');
          var percentEl = row.querySelector('.distribution-percent');
          var fillEl = row.querySelector('.distribution-fill');
          if (valueEl) {
            valueEl.textContent = value;
          }
          if (messagesEl) {
            messagesEl.textContent = messages;
          }
          if (percentEl) {
            percentEl.textContent = percent;
          }
          if (fillEl) {
            fillEl.style.width = width + '%';
          }
        });
      });
    }
    function updateUsageHistoryCharts() {
      var key = activeSourceMode + '-' + activeHistoryRange;
      Array.prototype.forEach.call(document.querySelectorAll('[data-history-chart]'), function(chart) {
        var totalLabel = chart.getAttribute('data-history-total-label-' + key);
        var totalMessages = chart.getAttribute('data-history-selected-messages-' + key);
        var rangeMeta = chart.getAttribute('data-history-range-meta-' + key);
        var totalEl = chart.querySelector('.usage-history-total-value');
        var selectedMessagesEl = chart.querySelector('.usage-history-selected-messages');
        var rangeMetaEl = chart.querySelector('.usage-history-range-meta');
        var selectedEmpty = chart.getAttribute('data-history-empty-' + key) === 'true';
        if (totalEl && totalLabel !== null) {
          totalEl.textContent = totalLabel;
        }
        if (selectedMessagesEl && totalMessages !== null) {
          selectedMessagesEl.textContent = totalMessages;
        }
        if (rangeMetaEl && rangeMeta !== null) {
          rangeMetaEl.textContent = rangeMeta;
        }
        Array.prototype.forEach.call(chart.querySelectorAll('[data-history-range-group]'), function(group) {
          if (group.getAttribute('data-history-range-group') === key) {
            group.removeAttribute('hidden');
          } else {
            group.setAttribute('hidden', '');
          }
        });
        chart.classList.toggle('is-empty', selectedEmpty);
      });
    }
    function updateTodaySections() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-today-source-group]'), function(group) {
        if (group.getAttribute('data-today-source-group') === activeSourceMode) {
          group.removeAttribute('hidden');
        } else {
          group.setAttribute('hidden', '');
        }
      });
    }
    function updateModelDistributionVisuals() {
      var key = activeSourceMode + '-' + activeHistoryRange;
      Array.prototype.forEach.call(document.querySelectorAll('[data-model-breakdown]'), function(card) {
        var isEmpty = card.getAttribute('data-model-empty-' + key) === 'true';
        var totalLabel = card.getAttribute('data-model-total-label-' + key);
        var totalMessages = card.getAttribute('data-model-total-messages-' + key);
        var gradient = card.getAttribute('data-model-gradient-' + key);
        var totalEl = card.querySelector('.usage-model-donut-total');
        var totalMessagesEl = card.querySelector('.usage-model-donut-label');
        var donut = card.querySelector('.usage-model-donut');
        card.classList.toggle('is-empty', isEmpty);
        if (totalEl && totalLabel !== null) {
          totalEl.textContent = totalLabel;
        }
        if (totalMessagesEl && totalMessages !== null) {
          totalMessagesEl.textContent = totalMessages;
        }
        if (donut && gradient !== null) {
          donut.style.background = gradient;
        }
        Array.prototype.forEach.call(card.querySelectorAll('[data-model-row]'), function(row) {
          var visible = row.getAttribute('data-model-visible-' + key) === 'true';
          var rank = row.getAttribute('data-model-rank-' + key) || '999';
          var value = row.getAttribute('data-model-value-' + key) || '0 tokens';
          var messages = row.getAttribute('data-model-messages-' + key) || '0 messages';
          var providerLabel = row.getAttribute('data-model-provider-label-' + key);
          var title = row.getAttribute('data-model-title-' + key) || messages;
          var percent = row.getAttribute('data-model-percent-' + key) || '0%';
          var width = row.getAttribute('data-model-width-' + key) || '0';
          var providerEl = row.querySelector('.usage-model-provider');
          var valueEl = row.querySelector('.usage-model-value');
          var countEl = row.querySelector('.usage-model-count');
          var percentEl = row.querySelector('.usage-model-percent');
          row.hidden = !visible;
          row.style.order = rank;
          row.setAttribute('title', title);
          if (providerEl && providerLabel !== null) {
            providerEl.textContent = providerLabel;
          }
          if (valueEl) {
            valueEl.textContent = value;
          }
          if (countEl) {
            countEl.textContent = messages;
          }
          if (percentEl) {
            percentEl.textContent = percent;
          }
        });
      });
    }
    function updateHistoryValues() {
      updateSourceModeLabels();
      updateTodaySections();
      updateUsageHistoryCharts();
      updateModelDistributionVisuals();
    }
    var pfTipEl = null;
    var pfTipAnchor = null;
    function getPfTip() {
      if (!pfTipEl) {
        pfTipEl = document.createElement('div');
        pfTipEl.id = 'pf-tip';
        pfTipEl.className = 'pf-tip hidden';
        pfTipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(pfTipEl);
        window.addEventListener('resize', positionPfTip);
        window.addEventListener('scroll', positionPfTip, true);
      }
      return pfTipEl;
    }
    function positionPfTip() {
      if (!pfTipEl || !pfTipAnchor || pfTipEl.classList.contains('hidden')) { return; }
      var ar = pfTipAnchor.getBoundingClientRect();
      var tr = pfTipEl.getBoundingClientRect();
      var vw = document.documentElement.clientWidth || window.innerWidth;
      var vh = document.documentElement.clientHeight || window.innerHeight;
      var gap = 8, margin = 8;
      var left = ar.left + (ar.width - tr.width) / 2;
      var top = ar.top - tr.height - gap;
      if (top < margin) { top = ar.bottom + gap; }
      if (top + tr.height > vh - margin) { top = Math.max(margin, vh - tr.height - margin); }
      if (left < margin) { left = margin; }
      if (left + tr.width > vw - margin) { left = Math.max(margin, vw - tr.width - margin); }
      pfTipEl.style.left = Math.round(left) + 'px';
      pfTipEl.style.top = Math.round(top) + 'px';
    }
    function buildPfTipStat(parent, labelText, valueText) {
      var row = document.createElement('div');
      row.className = 'pf-tip-stat';
      var lbl = document.createElement('span'); lbl.textContent = labelText;
      var val = document.createElement('strong'); val.textContent = valueText;
      row.appendChild(lbl); row.appendChild(val);
      parent.appendChild(row);
    }
    function buildPfTipListTitle(parent, text) {
      var t = document.createElement('div');
      t.className = 'pf-tip-list-title';
      t.textContent = text;
      parent.appendChild(t);
    }
    function showHistoryBarTip(anchor, payload) {
      pfTipAnchor = anchor;
      var tip = getPfTip();
      tip.innerHTML = '';
      var head = document.createElement('div'); head.className = 'pf-tip-head';
      var title = document.createElement('div'); title.className = 'pf-tip-title'; title.textContent = payload.title || '';
      var src = document.createElement('div'); src.className = 'pf-tip-source'; src.textContent = payload.source || 'Usage history';
      head.appendChild(title); head.appendChild(src); tip.appendChild(head);
      var stats = document.createElement('div'); stats.className = 'pf-tip-stats';
      buildPfTipStat(stats, 'Tokens', payload.tokens || '0 tokens');
      buildPfTipStat(stats, 'Activity', payload.messages || '0 messages');
      if (payload.cache) { buildPfTipStat(stats, 'Cache', payload.cache); }
      tip.appendChild(stats);
      if (payload.models && payload.models.length > 0) {
        var list = document.createElement('div'); list.className = 'pf-tip-list';
        buildPfTipListTitle(list, 'Top models');
        payload.models.forEach(function(m) {
          var row = document.createElement('div'); row.className = 'pf-tip-model-row';
          var labelWrap = document.createElement('span'); labelWrap.className = 'pf-tip-model-label';
          var swatch = document.createElement('span'); swatch.className = 'pf-tip-swatch';
          swatch.style.background = 'var(--pf-model-' + (m.color || 0) + ')';
          var lbl = document.createElement('span'); lbl.textContent = m.label || '';
          labelWrap.appendChild(swatch); labelWrap.appendChild(lbl);
          var val = document.createElement('span'); val.textContent = m.tokens || '';
          row.appendChild(labelWrap); row.appendChild(val); list.appendChild(row);
        });
        tip.appendChild(list);
      }
      anchor.setAttribute('aria-describedby', 'pf-tip');
      tip.className = 'pf-tip';
      positionPfTip();
    }
    function showModelRowTip(anchor, payload) {
      pfTipAnchor = anchor;
      var tip = getPfTip();
      tip.innerHTML = '';
      var key = activeSourceMode + '-' + activeHistoryRange;
      var tokens = anchor.getAttribute('data-model-value-' + key) || '0 tokens';
      var percent = anchor.getAttribute('data-model-percent-' + key) || '0%';
      var messages = anchor.getAttribute('data-model-messages-' + key) || '0 messages';
      var providerLabel = anchor.getAttribute('data-model-provider-label-' + key) || payload.provider || '';
      var head = document.createElement('div'); head.className = 'pf-tip-head';
      var title = document.createElement('div'); title.className = 'pf-tip-title'; title.textContent = payload.label || 'Model';
      var src = document.createElement('div'); src.className = 'pf-tip-source'; src.textContent = providerLabel || 'Model breakdown';
      head.appendChild(title); head.appendChild(src); tip.appendChild(head);
      var stats = document.createElement('div'); stats.className = 'pf-tip-stats';
      buildPfTipStat(stats, 'Tokens', tokens);
      buildPfTipStat(stats, 'Share', percent);
      buildPfTipStat(stats, 'Activity', messages);
      tip.appendChild(stats);
      anchor.setAttribute('aria-describedby', 'pf-tip');
      tip.className = 'pf-tip';
      positionPfTip();
    }
    function hidePfTip(anchor) {
      if (pfTipAnchor && anchor && pfTipAnchor !== anchor) { return; }
      pfTipAnchor = null;
      if (pfTipEl) { pfTipEl.className = 'pf-tip hidden'; }
    }
    function parsePfTip(el) {
      var raw = el && el.getAttribute('data-pf-tip');
      if (!raw) { return null; }
      try { return JSON.parse(raw); } catch(e) { return null; }
    }
    document.addEventListener('mouseover', function(e) {
      var el = e.target.closest ? e.target.closest('[data-pf-tip]') : null;
      if (!el) { return; }
      var payload = parsePfTip(el);
      if (!payload) { return; }
      if (payload.kind === 'history') { showHistoryBarTip(el, payload); }
      else if (payload.kind === 'model') { showModelRowTip(el, payload); }
    });
    document.addEventListener('mouseout', function(e) {
      var el = e.target.closest ? e.target.closest('[data-pf-tip]') : null;
      if (el && e.relatedTarget && el.contains(e.relatedTarget)) { return; }
      hidePfTip(el);
    });
    document.addEventListener('focusin', function(e) {
      var el = e.target.closest ? e.target.closest('[data-pf-tip]') : null;
      if (!el) { return; }
      var payload = parsePfTip(el);
      if (!payload) { return; }
      if (payload.kind === 'history') { showHistoryBarTip(el, payload); }
      else if (payload.kind === 'model') { showModelRowTip(el, payload); }
    });
    document.addEventListener('focusout', function(e) {
      var el = e.target.closest ? e.target.closest('[data-pf-tip]') : null;
      hidePfTip(el);
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { hidePfTip(null); }
    });
    function setActiveTab(tabId) {
      if (!tabId) {
        return;
      }
      tabButtons.forEach(function(button) {
        var selected = button.getAttribute('data-dashboard-tab') === tabId;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      tabPanels.forEach(function(panel) {
        var selected = panel.getAttribute('data-dashboard-tab-panel') === tabId;
        if (selected) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      });
    }
    function setHistoryRange(rangeKey) {
      if (!rangeKey) {
        return;
      }
      activeHistoryRange = rangeKey;
      updateHistoryValues();
      historyRangeButtons.forEach(function(button) {
        var selected = button.getAttribute('data-history-range') === rangeKey;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    tabButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setActiveTab(button.getAttribute('data-dashboard-tab'));
      });
    });
    historyRangeButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setHistoryRange(button.getAttribute('data-history-range'));
      });
    });
    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = 'Refreshing...';
      acquired.postMessage({ command: 'refreshDashboard' });
    });
    window.addEventListener('message', function(e) {
      var msg = e.data;
      if (msg.command === 'refreshComplete') {
        btn.disabled = false;
        btn.textContent = 'Refresh';
      }
    });
    updateHistoryValues();
  })();
</script>
</body>
</html>`;
}
