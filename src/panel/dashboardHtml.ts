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

function freshnessBadge(freshness: string): string {
  const map: Record<string, string> = {
    'live': '<span class="badge live">LIVE</span>',
    'cached': '<span class="badge cached">CACHED</span>',
    'stale': '<span class="badge stale">STALE</span>',
    'unavailable': '<span class="badge error">UNAVAILABLE</span>',
    'error': '<span class="badge error">UNAVAILABLE</span>',
  };
  return map[freshness] ?? `<span class="badge">${esc(freshness)}</span>`;
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

  return `
      <div class="live-quota-window">
        <span class="live-quota-window-label">${esc(window.windowId)}</span>
        <div class="live-quota-window-bar">
          <div class="live-quota-window-fill ${barClass}" style="width: ${clampedWidth}%"></div>
        </div>
        <span class="live-quota-window-value">${esc(valueText)}</span>
      </div>`;
}

function renderLiveQuotaCard(card: DashboardLiveQuotaCard): string {
  const windowsHtml = card.windows.map(w => renderLiveQuotaWindow(w)).join('\n');
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
    <div class="live-quota-card">
      <div class="live-quota-header">
        <span class="live-quota-label">${esc(card.label)}</span>
        ${freshnessBadge(card.freshness)}
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
    : '<span class="badge disabled">DISABLED</span>';
  const prefix = label ? `${esc(label)}: ` : '';

  return `<div class="live-quota-not-enabled">${prefix}${esc(stateText)} ${badge}</div>`;
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
  return cards.map(card => {
    if (card.freshness === 'unavailable' || card.freshness === 'error') {
      return `
    <div class="live-quota-unavailable">
      <span class="live-quota-label">${esc(card.label)}</span>
      ${freshnessBadge(card.freshness)}
      <span>${esc(getSanitizedErrorLabel())}</span>
    </div>`;
    }
    return renderLiveQuotaCard(card);
  }).join('\n');
}

function renderLiveQuotaSection(model: DashboardModel): string {
  if (model.liveQuotaCards.length === 0) {
    const stateText = model.liveQuotaEnabled
      ? 'Live quota loading'
      : 'Live quota disabled';
    const badge = model.liveQuotaEnabled
      ? ''
      : '<span class="badge disabled">DISABLED</span>';
    return `
  <div class="live-quota-section">
    <div class="section-title">Live quota</div>
    <div class="live-quota-not-enabled">${esc(stateText)} ${badge}</div>
  </div>`;
  }

  return `
  <div class="live-quota-section">
    <div class="section-title">Live quota</div>
    ${renderLiveQuotaCards(model.liveQuotaCards)}
  </div>`;
}

function renderProviderLiveQuotaSection(model: DashboardModel, provider: DashboardProviderCard): string {
  const card = model.liveQuotaCards.find(c => c.providerId === provider.providerId);
  const body = card
    ? renderLiveQuotaCards([card])
    : renderLiveQuotaEmptyState(model, provider.label);

  return `
  <div class="live-quota-section" data-provider-live-quota="${esc(provider.providerId)}">
    <div class="section-title">${esc(provider.label)} live quota</div>
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

function renderLocalHistoryWindowSelector(model: DashboardModel): string {
  const buttons = model.localHistoryWindows.map(w => {
    const selected = w.windowId === model.defaultLocalHistoryWindowId;
    return `<button class="window-btn${selected ? ' active' : ''}" data-local-window="${esc(w.windowId)}" aria-pressed="${selected ? 'true' : 'false'}">${esc(w.label)}</button>`;
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
    return `<button class="source-btn${selected ? ' active' : ''}" data-source-mode="${esc(mode.sourceMode)}" aria-pressed="${selected ? 'true' : 'false'}"${disabled ? ' disabled aria-disabled="true"' : ''}>${esc(mode.label)}</button>`;
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
  return providers.map(p => {
    const sourceProvider = findSourceProvider(selectedSource, p.providerId);
    const providerSelectedWindow = findLocalHistoryWindow(sourceProvider.windows, defaultWindowId);
    const badgeClass = statusBadgeClass(sourceProvider.status);
    return `
    <div class="provider-card" data-provider-local-detail="${esc(p.providerId)}">
      <div class="provider-header">
        <span class="provider-label">${esc(p.label)}</span>
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
}

