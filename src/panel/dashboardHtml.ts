import * as vscode from 'vscode';
import {
  DashboardLiveQuotaCard,
  DashboardLocalHistoryWindow,
  DashboardModel,
  DashboardProviderCard,
  DashboardSourceModeProviderCard,
  DashboardSourceModeTotals,
} from './dashboardModel';
import { formatTokenCount } from '../core/formatQuota';
import { formatCountdownLabel, getRemainingPercentage, getSanitizedErrorLabel } from '../core/formatLiveQuota';

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
    ${sectionHeader('Live quota', liveQuotaSectionChip(model), 'Provider-reported remaining quota appears before local history.')}
    <div class="live-quota-not-enabled calm-state">
      <div class="calm-state-header">${esc(stateText)} ${badge}</div>
      <div class="calm-state-copy">Live provider quota will appear here when available.</div>
    </div>
  </div>`;
  }

  return `
  <div class="live-quota-section">
    ${sectionHeader('Live quota', liveQuotaSectionChip(model), 'Provider-reported remaining quota appears before local history.')}
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
      windows: [],
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

function historyChartAttributes(
  model: DashboardModel,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => {
    const windows = historyWindowsForSource(sourceTotals, providerId);
    const total = findLocalHistoryWindow(windows, 'all');
    const selectedWindow = findLocalHistoryWindow(windows, model.defaultLocalHistoryWindowId);
    const key = `${sourceTotals.sourceMode}-${model.defaultLocalHistoryWindowId}`;
    return [
      `data-history-source-label-${esc(sourceTotals.sourceMode)}="${esc(sourceTotals.label)}"`,
      `data-history-total-label-${esc(sourceTotals.sourceMode)}="${esc(formatTokenCount(total.totalTokens))}"`,
      `data-history-selected-label-${esc(sourceTotals.sourceMode)}="${esc(formatTokenCount(selectedWindow.totalTokens))}"`,
      `data-history-selected-messages-${esc(sourceTotals.sourceMode)}="${esc(formatMessageCount(selectedWindow.totalAssistantMessages))}"`,
      `data-history-empty-${esc(key)}="${selectedWindow.totalTokens <= 0 && selectedWindow.totalAssistantMessages <= 0 ? 'true' : 'false'}"`,
    ].join(' ');
  }).join(' ');
}

function historyChartBarAttributes(
  model: DashboardModel,
  windowId: string,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => {
    const windows = historyWindowsForSource(sourceTotals, providerId);
    const window = findLocalHistoryWindow(windows, windowId);
    const maxTokens = Math.max(...windows.map(w => w.totalTokens), 0);
    const height = historyWindowBarHeight(window.totalTokens, maxTokens);
    return [
      `data-height-${esc(sourceTotals.sourceMode)}="${esc(height)}"`,
      `data-tokens-${esc(sourceTotals.sourceMode)}="${esc(formatTokenCount(window.totalTokens))}"`,
      `data-messages-${esc(sourceTotals.sourceMode)}="${esc(formatMessageCount(window.totalAssistantMessages))}"`,
      `data-empty-${esc(sourceTotals.sourceMode)}="${window.totalTokens <= 0 && window.totalAssistantMessages <= 0 ? 'true' : 'false'}"`,
    ].join(' ');
  }).join(' ');
}

function renderUsageHistoryChart(
  model: DashboardModel,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
  provider?: DashboardProviderCard,
): string {
  const scope = provider ? provider.providerId : 'overview';
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedWindows = historyWindowsForSource(selectedSource, provider?.providerId);
  const selectedWindow = findLocalHistoryWindow(selectedWindows, defaultWindowId);
  const maxTokens = Math.max(...selectedWindows.map(w => w.totalTokens), 0);
  const chartTitle = provider ? `${provider.label} history chart` : 'History chart';
  const chartCopy = provider
    ? 'Aggregate window trend for this provider. Model-level timeline backend is pending.'
    : 'Aggregate window trend by provider. Model-level timeline backend is pending.';
  const bars = selectedWindows.map(window => {
    const height = historyWindowBarHeight(window.totalTokens, maxTokens);
    const isActive = window.windowId === defaultWindowId;
    const isEmpty = window.totalTokens <= 0 && window.totalAssistantMessages <= 0;
    const providerSegments = provider
      ? renderHistoryProviderSegments(
        [{ providerId: provider.providerId, label: provider.label, totalTokens: window.totalTokens }],
        window.totalTokens,
      )
      : renderHistoryProviderSegments(
        selectedSource.providers.map(sourceProvider => {
          const providerWindow = findLocalHistoryWindow(sourceProvider.windows, window.windowId);
          return {
            providerId: sourceProvider.providerId,
            label: sourceProvider.label,
            totalTokens: providerWindow.totalTokens,
          };
        }),
        window.totalTokens,
      );
    return `
      <div class="usage-history-bin${isActive ? ' active' : ''}">
        <div class="usage-history-bar${isEmpty ? ' empty' : ''}" data-history-window-bar="${esc(window.windowId)}" ${historyChartBarAttributes(model, window.windowId, provider?.providerId)} role="meter" aria-label="${esc(`${window.label} usage history`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(height)}" title="${esc(`${window.label}: ${formatTokenCount(window.totalTokens)} - ${formatMessageCount(window.totalAssistantMessages)}`)}">
          <div class="usage-history-bar-fill stacked" style="height: ${esc(height)}%">
            ${providerSegments}
          </div>
        </div>
        <div class="usage-history-bin-label">${esc(window.label)}</div>
        <div class="usage-history-bin-value">${esc(formatTokenCount(window.totalTokens))}</div>
      </div>`;
  }).join('\n');

  return `
    <div class="usage-history-chart" data-history-chart="${esc(scope)}" ${historyChartAttributes(model, provider?.providerId)}>
      <div class="usage-history-chart-head">
        <div>
          <div class="usage-history-chart-title">${esc(chartTitle)}</div>
          <div class="usage-history-chart-meta"><span class="source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span> - selected window: <span class="usage-history-selected-value">${esc(formatTokenCount(selectedWindow.totalTokens))}</span></div>
        </div>
        <div class="distribution-total">
          <span class="distribution-total-value usage-history-total-value">${esc(formatTokenCount(findLocalHistoryWindow(selectedWindows, 'all').totalTokens))}</span>
          <span class="distribution-total-messages usage-history-selected-messages">${esc(formatMessageCount(selectedWindow.totalAssistantMessages))}</span>
        </div>
      </div>
      <div class="usage-history-empty calm-state">
        <div class="calm-state-header">No history data for this selection</div>
        <div class="calm-state-copy">Try another history window or source mode.</div>
      </div>
      <div class="usage-history-bars" style="--history-bin-count: ${selectedWindows.length}">
        ${bars}
      </div>
      <div class="usage-history-legend" aria-label="Provider color legend">
        <span><span class="usage-history-legend-swatch claude"></span>Claude</span>
        <span><span class="usage-history-legend-swatch codex"></span>Codex</span>
      </div>
      <div class="usage-history-chart-copy">${esc(chartCopy)}</div>
    </div>`;
}

