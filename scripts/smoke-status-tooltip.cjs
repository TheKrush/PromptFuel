#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatStatus } = require('../out/display/format.js');

function assertCompactTooltipContract(result, label) {
  assert.ok(result.tooltip.length > 0, `${label}: combined tooltip exists`);
  assert.doesNotMatch(result.tooltip, /\*\*Models\*\*|Models \(|API est\.|\*\*Details\*\*|- Source:|- Freshness:/, `${label}: compact tooltip omits debug/model sections`);
  assert.doesNotMatch(result.tooltip, /snap|snapshot|cached|stale|unavailable|live window not supplied/i, `${label}: compact tooltip omits state and provenance prose`);
  assert.doesNotMatch(result.tooltip, /<span[^>]*(?:title|aria-label)=/, `${label}: quota rows have no final indicator elements`);
  for (const provider of result.providers) {
    assert.ok(provider.tooltip.length > 0, `${label}: provider tooltip exists`);
    assert.doesNotMatch(provider.tooltip, /\*\*Models\*\*|Models \(|API est\.|\*\*Details\*\*|- Source:|- Freshness:/, `${label}: provider tooltip omits debug/model sections`);
  }
}

function baseOptions(now = Date.now()) {
  return {
    displayMode: 'standard',
    displayParts: {
      showEmoji: true,
      showProviderNames: true,
      showFiveHour: true,
      showSevenDay: true,
      sevenDayFirst: true,
      showPercentSymbol: true,
      showCountdownInline: false,
      showSourceInline: false,
      showStaleInline: false
    },
    statusMode: 'remaining',
    nextResetRefreshEpochMs: now + 120_000
  };
}

function assertDefaultStatusBarBackground(label) {
  const repoRoot = path.resolve(__dirname, '..');
  const statusBarSource = fs.readFileSync(path.join(repoRoot, 'src', 'statusBar.ts'), 'utf8');
  assert.doesNotMatch(statusBarSource, /\.backgroundColor\s*=|statusBarItem\.warning(?:Background|Foreground)/, `${label}: status item never assigns an issue-driven background`);
}

function main() {
  const now = Date.now();
  const sevenDayReset = Math.floor((now + ((2 * 24 + 8) * 60 * 60 * 1000)) / 1000);
  const fiveHourReset = Math.floor((now + ((2 * 60 + 30) * 60 * 1000)) / 1000);
  const opts = baseOptions(now);

  {
    const result = formatStatus([{
      provider: 'codex',
      source: 'synthetic provider-specific smoke state',
      sevenDay: { usedPercentage: 100, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: fiveHourReset }
    }], opts);
    const provider = result.providers[0];

    assert.equal(provider.provider, 'codex');
    assert.equal(provider.severity, 'critical');
    assertCompactTooltipContract(result, 'provider quota');
  }

  {
    const result = formatStatus([{
      provider: 'codex',
      source: 'test',
      sevenDay: { usedPercentage: 95, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: fiveHourReset }
    }], opts);
    assert.equal(result.providers[0].severity, 'critical');
  }

  {
    const remoteSevenDayReset = Math.floor((Date.now() + ((5 * 24 + 1) * 60 * 60 * 1000)) / 1000);
    const remoteFiveHourReset = Math.floor((Date.now() + (3 * 60 * 60 * 1000)) / 1000);
    const result = formatStatus([], opts, [{
      provider: 'codex',
      text: 'VM Codex remote quota',
      tooltip: '## VM Codex',
      severity: 'normal',
      remoteQuotaData: {
        label: 'VM Codex',
        sevenDayRemainingPercent: 80,
        fiveHourRemainingPercent: 70,
        sevenDayResetEpochSeconds: remoteSevenDayReset,
        fiveHourResetEpochSeconds: remoteFiveHourReset,
        stale: false,
        snapshotAgeLabel: '5m'
      }
    }]);

    assert.equal(result.severity, 'normal');
    assert.equal(result.providers.length, 0);
    assert.equal(result.text, 'VM Codex remote quota', 'fresh remote status text remains separate and unchanged');
    assert.doesNotMatch(result.tooltip, /snap|snapshot/i, 'fresh snapshot provenance does not add visible tooltip prose or a warning');
    assert.match(result.tooltip, /\| VM Codex \| 7d [^\n]*\|$/m, 'normal imported row ends at the reset-time column');
    assertCompactTooltipContract(result, 'remote quota');
  }

  {
    const result = formatStatus([], opts, [{
      provider: 'codex',
      text: 'VM Codex unavailable-window quota',
      tooltip: '## VM Codex',
      severity: 'normal',
      remoteQuotaData: {
        label: 'VM Codex',
        sevenDayRemainingPercent: 80,
        fiveHourRemainingPercent: undefined,
        sevenDayResetEpochSeconds: sevenDayReset,
        stale: false
      }
    }]);
    const unavailableRow = result.tooltip.split('\n').find(line => line.includes('| VM Codex | 5h |')) || '';
    assert.equal(result.text, 'VM Codex unavailable-window quota', 'remote status text remains independent of tooltip fallback presentation');
    assert.doesNotMatch(unavailableRow, /[!⚠▲△?]|<span/, 'fresh unavailable remote row has no state marker or unknown-reset question mark');
    assert.match(unavailableRow, /\| — \| \| — \| \|$/, 'fresh unavailable remote row uses compact placeholders in the standard columns');
    assertDefaultStatusBarBackground('missing imported Codex five-hour data');
  }

  {
    const result = formatStatus([], opts, [{
      provider: 'codex',
      text: 'VM Codex remote quota',
      tooltip: '## VM Codex',
      severity: 'normal',
      remoteQuotaData: {
        label: 'VM Codex',
        sevenDayRemainingPercent: 80,
        fiveHourRemainingPercent: 70,
        sevenDayResetEpochSeconds: sevenDayReset,
        fiveHourResetEpochSeconds: fiveHourReset,
        stale: true,
        snapshotAgeLabel: 'old'
      }
    }]);
    assert.doesNotMatch(result.tooltip, /snap|snapshot|stale|cached|⚠|▲|△/i, 'stale imported state adds no compact tooltip noise');
    assert.equal(result.localLiveQuotaAttention, false, 'stale imported state does not trigger local attention');
    assertDefaultStatusBarBackground('stale imported quota');
  }

  {
    const result = formatStatus([], opts, [{
      provider: 'codex',
      text: 'VM Codex stale unavailable-window quota',
      tooltip: '## VM Codex',
      severity: 'normal',
      remoteQuotaData: {
        label: 'VM Codex',
        sevenDayRemainingPercent: 80,
        fiveHourRemainingPercent: undefined,
        sevenDayResetEpochSeconds: sevenDayReset,
        stale: true
      }
    }]);
    const unavailableRow = result.tooltip.split('\n').find(line => line.includes('| VM Codex | 5h |')) || '';
    assert.doesNotMatch(unavailableRow, /[!⚠▲△?]|<span|snap|snapshot|stale|unavailable/i, 'stale unavailable remote row keeps the same compact columns without state prose');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'test',
      sevenDay: { usedPercentage: 50 },
      fiveHour: { usedPercentage: 25 }
    }], opts);

    assert.equal(result.providers[0].provider, 'claude');
    assertCompactTooltipContract(result, 'unknown reset quota');
  }

  {
    const rawProviderError = 'untrusted raw provider response detail';
    const result = formatStatus([{
      provider: 'codex',
      source: 'live authenticated refresh',
      authenticatedStatus: 'success',
      authenticatedError: rawProviderError,
      sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: sevenDayReset, sourceKind: 'authenticated' },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset, sourceKind: 'cache', sourceUpdatedEpochMs: now - 60_000 },
      authenticatedWindows: {
        sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: now },
        fiveHour: { observation: 'malformed', availability: 'cached', lastLiveEpochMs: now - 60_000 }
      }
    }], opts);

    assert.doesNotMatch(result.text, /[!⚠▲△?]/, 'window-specific fallback adds no compact issue marker');
    assert.equal(result.localLiveQuotaAttention, true, 'window-specific fallback enables the one local attention state');
    assert.equal((result.tooltip.match(/Some live quota data is incomplete\. Open the dashboard for details\./g) ?? []).length, 1, 'tooltip contains one concise attention summary');
    assert.doesNotMatch(result.tooltip, /cached value|live window unreadable|<span[^>]*(?:title|aria-label)=/i, 'tooltip rows contain no state explanation or indicator element');
    assert.doesNotMatch(result.tooltip, new RegExp(rawProviderError), 'tooltip excludes raw provider errors');
    assert.equal(result.providers[0].severity, 'normal', 'healthy sibling quota does not inherit a provider-wide warning');
    assertDefaultStatusBarBackground('partial authenticated quota success');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      stale: true,
      sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assert.match(result.text, /25%/, 'stale local quota text remains visible');
    assertDefaultStatusBarBackground('stale local quota');
  }

  {
    const result = formatStatus([{
      provider: 'codex',
      source: 'live authenticated refresh',
      authenticatedStatus: 'network_error',
      sevenDay: { usedPercentage: 30, resetsAtEpochSeconds: sevenDayReset, sourceKind: 'cache' },
      fiveHour: { usedPercentage: 40, resetsAtEpochSeconds: fiveHourReset, sourceKind: 'cache' }
    }], opts);

    assert.equal(result.localLiveQuotaAttention, true, 'authenticated provider failure remains available to the tooltip state');
    assert.match(result.tooltip, /Some live quota data is incomplete\. Open the dashboard for details\./, 'authenticated provider failure retains concise tooltip context');
    assertDefaultStatusBarBackground('authenticated provider error');
  }


  {
    const result = formatStatus([{
      provider: 'codex',
      source: 'live authenticated refresh',
      stale: true,
      authenticatedStatus: 'success',
      sevenDay: { usedPercentage: 66, resetsAtEpochSeconds: sevenDayReset, sourceKind: 'authenticated' },
      authenticatedWindows: {
        sevenDay: { observation: 'valid', availability: 'cached', lastLiveEpochMs: now },
        fiveHour: { observation: 'absent', availability: 'unavailable' }
      }
    }], opts);

    assert.match(result.text, /34%/, 'live weekly quota remains visible');
    assert.doesNotMatch(result.text, /100%|5h|\u2014/, 'missing five-hour quota is omitted from compact status text');
    assert.doesNotMatch(result.text, /\u00B7\s*$/, 'missing five-hour quota leaves no dangling separator');
    assert.doesNotMatch(result.text, /\?/, 'missing five-hour quota does not add an unknown reset countdown');
    assert.doesNotMatch(result.text, /[!⚠▲△]/, 'status text contains no per-window issue marker');
    assert.equal(result.localLiveQuotaAttention, true, 'missing five-hour data enables the one local attention state');
    const missingRow = result.tooltip.split('\n').find(line => line.includes('| Codex | 5h |')) || '';
    assert.match(missingRow, /\| \u2014 \| \| \u2014 \| \|$/, 'tooltip retains the missing five-hour row with compact placeholders');
    assertDefaultStatusBarBackground('missing stale local Codex five-hour quota');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      lastUpdatedEpochMs: now - 45_000,
      sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assertCompactTooltipContract(result, 'fresh local quota');
    assert.match(result.text, /^Claude .*25% · .*70%$/, 'healthy status text keeps provider, windows, countdowns, dots, and percentages');
    assertDefaultStatusBarBackground('healthy status output');
  }

  {
    const unsafeHtml = '<span data-unsafe="1">unsafe</span>';
    const result = formatStatus([{
      provider: 'claude',
      source: `external source ${unsafeHtml}`,
      ignoredQuotaSource: `ignored source ${unsafeHtml}`,
      authenticatedStatus: `custom status ${unsafeHtml}`,
      sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assert.ok(!result.tooltip.includes(unsafeHtml), 'dynamic raw HTML is not present');
    assert.ok(!result.tooltip.includes('&lt;span data-unsafe'), 'dynamic diagnostic text is omitted from compact tooltip');
    assertCompactTooltipContract(result, 'unsafe diagnostic input');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      sevenDay: { usedPercentage: 100, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assert.doesNotMatch(result.tooltip, /blocked/i, 'tooltip does not assert blocked for unconfirmed provider behavior');
    assertCompactTooltipContract(result, 'near-exhausted quota');
  }

  console.log('status tooltip smoke passed');
}

main();