function renderProviderTab(model: DashboardModel, providerId: string): string {
  const provider = model.providers.find(p => p.providerId === providerId);
  if (!provider) {
    return '';
  }

  return `
  <section class="tab-panel" id="tab-${esc(provider.providerId)}" data-dashboard-tab-panel="${esc(provider.providerId)}" role="tabpanel" aria-labelledby="tab-button-${esc(provider.providerId)}" hidden>
    ${renderProviderLiveQuotaSection(model, provider)}

    <div class="section-title">${esc(provider.label)} usage history (secondary)</div>
    ${renderSourceHistorySummaryForProvider(model, provider, model.defaultLocalHistoryWindowId)}

    <div class="section-title">${esc(provider.label)} provider usage history details</div>
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
    return '';
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
      <div class="provider-header">
        <span class="provider-label">${esc(provider.label)}</span>
        <span class="badge cached">SNAPSHOT</span>
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
        ${provider.sourceLabel ? `
        <div class="metric">
          <span class="metric-label">Source</span>
          <span class="metric-value small">${esc(provider.sourceLabel)}</span>
        </div>` : ''}
      </div>
      <div class="snapshot-note">Imported aggregate-only data.</div>
    </div>`).join('\n');

  return `
  <div class="snapshot-summary">
    <div class="section-title">Imported snapshots</div>
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
    </div>
    ${providerCards}
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
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground, #cccccc);
    background-color: var(--vscode-editor-background, #1e1e1e);
    margin: 0;
    padding: 0;
  }
  .dashboard {
    max-width: 640px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .title {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .subtitle {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #999999);
    margin-bottom: 8px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .disclaimer {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    background: rgba(136,136,136,0.1);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .overview {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .window-selector,
  .source-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .window-btn,
  .source-btn {
    background: transparent;
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .window-btn:hover,
  .source-btn:hover {
    background: rgba(127,127,127,0.12);
  }
  .window-btn.active,
  .source-btn.active {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.18));
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .source-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0 12px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    padding-bottom: 8px;
  }
  .tab-btn {
    background: transparent;
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .tab-btn:hover {
    background: rgba(127,127,127,0.12);
  }
  .tab-btn.active {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.18));
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .tab-panel[hidden] {
    display: none;
  }
  .overview-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
  }
  .overview-label {
    color: var(--vscode-descriptionForeground, #999999);
  }
  .overview-value {
    font-weight: 600;
  }
  .provider-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .snapshot-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .provider-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .provider-label {
    font-weight: 600;
    font-size: 14px;
  }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge.loaded {
    background: rgba(56, 139, 56, 0.2);
    color: #3c963c;
  }
  .badge.no-data {
    background: rgba(136, 136, 136, 0.2);
    color: #888888;
  }
  .badge.error {
    background: rgba(233, 50, 98, 0.2);
    color: #e93262;
  }
  .badge.disabled {
    background: rgba(136, 136, 136, 0.15);
    color: #666666;
  }
  .badge.live {
    background: rgba(56, 139, 56, 0.2);
    color: #3c963c;
  }
  .badge.cached {
    background: rgba(136, 136, 136, 0.2);
    color: #a0a0a0;
  }
  .badge.stale {
    background: rgba(233, 185, 50, 0.2);
    color: #d4a017;
  }
  .live-quota-section {
    margin-top: 20px;
    margin-bottom: 20px;
  }
  .live-quota-not-enabled {
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 12px 16px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    text-align: center;
  }
  .live-quota-unavailable {
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 10px;
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .live-quota-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .live-quota-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
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
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground, #999999);
    min-width: 24px;
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
    background: #3c963c;
  }
  .live-quota-window-fill.yellow {
    background: #d4a017;
  }
  .live-quota-window-fill.orange {
    background: #d18616;
  }
  .live-quota-window-fill.red {
    background: #e93262;
  }
  .live-quota-window-value {
    font-size: 12px;
    font-weight: 600;
    min-width: 128px;
    text-align: right;
    white-space: nowrap;
  }
  .live-quota-window-countdown {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #999999);
    min-width: 48px;
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
  .provider-metrics {
    display: flex;
    gap: 24px;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
</style>
</head>
<body>
<div class="dashboard">
  <div class="title">PromptFuel</div>
  <div class="subtitle">Usage overview</div>
  <div class="disclaimer">Live quota is shown first when provider APIs are available. Usage history is secondary and can use local history, imported snapshots, or both. ${esc(renderSourceModeCopy(model))}</div>

  <div class="tabs" role="tablist" aria-label="Dashboard provider views">
    <button class="tab-btn active" id="tab-button-overview" data-dashboard-tab="overview" role="tab" aria-controls="tab-overview" aria-selected="true">Overview</button>
    <button class="tab-btn" id="tab-button-claude" data-dashboard-tab="claude" role="tab" aria-controls="tab-claude" aria-selected="false">Claude</button>
    <button class="tab-btn" id="tab-button-codex" data-dashboard-tab="codex" role="tab" aria-controls="tab-codex" aria-selected="false">Codex</button>
  </div>

  <div class="section-title">Usage history source</div>
  ${renderSourceModeSelector(model)}

  <div class="section-title">Local history window</div>
  ${renderLocalHistoryWindowSelector(model)}
  ${renderSnapshotWindowNotes(model)}

  <section class="tab-panel" id="tab-overview" data-dashboard-tab-panel="overview" role="tabpanel" aria-labelledby="tab-button-overview">
    ${renderLiveQuotaSection(model)}

    <div class="section-title">Usage history (secondary)</div>
    ${renderSourceHistorySummary(model, model.defaultLocalHistoryWindowId)}

    <div class="section-title">Provider usage history details</div>
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
    <button class="refresh-btn" id="refreshBtn">Refresh</button>
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
