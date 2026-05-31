import * as vscode from 'vscode';
import {
  DashboardLiveQuotaCard,
  DashboardLocalHistoryWindow,
  DashboardModel,
  DashboardProviderCard,
} from './dashboardModel';
import { formatTokenCount } from '../core/formatQuota';
import { formatCountdownLabel, getSanitizedErrorLabel } from '../core/formatLiveQuota';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    'loaded': '<span class="badge loaded">loaded</span>',
    'no-data': '<span class="badge no-data">no data</span>',
    'unknown': '<span class="badge error">error</span>',
    'disabled': '<span class="badge disabled">disabled</span>',
    'not-found': '<span class="badge no-data">not found</span>',
  };
  return map[status] ?? `<span class="badge">${esc(status)}</span>`;
}

function freshnessBadge(freshness: string): string {
  const map: Record<string, string> = {
    'live': '<span class="badge live">LIVE</span>',
    'cached': '<span class="badge cached">STALE</span>',
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
  const used = window.usedPercentage;
  const remaining = window.remainingPercentage;
  const fillWidth = remaining !== undefined ? remaining : (used !== undefined ? 100 - used : 0);
  const clampedWidth = Math.max(0, Math.min(100, fillWidth));
  const barClass = progressBarClass(remaining);
  const valueParts = [];
  if (used !== undefined) {
    valueParts.push(`${Math.round(used)}% used`);
  }
  if (remaining !== undefined) {
    valueParts.push(`${Math.round(remaining)}% left`);
  }
  const valueText = valueParts.join(' / ');
  const countdown = window.resetsAtEpochMs !== undefined
    ? `resets in ${formatCountdownLabel(window.resetsAtEpochMs)}`
    : '';

  return `
      <div class="live-quota-window">
        <span class="live-quota-window-label">${esc(window.windowId)}</span>
        <div class="live-quota-window-bar">
          <div class="live-quota-window-fill ${barClass}" style="width: ${clampedWidth}%"></div>
        </div>
        <span class="live-quota-window-value">${esc(valueText)}</span>
        ${countdown ? `<span class="live-quota-window-countdown">${esc(countdown)}</span>` : ''}
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

function localHistoryDataAttributes(
  windows: DashboardLocalHistoryWindow[],
  value: 'tokens' | 'messages',
): string {
  return windows.map(w => {
    const raw = value === 'tokens' ? formatTokenCount(w.totalTokens) : String(w.totalAssistantMessages);
    return `data-${value}-${esc(w.windowId)}="${esc(raw)}"`;
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

function renderLocalHistorySummary(
  windows: DashboardLocalHistoryWindow[],
  defaultWindowId: string,
): string {
  const selectedWindow = findLocalHistoryWindow(windows, defaultWindowId);

  return `
  <div class="overview">
    <div class="overview-row">
      <span class="overview-label">Local history tokens</span>
      <span class="overview-value local-history-summary-value" data-local-value="tokens" ${localHistoryDataAttributes(windows, 'tokens')}>${esc(formatTokenCount(selectedWindow.totalTokens))}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Local history messages</span>
      <span class="overview-value local-history-summary-value" data-local-value="messages" ${localHistoryDataAttributes(windows, 'messages')}>${esc(String(selectedWindow.totalAssistantMessages))}</span>
    </div>
  </div>`;
}

function renderProviderCards(providers: DashboardProviderCard[], defaultWindowId: string): string {
  return providers.map(p => {
    const providerSelectedWindow = findLocalHistoryWindow(p.localHistoryWindows, defaultWindowId);
    return `
    <div class="provider-card" data-provider-local-detail="${esc(p.providerId)}">
      <div class="provider-header">
        <span class="provider-label">${esc(p.label)}</span>
        ${statusBadge(p.status)}
      </div>
      <div class="provider-metrics">
        <div class="metric">
          <span class="metric-label">Tokens</span>
          <span class="metric-value provider-window-value" ${localHistoryDataAttributes(p.localHistoryWindows, 'tokens')}>${esc(formatTokenCount(providerSelectedWindow.totalTokens))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Messages</span>
          <span class="metric-value provider-window-value" ${localHistoryDataAttributes(p.localHistoryWindows, 'messages')}>${esc(String(providerSelectedWindow.totalAssistantMessages))}</span>
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

    <div class="section-title">${esc(provider.label)} local history (secondary)</div>
    ${renderLocalHistorySummary(provider.localHistoryWindows, model.defaultLocalHistoryWindowId)}

    <div class="section-title">${esc(provider.label)} provider local history details</div>
    ${renderProviderCards([provider], model.defaultLocalHistoryWindowId)}
  </section>`;
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
  .window-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .window-btn {
    background: transparent;
    color: var(--vscode-foreground, #cccccc);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .window-btn:hover {
    background: rgba(127,127,127,0.12);
  }
  .window-btn.active {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.18));
    border-color: var(--vscode-focusBorder, #007acc);
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
  .metric-value.errors {
    color: var(--vscode-descriptionForeground, #999999);
    font-size: 12px;
    font-weight: 500;
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
  <div class="disclaimer">Live quota is shown first when provider APIs are available. Local history is secondary and comes from session files. Snapshots not included.</div>

  <div class="tabs" role="tablist" aria-label="Dashboard provider views">
    <button class="tab-btn active" id="tab-button-overview" data-dashboard-tab="overview" role="tab" aria-controls="tab-overview" aria-selected="true">Overview</button>
    <button class="tab-btn" id="tab-button-claude" data-dashboard-tab="claude" role="tab" aria-controls="tab-claude" aria-selected="false">Claude</button>
    <button class="tab-btn" id="tab-button-codex" data-dashboard-tab="codex" role="tab" aria-controls="tab-codex" aria-selected="false">Codex</button>
  </div>

  <div class="section-title">Local history window</div>
  ${renderLocalHistoryWindowSelector(model)}

  <section class="tab-panel" id="tab-overview" data-dashboard-tab-panel="overview" role="tabpanel" aria-labelledby="tab-button-overview">
    ${renderLiveQuotaSection(model)}

    <div class="section-title">Local history (secondary)</div>
    ${renderLocalHistorySummary(model.localHistoryWindows, model.defaultLocalHistoryWindowId)}

    <div class="section-title">Provider local history details</div>
    ${renderProviderCards(model.providers, model.defaultLocalHistoryWindowId)}
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
      Array.prototype.forEach.call(document.querySelectorAll('.local-history-summary-value'), function(el) {
        var valueKind = el.getAttribute('data-local-value');
        if (valueKind === 'tokens') {
          el.textContent = el.getAttribute('data-tokens-' + windowId) || '0 tokens';
        } else if (valueKind === 'messages') {
          el.textContent = el.getAttribute('data-messages-' + windowId) || '0';
        }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.provider-window-value'), function(el) {
        var tokens = el.getAttribute('data-tokens-' + windowId);
        var messages = el.getAttribute('data-messages-' + windowId);
        if (tokens !== null) {
          el.textContent = tokens;
        } else if (messages !== null) {
          el.textContent = messages;
        }
      });
      windowButtons.forEach(function(button) {
        var selected = button.getAttribute('data-local-window') === windowId;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    tabButtons.forEach(function(button) {
      button.addEventListener('click', function() {
        setActiveTab(button.getAttribute('data-dashboard-tab'));
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
  })();
</script>
</body>
</html>`;
}