function renderHistoryProviderSegments(
  segments: Array<{ providerId: string; label: string; totalTokens: number }>,
  totalTokens: number,
): string {
  if (totalTokens <= 0) {
    return '';
  }
  return segments
    .filter(segment => segment.totalTokens > 0)
    .map(segment => {
      const height = distributionWidth(segment.totalTokens, totalTokens);
      return `<div class="usage-history-bar-segment ${esc(segment.providerId)}" style="height: ${esc(height)}%" title="${esc(`${segment.label}: ${formatTokenCount(segment.totalTokens)}`)}"></div>`;
    }).join('');
}

function distributionTotalAttributes(
  totals: DashboardSourceModeTotals[],
  providerId?: string,
): string {
  return totals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const selectedWindow = providerId
      ? findLocalHistoryWindow(findSourceProvider(sourceTotals, providerId).windows, window.windowId)
      : window;
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
    const isEmpty = selectedWindow.totalTokens <= 0 && selectedWindow.totalAssistantMessages <= 0;
    return [
      `data-total-label-${esc(key)}="${esc(formatTokenCount(selectedWindow.totalTokens))}"`,
      `data-total-messages-${esc(key)}="${esc(formatMessageCount(selectedWindow.totalAssistantMessages))}"`,
      `data-empty-${esc(key)}="${isEmpty ? 'true' : 'false'}"`,
    ].join(' ');
  })).join(' ');
}

function providerDistributionRowAttributes(
  totals: DashboardSourceModeTotals[],
  providerId: string,
): string {
  return totals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const totalWindow = window;
    const providerWindow = findLocalHistoryWindow(findSourceProvider(sourceTotals, providerId).windows, window.windowId);
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
    const percent = formatDistributionPercent(providerWindow.totalTokens, totalWindow.totalTokens);
    return [
      `data-value-${esc(key)}="${esc(formatTokenCount(providerWindow.totalTokens))}"`,
      `data-messages-${esc(key)}="${esc(formatMessageCount(providerWindow.totalAssistantMessages))}"`,
      `data-percent-${esc(key)}="${esc(percent)}"`,
      `data-width-${esc(key)}="${esc(distributionWidth(providerWindow.totalTokens, totalWindow.totalTokens))}"`,
    ].join(' ');
  })).join(' ');
}

