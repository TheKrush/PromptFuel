import * as vscode from 'vscode';
import { DashboardModel } from './dashboardModel';
import { formatTokenCount } from '../core/formatQuota';
import { getFreshnessLabel, formatCountdownLabel, getSanitizedErrorLabel } from '../core/formatLiveQuota';

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
    'live': '<span class="badge live">live</span>',
    'cached': '<span class="badge cached">cached</span>',
    'stale': '<span class="badge stale">stale</span>',
    'unavailable': '<span class="badge error">unavailable</span>',
    'error': '<span class="badge error">error</span>',
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
  const valueText = remaining !== undefined
    ? `${Math.round(remaining)}% left`
    : (used !== undefined ? `${Math.round(used)}% used` : '');
  const countdown = window.resetsAtEpochMs !== undefined
    ? formatCountdownLabel(window.resetsAtEpochMs)
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

function renderLiveQuotaCard(card: import('./dashboardModel').DashboardLiveQuotaCard): string {
  const windowsHtml = card.windows.map(w => renderLiveQuotaWindow(w)).join('\n');
  const footer = card.lastUpdatedMs !== undefined
    ? `<div class="live-quota-footer">Updated: ${esc(formatRefreshTime(card.lastUpdatedMs))}</div>`
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
      ${footer}
    </div>`;
}

function renderLiveQuotaSection(model: DashboardModel): string {
  if (model.liveQuotaCards.length === 0) {
    return `
  <div class="live-quota-section">
    <div class="subtitle">Live quota</div>
    <div class="live-quota-not-enabled">Live quota not enabled yet</div>
  </div>`;
  }

  const hasUsable = model.liveQuotaCards.some(
    c => c.freshness !== 'unavailable' && c.freshness !== 'error',
  );

  const cardsHtml = model.liveQuotaCards.map(card => {
    if (card.freshness === 'unavailable' || card.freshness === 'error') {
      return `
    <div class="live-quota-unavailable">${esc(card.label)}: ${esc(getSanitizedErrorLabel())}</div>`;
    }
    return renderLiveQuotaCard(card);
  }).join('\n');

  return `
  <div class="live-quota-section">
    <div class="subtitle">Live quota</div>
    ${cardsHtml}
  </div>`;
}

export function buildDashboardHtml(
  webview: vscode.Webview,
  model: DashboardModel,
): string {
  const nonce = generateNonce();

  const providerCards = model.providers.map(p => {
    return `
    <div class="provider-card">
      <div class="provider-header">
        <span class="provider-label">${esc(p.label)}</span>
        ${statusBadge(p.status)}
      </div>
      <div class="provider-metrics">
        <div class="metric">
          <span class="metric-label">Tokens</span>
          <span class="metric-value">${esc(formatTokenCount(p.totalTokens))}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Messages</span>
          <span class="metric-value">${esc(String(p.totalAssistantMessages))}</span>
        </div>
        ${p.parseErrors > 0 ? `
        <div class="metric">
          <span class="metric-label">Parse errors</span>
          <span class="metric-value errors">${esc(String(p.parseErrors))}</span>
        </div>
        ` : ''}
      </div>
    </div>`;
  }).join('\n');

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
    text-align: center;
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
    min-width: 64px;
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
    color: #e93262;
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
  <div class="disclaimer">Status bar and tooltip may show live quota from provider APIs when enabled. Dashboard overview shows local history from session files. Snapshots are not included.</div>

  ${renderLiveQuotaSection(model)}

  <div class="overview">
    <div class="overview-row">
      <span class="overview-label">Local history tokens</span>
      <span class="overview-value">${esc(formatTokenCount(model.totalTokens))}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Local history messages</span>
      <span class="overview-value">${esc(String(model.totalAssistantMessages))}</span>
    </div>
  </div>

  ${providerCards}

  <div class="footer">
    <span>Local history refreshed: ${esc(formatRefreshTime(model.localHistoryLastRefreshedMs))}</span>
    <button class="refresh-btn" id="refreshBtn">Refresh</button>
  </div>
</div>
<script nonce="${nonce}">
  (function() {
    var acquired = acquireVsCodeApi();
    var btn = document.getElementById('refreshBtn');
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
