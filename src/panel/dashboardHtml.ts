import * as vscode from 'vscode';
import { DashboardModel } from './dashboardModel';
import { formatTokenCount } from '../core/formatQuota';

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
    margin-bottom: 20px;
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
  <div class="subtitle">Local usage history</div>

  <div class="overview">
    <div class="overview-row">
      <span class="overview-label">Total tokens</span>
      <span class="overview-value">${esc(formatTokenCount(model.totalTokens))}</span>
    </div>
    <div class="overview-row">
      <span class="overview-label">Total messages</span>
      <span class="overview-value">${esc(String(model.totalAssistantMessages))}</span>
    </div>
  </div>

  ${providerCards}

  <div class="footer">
    <span>Last refreshed: ${esc(formatRefreshTime(model.lastRefreshedMs))}</span>
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