function renderProviderDistributionVisual(
  model: DashboardModel,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
): string {
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedWindow = findLocalHistoryWindow(selectedSource.windows, defaultWindowId);
  const rows = selectedSource.providers.map(provider => {
    const providerWindow = findLocalHistoryWindow(provider.windows, defaultWindowId);
    const percent = formatDistributionPercent(providerWindow.totalTokens, selectedWindow.totalTokens);
    const width = distributionWidth(providerWindow.totalTokens, selectedWindow.totalTokens);
    return `
      <div class="distribution-row provider-${esc(provider.providerId)}" data-provider-distribution-row="${esc(provider.providerId)}" ${providerDistributionRowAttributes(model.sourceModeTotals, provider.providerId)}>
        <div class="distribution-row-header">
          <span class="distribution-label">${esc(provider.label)}</span>
          <span class="distribution-percent">${esc(percent)}</span>
        </div>
        <div class="distribution-bar" role="meter" aria-label="${esc(`${provider.label} token share`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(width)}">
          <div class="distribution-fill" style="width: ${esc(width)}%"></div>
        </div>
        <div class="distribution-row-meta">
          <span class="distribution-value">${esc(formatTokenCount(providerWindow.totalTokens))}</span>
          <span class="distribution-messages">${esc(formatMessageCount(providerWindow.totalAssistantMessages))}</span>
        </div>
      </div>`;
  }).join('\n');

  return `
    <div class="distribution-card" data-distribution-card="provider-overview" ${distributionTotalAttributes(model.sourceModeTotals)}>
      <div class="distribution-card-header">
        <div>
          <div class="distribution-card-title">Provider distribution</div>
          <div class="distribution-card-copy"><span class="source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span> - selected history window</div>
        </div>
        <div class="distribution-total">
          <span class="distribution-total-value">${esc(formatTokenCount(selectedWindow.totalTokens))}</span>
          <span class="distribution-total-messages">${esc(formatMessageCount(selectedWindow.totalAssistantMessages))}</span>
        </div>
      </div>
      <div class="distribution-empty calm-state">
        <div class="calm-state-header">No provider data for this selection</div>
        <div class="calm-state-copy">Try another history window or source mode.</div>
      </div>
      <div class="distribution-list">
        ${rows}
      </div>
    </div>`;
}

function sourceContributionValue(
  model: DashboardModel,
  sourceMode: string,
  windowId: DashboardLocalHistoryWindow['windowId'],
  sourceKind: 'local' | 'snapshots',
  providerId?: string,
): DashboardLocalHistoryWindow {
  if (sourceMode === 'local' && sourceKind === 'snapshots') {
    return { windowId, label: 'Imported snapshots', totalTokens: 0, totalAssistantMessages: 0 };
  }
  if (sourceMode === 'snapshots' && sourceKind === 'local') {
    return { windowId, label: 'Local history', totalTokens: 0, totalAssistantMessages: 0 };
  }

  const totals = findSourceModeTotals(model.sourceModeTotals, sourceKind);
  if (providerId) {
    return findLocalHistoryWindow(findSourceProvider(totals, providerId).windows, windowId);
  }
  return findLocalHistoryWindow(totals.windows, windowId);
}

function sourceContributionTotal(
  model: DashboardModel,
  sourceMode: string,
  windowId: DashboardLocalHistoryWindow['windowId'],
  providerId?: string,
): DashboardLocalHistoryWindow {
  const local = sourceContributionValue(model, sourceMode, windowId, 'local', providerId);
  const snapshots = sourceContributionValue(model, sourceMode, windowId, 'snapshots', providerId);
  return {
    windowId,
    label: 'Selected source',
    totalTokens: local.totalTokens + snapshots.totalTokens,
    totalAssistantMessages: local.totalAssistantMessages + snapshots.totalAssistantMessages,
  };
}

function sourceContributionTotalAttributes(
  model: DashboardModel,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const total = sourceContributionTotal(model, sourceTotals.sourceMode, window.windowId, providerId);
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
    const isEmpty = total.totalTokens <= 0 && total.totalAssistantMessages <= 0;
    return [
      `data-total-label-${esc(key)}="${esc(formatTokenCount(total.totalTokens))}"`,
      `data-total-messages-${esc(key)}="${esc(formatMessageCount(total.totalAssistantMessages))}"`,
      `data-empty-${esc(key)}="${isEmpty ? 'true' : 'false'}"`,
    ].join(' ');
  })).join(' ');
}

function sourceContributionRowAttributes(
  model: DashboardModel,
  sourceKind: 'local' | 'snapshots',
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const value = sourceContributionValue(model, sourceTotals.sourceMode, window.windowId, sourceKind, providerId);
    const total = sourceContributionTotal(model, sourceTotals.sourceMode, window.windowId, providerId);
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
    const percent = formatDistributionPercent(value.totalTokens, total.totalTokens);
    return [
      `data-value-${esc(key)}="${esc(formatTokenCount(value.totalTokens))}"`,
      `data-messages-${esc(key)}="${esc(formatMessageCount(value.totalAssistantMessages))}"`,
      `data-percent-${esc(key)}="${esc(percent)}"`,
      `data-width-${esc(key)}="${esc(distributionWidth(value.totalTokens, total.totalTokens))}"`,
    ].join(' ');
  })).join(' ');
}

