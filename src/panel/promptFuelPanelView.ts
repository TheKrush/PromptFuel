import { randomBytes } from 'node:crypto';
import { buildPromptFuelPanelScript } from './promptFuelPanelScript';
import { buildStyles } from './promptFuelPanelStyles';
import { EXTENSION_VERSION } from '../version';

export function buildPromptFuelPanelHtml(): string {
  const nonce = randomBytes(16).toString('base64url');
  const script = buildPromptFuelPanelScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
${buildStyles()}
</style>
</head>
<body>
<h1 class="app-title">PromptFuel</h1>
<p class="sub">Usage dashboard and quota monitor. v${EXTENSION_VERSION}</p>

<div class="tabs" role="tablist" aria-label="PromptFuel sections">
  <button class="tab active" data-tab="usage" data-provider-tab="overview" role="tab" aria-selected="true">Overview</button>
  <button class="tab" data-tab="usage" data-provider-tab="claude" role="tab" aria-selected="false">Claude</button>
  <button class="tab" data-tab="usage" data-provider-tab="codex" role="tab" aria-selected="false">Codex</button>
</div>

<section id="tab-usage" class="tab-panel active" role="tabpanel">
  <div class="usage-dashboard">
    <div class="usage-header">
      <div>
        <h2>Usage</h2>
        <p class="muted">Quota windows, today usage, history, and model distribution per provider.</p>
      </div>
      <button class="btn-primary" id="refreshUsageBtn" type="button">Refresh Usage</button>
    </div>

    <div id="usageSourceModeControls" class="usage-source-mode-controls" aria-live="polite"></div>

    <section class="usage-dashboard-section" aria-label="At a glance">
      <div class="usage-section-head">
        <div id="usageAtAGlanceTitle">
          <h3 class="usage-section-title"><span>At a glance</span></h3>
        </div>
        <p class="usage-section-copy">Current quota window state per provider.</p>
      </div>
      <div id="usageDashboardCards" class="usage-provider-grid">
        <div class="usage-empty">Opening this panel refreshes usage automatically.</div>
      </div>
    </section>

    <div id="usageToday" class="usage-today">
      <div class="usage-empty">Today section will appear when safe day-bucket aggregation is implemented.</div>
    </div>

    <div id="usageDetails" class="usage-details">
      <div class="usage-empty">Details will appear when safe normalized token data is available.</div>
    </div>

    <div id="usageRefreshStatus" class="usage-status">Waiting for usage refresh...</div>
  </div>
</section>

<script nonce="${nonce}">
${script}
</script>
</body>
</html>`;
}