function renderSourceContributionVisual(
  model: DashboardModel,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
  provider?: DashboardProviderCard,
): string {
  const scope = provider ? provider.providerId : 'overview';
  const total = sourceContributionTotal(model, model.defaultSourceMode, defaultWindowId, provider?.providerId);
  const rows: Array<{ kind: 'local' | 'snapshots'; label: string }> = [
    { kind: 'local', label: 'Local history' },
    { kind: 'snapshots', label: 'Imported snapshots' },
  ];
  const renderedRows = rows.map(row => {
    const value = sourceContributionValue(model, model.defaultSourceMode, defaultWindowId, row.kind, provider?.providerId);
    const percent = formatDistributionPercent(value.totalTokens, total.totalTokens);
    const width = distributionWidth(value.totalTokens, total.totalTokens);
    return `
      <div class="distribution-row source-${esc(row.kind)}" data-source-contribution-row="${esc(row.kind)}" ${sourceContributionRowAttributes(model, row.kind, provider?.providerId)}>
        <div class="distribution-row-header">
          <span class="distribution-label">${esc(row.label)}</span>
          <span class="distribution-percent">${esc(percent)}</span>
        </div>
        <div class="distribution-bar" role="meter" aria-label="${esc(`${row.label} token share`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(width)}">
          <div class="distribution-fill" style="width: ${esc(width)}%"></div>
        </div>
        <div class="distribution-row-meta">
          <span class="distribution-value">${esc(formatTokenCount(value.totalTokens))}</span>
          <span class="distribution-messages">${esc(formatMessageCount(value.totalAssistantMessages))}</span>
        </div>
      </div>`;
  }).join('\n');

  return `
    <div class="distribution-card" data-distribution-card="source-${esc(scope)}" data-source-contribution="${esc(scope)}" ${sourceContributionTotalAttributes(model, provider?.providerId)}>
      <div class="distribution-card-header">
        <div>
          <div class="distribution-card-title">${provider ? `${esc(provider.label)} source contribution` : 'Source contribution'}</div>
          <div class="distribution-card-copy">Local and snapshot aggregate contributions for the selected window.</div>
        </div>
        <div class="distribution-total">
          <span class="distribution-total-value">${esc(formatTokenCount(total.totalTokens))}</span>
          <span class="distribution-total-messages">${esc(formatMessageCount(total.totalAssistantMessages))}</span>
        </div>
      </div>
      <div class="distribution-empty calm-state">
        <div class="calm-state-header">No source data for this selection</div>
        <div class="calm-state-copy">The selected source and window do not have aggregate usage.</div>
      </div>
      <div class="distribution-list">
        ${renderedRows}
      </div>
    </div>`;
}

function modelDistributionRowsForSource(
  sourceTotals: DashboardSourceModeTotals,
  providerId?: string,
): DashboardSourceModeProviderCard[] {
  return providerId
    ? [findSourceProvider(sourceTotals, providerId)]
    : sourceTotals.providers;
}

function modelDistributionTotalWindow(
  sourceTotals: DashboardSourceModeTotals,
  windowId: string,
  providerId?: string,
): DashboardLocalHistoryWindow {
  return providerId
    ? findLocalHistoryWindow(findSourceProvider(sourceTotals, providerId).windows, windowId)
    : findLocalHistoryWindow(sourceTotals.windows, windowId);
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
  rows: Array<{ providerId: string; totalTokens: number }>,
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
      return `${providerColorVar(row.providerId)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });

  if (parts.length === 0) {
    return 'conic-gradient(rgba(127,127,127,0.18) 0% 100%)';
  }

  if (cursor < 100) {
    parts.push(`rgba(127,127,127,0.18) ${cursor.toFixed(2)}% 100%`);
  }

  return `conic-gradient(${parts.join(', ')})`;
}

function modelDistributionCardAttributes(
  model: DashboardModel,
  providerId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const rows = modelDistributionRowsForSource(sourceTotals, providerId).map(row => {
      const providerWindow = findLocalHistoryWindow(row.windows, window.windowId);
      return {
        providerId: row.providerId,
        totalTokens: providerWindow.totalTokens,
      };
    });
    const total = modelDistributionTotalWindow(sourceTotals, window.windowId, providerId);
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
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
  rowProviderId: string,
  scopeProviderId?: string,
): string {
  return model.sourceModeTotals.flatMap(sourceTotals => sourceTotals.windows.map(window => {
    const provider = findSourceProvider(sourceTotals, rowProviderId);
    const providerWindow = findLocalHistoryWindow(provider.windows, window.windowId);
    const total = modelDistributionTotalWindow(sourceTotals, window.windowId, scopeProviderId);
    const key = `${sourceTotals.sourceMode}-${window.windowId}`;
    return [
      `data-model-value-${esc(key)}="${esc(formatTokenCount(providerWindow.totalTokens))}"`,
      `data-model-messages-${esc(key)}="${esc(formatMessageCount(providerWindow.totalAssistantMessages))}"`,
      `data-model-percent-${esc(key)}="${esc(formatDistributionPercent(providerWindow.totalTokens, total.totalTokens))}"`,
    ].join(' ');
  })).join(' ');
}

function renderModelPlaceholderDistribution(
  model: DashboardModel,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
  provider?: DashboardProviderCard,
): string {
  const scope = provider ? provider.providerId : 'overview';
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const rows = modelDistributionRowsForSource(selectedSource, provider?.providerId);
  const selectedTotal = modelDistributionTotalWindow(selectedSource, defaultWindowId, provider?.providerId);
  const donutRows = rows.map(row => {
    const window = findLocalHistoryWindow(row.windows, defaultWindowId);
    return {
      providerId: row.providerId,
      totalTokens: window.totalTokens,
    };
  });
  const rowHtml = rows.map(row => {
    const window = findLocalHistoryWindow(row.windows, defaultWindowId);
    const percent = formatDistributionPercent(window.totalTokens, selectedTotal.totalTokens);
    return `
      <div class="usage-model-row provider-${esc(row.providerId)}" data-model-provider-row="${esc(row.providerId)}" ${modelDistributionRowAttributes(model, row.providerId, provider?.providerId)} title="${esc(`${row.label} model-level backend pending`)}">
        <span class="usage-model-swatch"></span>
        <span class="usage-model-name">${esc(row.label)} models pending</span>
        <span class="usage-model-value">${esc(formatTokenCount(window.totalTokens))}</span>
        <span class="usage-model-percent">${esc(percent)}</span>
      </div>`;
  }).join('\n');
  const title = provider ? `${provider.label} model breakdown` : 'Model breakdown';

  return `
    <div class="usage-model-distribution" data-model-placeholder="${esc(scope)}" ${modelDistributionCardAttributes(model, provider?.providerId)}>
      <div class="usage-model-distribution-head">
        <div>
          <div class="usage-model-distribution-title">${esc(title)}</div>
          <div class="usage-model-distribution-meta"><span class="source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span> - model-level backend pending</div>
        </div>
        ${stateChip('PENDING', 'pending')}
      </div>
      <div class="usage-model-empty calm-state">
        <div class="calm-state-header">No model aggregate for this selection</div>
        <div class="calm-state-copy">Provider aggregate totals are still shown when available.</div>
      </div>
      <div class="usage-model-distribution-body">
        <div class="usage-model-donut" data-model-donut="${esc(scope)}" style="background: ${esc(modelDonutGradient(donutRows, selectedTotal.totalTokens))}">
          <div class="usage-model-donut-core">
            <span class="usage-model-donut-total">${esc(formatTokenCount(selectedTotal.totalTokens))}</span>
            <span class="usage-model-donut-label">${esc(formatMessageCount(selectedTotal.totalAssistantMessages))}</span>
          </div>
        </div>
        <div class="usage-model-legend">
          ${rowHtml}
          <div class="usage-model-placeholder-note">Model-level rows are placeholders until PromptFuel stores safe per-model aggregates.</div>
        </div>
      </div>
    </div>`;
}

function renderUsageDistributionVisuals(
  model: DashboardModel,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
): string {
  return `
  <div class="visual-grid" data-usage-distribution="overview">
    ${renderProviderDistributionVisual(model, defaultWindowId)}
    ${renderSourceContributionVisual(model, defaultWindowId)}
  </div>`;
}

function renderProviderUsageDistributionVisuals(
  model: DashboardModel,
  provider: DashboardProviderCard,
  defaultWindowId: DashboardLocalHistoryWindow['windowId'],
): string {
  return `
  <div class="visual-grid provider-visual-grid" data-usage-distribution="${esc(provider.providerId)}">
    ${renderSourceContributionVisual(model, defaultWindowId, provider)}
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

function renderSourceHistorySummary(
  model: DashboardModel,
  defaultWindowId: string,
): string {
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedWindow = findLocalHistoryWindow(selectedSource.windows, defaultWindowId);

  return `
  <div class="overview">
    <div class="overview-row">
      <span class="overview-label">Usage history source</span>
      <span class="overview-value source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Usage history tokens</span>
      <span class="overview-value local-history-summary-value" data-local-value="tokens" ${sourceModeDataAttributes(model.sourceModeTotals, 'tokens')} ${localHistoryDataAttributes(selectedSource.windows, 'tokens')}>${esc(formatTokenCount(selectedWindow.totalTokens))}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Usage history messages</span>
      <span class="overview-value local-history-summary-value" data-local-value="messages" ${sourceModeDataAttributes(model.sourceModeTotals, 'messages')} ${localHistoryDataAttributes(selectedSource.windows, 'messages')}>${esc(String(selectedWindow.totalAssistantMessages))}</span>
    </div>
  </div>`;
}

function renderProviderCards(model: DashboardModel, providers: DashboardProviderCard[], defaultWindowId: string): string {
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const cards = providers.map(p => {
    const sourceProvider = findSourceProvider(selectedSource, p.providerId);
    const providerSelectedWindow = findLocalHistoryWindow(sourceProvider.windows, defaultWindowId);
    const badgeClass = statusBadgeClass(sourceProvider.status);
    return `
    <div class="provider-card" data-provider-local-detail="${esc(p.providerId)}">
      <div class="provider-header card-header">
        <div>
          <span class="provider-label">${esc(p.label)}</span>
          <span class="card-kicker">Usage history</span>
        </div>
        <span class="badge source-provider-status ${esc(badgeClass)}" ${sourceProviderStatusAttributes(model.sourceModeTotals, p.providerId)}>${esc(statusBadgeLabel(sourceProvider.status))}</span>
      </div>
      <div class="provider-metrics">
        <div class="metric">
          <span class="metric-label">Tokens</span>
          <span class="metric-value provider-window-value" ${sourceModeDataAttributes(model.sourceModeTotals, 'tokens', p.providerId)} ${localHistoryDataAttributes(sourceProvider.windows, 'tokens')}>${esc(formatTokenCount(providerSelectedWindow.totalTokens))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Messages</span>
          <span class="metric-value provider-window-value" ${sourceModeDataAttributes(model.sourceModeTotals, 'messages', p.providerId)} ${localHistoryDataAttributes(sourceProvider.windows, 'messages')}>${esc(String(providerSelectedWindow.totalAssistantMessages))}</span>
        </div>
        ${p.parseErrors > 0 ? `
        <div class="metric">
          <span class="metric-label">Local history parse</span>
          <span class="metric-value errors">${esc(formatParseErrorText(p.parseErrors))}</span>
        </div>
        ` : ''}
      </div>
    </div>`;
  }).join('\n');

  return `<div class="card-grid provider-grid">${cards}</div>`;
}

function renderProviderTab(model: DashboardModel, providerId: string): string {
  const provider = model.providers.find(p => p.providerId === providerId);
  if (!provider) {
    return '';
  }

  return `
  <section class="tab-panel" id="tab-${esc(provider.providerId)}" data-dashboard-tab-panel="${esc(provider.providerId)}" role="tabpanel" aria-labelledby="tab-button-${esc(provider.providerId)}" hidden>
    ${renderProviderLiveQuotaSection(model, provider)}

    ${sectionHeader(`${provider.label} usage history (secondary)`, sourceModeChip(model.defaultSourceMode), 'Local history and imported snapshot aggregates stay separate from live quota.')}
    ${renderSourceHistorySummaryForProvider(model, provider, model.defaultLocalHistoryWindowId)}

    ${sectionHeader(`${provider.label} history chart`, sourceModeChip(model.defaultSourceMode), 'Aggregate history windows use provider-coded chart colors.')}
    ${renderUsageHistoryChart(model, model.defaultLocalHistoryWindowId, provider)}

    ${sectionHeader(`${provider.label} usage distribution`, sourceModeChip(model.defaultSourceMode), 'Visual summary follows the selected history source and window.')}
    ${renderProviderUsageDistributionVisuals(model, provider, model.defaultLocalHistoryWindowId)}

    ${sectionHeader(`${provider.label} model breakdown`, stateChip('PENDING', 'pending'), 'Provider aggregate placeholder until model-level history is available.')}
    ${renderModelPlaceholderDistribution(model, model.defaultLocalHistoryWindowId, provider)}

    ${sectionHeader(`${provider.label} provider usage history details`, stateChip('LOCAL', 'local'), 'Windowed local history details for this provider.')}
    ${renderProviderCards(model, [provider], model.defaultLocalHistoryWindowId)}
  </section>`;
}

function renderSourceHistorySummaryForProvider(
  model: DashboardModel,
  provider: DashboardProviderCard,
  defaultWindowId: string,
): string {
  const selectedSource = findSourceModeTotals(model.sourceModeTotals, model.defaultSourceMode);
  const selectedProvider = findSourceProvider(selectedSource, provider.providerId);
  const selectedWindow = findLocalHistoryWindow(selectedProvider.windows, defaultWindowId);

  return `
  <div class="overview">
    <div class="overview-row">
      <span class="overview-label">Usage history source</span>
      <span class="overview-value source-mode-label-value" data-source-label-local="Local only" data-source-label-snapshots="Snapshots only" data-source-label-combined="Combined">${esc(selectedSource.label)}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Usage history tokens</span>
      <span class="overview-value local-history-summary-value" data-local-value="tokens" ${sourceModeDataAttributes(model.sourceModeTotals, 'tokens', provider.providerId)} ${localHistoryDataAttributes(selectedProvider.windows, 'tokens')}>${esc(formatTokenCount(selectedWindow.totalTokens))}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Usage history messages</span>
      <span class="overview-value local-history-summary-value" data-local-value="messages" ${sourceModeDataAttributes(model.sourceModeTotals, 'messages', provider.providerId)} ${localHistoryDataAttributes(selectedProvider.windows, 'messages')}>${esc(String(selectedWindow.totalAssistantMessages))}</span>
    </div>
  </div>`;
}

function renderSourceModeCopy(model: DashboardModel): string {
  if (model.snapshotAggregate.snapshotCount === 0 || model.snapshotAggregate.providers.length === 0) {
    return 'No imported snapshots found. Showing local history only.';
  }
  return 'Imported snapshots available. Choose Local only, Snapshots only, or Combined.';
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
  const providerCards = aggregate.providers.map(provider => `
    <div class="snapshot-card">
      <div class="provider-header card-header">
        <div>
          <span class="provider-label">${esc(provider.label)}</span>
          <span class="card-kicker">Imported usage aggregate</span>
        </div>
        <div class="chip-row">${stateChip('SNAPSHOT', 'snapshot')}${stateChip('AGGREGATE ONLY', 'aggregate-only')}</div>
      </div>
      <div class="provider-metrics">
        <div class="metric">
          <span class="metric-label">Generated</span>
          <span class="metric-value small">${esc(formatRefreshTime(provider.generatedAtMs))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Tokens</span>
          <span class="metric-value">${esc(formatTokenCount(provider.totalTokens))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Messages</span>
          <span class="metric-value">${esc(String(provider.totalAssistantMessages))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Coverage</span>
          <span class="metric-value small">${esc(provider.providedWindowIds.map(windowId => findLocalHistoryWindow(provider.windows, windowId).label).join(', '))}</span>
        </div>
        ${provider.sourceLabel ? `
        <div class="metric">
          <span class="metric-label">Source</span>
          <span class="metric-value small">${esc(provider.sourceLabel)}</span>
        </div>` : ''}
      </div>
      <div class="snapshot-note">Aggregate-only import; daily/model details are not included.</div>
    </div>`).join('\n');

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
    <div class="card-grid snapshot-grid">${providerCards}</div>
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
    background: var(--pf-provider-claude);
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
  .usage-history-bar-segment.claude {
    background: var(--pf-provider-claude);
  }
  .usage-history-bar-segment.codex {
    background-color: var(--pf-provider-codex);
    background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.38) 0, rgba(255,255,255,0.38) 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px);
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
    width: 18px;
    height: 8px;
    border-radius: 2px;
    border: 1px solid var(--pf-keyline);
  }
  .usage-history-legend-swatch.claude {
    background: var(--pf-provider-claude);
  }
  .usage-history-legend-swatch.codex {
    background-color: var(--pf-provider-codex);
    background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.38) 0, rgba(255,255,255,0.38) 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px);
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
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    border-radius: 4px;
  }
  .usage-model-swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid rgba(127,127,127,0.2);
  }
  .provider-claude .usage-model-swatch {
    background: var(--pf-provider-claude);
  }
  .provider-codex .usage-model-swatch {
    background-color: var(--pf-provider-codex);
    background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.38) 0, rgba(255,255,255,0.38) 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px);
  }
  .usage-model-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .usage-model-value,
  .usage-model-percent {
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: nowrap;
  }
  .usage-model-percent {
    color: var(--vscode-descriptionForeground, #999999);
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
  <div class="disclaimer">Live quota is shown first when provider APIs are available. Usage history is secondary and can use local history, imported snapshots, or both. ${esc(renderSourceModeCopy(model))}</div>

  <div class="tabs" role="tablist" aria-label="Dashboard provider views">
    <button type="button" class="tab-btn active" id="tab-button-overview" data-dashboard-tab="overview" role="tab" aria-controls="tab-overview" aria-selected="true">Overview</button>
    <button type="button" class="tab-btn" id="tab-button-claude" data-dashboard-tab="claude" role="tab" aria-controls="tab-claude" aria-selected="false">Claude</button>
    <button type="button" class="tab-btn" id="tab-button-codex" data-dashboard-tab="codex" role="tab" aria-controls="tab-codex" aria-selected="false">Codex</button>
  </div>

  <div class="control-panel">
    <div class="control-group">
      ${sectionHeader('Usage history source', sourceModeChip(model.defaultSourceMode), 'Choose how local history and imported aggregates combine.')}
      ${renderSourceModeSelector(model)}
    </div>
    <div class="control-group">
      ${sectionHeader('Local history window', stateChip('LOCAL', 'local'), 'Window controls affect usage history only, not live quota.')}
      ${renderLocalHistoryWindowSelector(model)}
      ${renderSnapshotWindowNotes(model)}
    </div>
  </div>

  <section class="tab-panel" id="tab-overview" data-dashboard-tab-panel="overview" role="tabpanel" aria-labelledby="tab-button-overview">
    ${renderLiveQuotaSection(model)}

    ${sectionHeader('Usage history (secondary)', sourceModeChip(model.defaultSourceMode), 'Local history and imported snapshot aggregates stay separate from live quota.')}
    ${renderSourceHistorySummary(model, model.defaultLocalHistoryWindowId)}

    ${sectionHeader('History chart', sourceModeChip(model.defaultSourceMode), 'Aggregate history windows use provider-coded chart colors.')}
    ${renderUsageHistoryChart(model, model.defaultLocalHistoryWindowId)}

    ${sectionHeader('Usage distribution', sourceModeChip(model.defaultSourceMode), 'Visual summaries follow the selected history source and window.')}
    ${renderUsageDistributionVisuals(model, model.defaultLocalHistoryWindowId)}

    ${sectionHeader('Model breakdown', stateChip('PENDING', 'pending'), 'Provider aggregate placeholder until model-level history is available.')}
    ${renderModelPlaceholderDistribution(model, model.defaultLocalHistoryWindowId)}

    ${sectionHeader('Provider usage history details', stateChip('LOCAL', 'local'), 'Provider totals follow the selected history source and window.')}
    ${renderProviderCards(model, model.providers, model.defaultLocalHistoryWindowId)}

    ${renderSnapshotSummary(model)}
  </section>

  ${renderProviderTab(model, 'claude')}
  ${renderProviderTab(model, 'codex')}

  <div class="footer">
    <div>
      <div>${esc(liveQuotaRefreshSummary(model))}</div>
      <div>Local history refreshed: ${esc(formatRefreshTime(model.localHistoryLastRefreshedMs))}</div>
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
    var windowButtons = Array.prototype.slice.call(document.querySelectorAll('[data-local-window]'));
    var sourceButtons = Array.prototype.slice.call(document.querySelectorAll('[data-source-mode]'));
    var activeSourceMode = '${model.defaultSourceMode}';
    var activeWindowId = '${model.defaultLocalHistoryWindowId}';
    function statusClass(statusClassName) {
      return statusClassName ? 'badge source-provider-status ' + statusClassName : 'badge source-provider-status';
    }
    function updateSourceWindowNotes() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-source-window-note]'), function(el) {
        var sourceMode = el.getAttribute('data-source-window-note');
        var missing = (el.getAttribute('data-missing-windows') || '').split(',');
        var visible = sourceMode === activeSourceMode && missing.indexOf(activeWindowId) >= 0;
        if (visible) {
          el.removeAttribute('hidden');
        } else {
          el.setAttribute('hidden', '');
        }
      });
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
      var key = activeSourceMode + '-' + activeWindowId;
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
      var key = activeSourceMode + '-' + activeWindowId;
      Array.prototype.forEach.call(document.querySelectorAll('[data-history-chart]'), function(chart) {
        var totalLabel = chart.getAttribute('data-history-total-label-' + activeSourceMode);
        var totalEl = chart.querySelector('.usage-history-total-value');
        var selectedValueEl = chart.querySelector('.usage-history-selected-value');
        var selectedMessagesEl = chart.querySelector('.usage-history-selected-messages');
        var selectedValue = '0 tokens';
        var selectedMessages = '0 messages';
        var selectedEmpty = chart.getAttribute('data-history-empty-' + key) === 'true';
        if (totalEl && totalLabel !== null) {
          totalEl.textContent = totalLabel;
        }
        Array.prototype.forEach.call(chart.querySelectorAll('[data-history-window-bar]'), function(bar) {
          var windowId = bar.getAttribute('data-history-window-bar');
          var height = bar.getAttribute('data-height-' + activeSourceMode) || '0';
          var tokens = bar.getAttribute('data-tokens-' + activeSourceMode) || '0 tokens';
          var messages = bar.getAttribute('data-messages-' + activeSourceMode) || '0 messages';
          var empty = bar.getAttribute('data-empty-' + activeSourceMode) === 'true';
          var active = windowId === activeWindowId;
          var bin = bar.parentElement;
          var fill = bar.querySelector('.usage-history-bar-fill');
          var valueEl = bin ? bin.querySelector('.usage-history-bin-value') : null;
          bar.classList.toggle('empty', empty);
          bar.setAttribute('aria-valuenow', height);
          if (bin) {
            bin.classList.toggle('active', active);
          }
          if (fill) {
            fill.style.height = height + '%';
          }
          if (valueEl) {
            valueEl.textContent = tokens;
          }
          if (active) {
            selectedValue = tokens;
            selectedMessages = messages;
            selectedEmpty = empty;
          }
        });
        chart.classList.toggle('is-empty', selectedEmpty);
        if (selectedValueEl) {
          selectedValueEl.textContent = selectedValue;
        }
        if (selectedMessagesEl) {
          selectedMessagesEl.textContent = selectedMessages;
        }
      });
    }
    function updateModelDistributionVisuals() {
      var key = activeSourceMode + '-' + activeWindowId;
      Array.prototype.forEach.call(document.querySelectorAll('[data-model-placeholder]'), function(card) {
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
        Array.prototype.forEach.call(card.querySelectorAll('[data-model-provider-row]'), function(row) {
          var value = row.getAttribute('data-model-value-' + key) || '0 tokens';
          var messages = row.getAttribute('data-model-messages-' + key) || '0 messages';
          var percent = row.getAttribute('data-model-percent-' + key) || '0%';
          var valueEl = row.querySelector('.usage-model-value');
          var percentEl = row.querySelector('.usage-model-percent');
          if (valueEl) {
            valueEl.textContent = value;
            valueEl.setAttribute('title', messages);
          }
          if (percentEl) {
            percentEl.textContent = percent;
          }
        });
      });
    }
    function updateHistoryValues() {
      Array.prototype.forEach.call(document.querySelectorAll('.local-history-summary-value'), function(el) {
        var valueKind = el.getAttribute('data-local-value');
        if (valueKind === 'tokens') {
          el.textContent = el.getAttribute('data-tokens-' + activeSourceMode + '-' + activeWindowId) || '0 tokens';
        } else if (valueKind === 'messages') {
          el.textContent = el.getAttribute('data-messages-' + activeSourceMode + '-' + activeWindowId) || '0';
        }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.provider-window-value'), function(el) {
        var tokens = el.getAttribute('data-tokens-' + activeSourceMode + '-' + activeWindowId);
        var messages = el.getAttribute('data-messages-' + activeSourceMode + '-' + activeWindowId);
        if (tokens !== null) {
          el.textContent = tokens;
        } else if (messages !== null) {
          el.textContent = messages;
        }
      });
      updateSourceModeLabels();
      updateSourceWindowNotes();
      updateDistributionVisuals();
      updateUsageHistoryCharts();
      updateModelDistributionVisuals();
    }
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
    function setLocalWindow(windowId) {
      if (!windowId) {
        return;
      }
      activeWindowId = windowId;
      updateHistoryValues();
      windowButtons.forEach(function(button) {
        var selected = button.getAttribute('data-local-window') === windowId;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    function setSourceMode(sourceMode) {
      if (!sourceMode) {
        return;
      }
      var sourceButton = sourceButtons.filter(function(button) {
        return button.getAttribute('data-source-mode') === sourceMode;
      })[0];
      if (sourceButton && sourceButton.disabled) {
        return;
      }
      activeSourceMode = sourceMode;
      updateHistoryValues();
      sourceButtons.forEach(function(button) {
        var selected = button.getAttribute('data-source-mode') === sourceMode;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    tabButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setActiveTab(button.getAttribute('data-dashboard-tab'));
      });
    });
    sourceButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setSourceMode(button.getAttribute('data-source-mode'));
      });
    });
    windowButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setLocalWindow(button.getAttribute('data-local-window'));
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
