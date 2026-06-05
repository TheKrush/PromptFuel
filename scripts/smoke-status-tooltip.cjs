#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { formatStatus } = require('../out/display/format.js');

function assertCompactTooltipContract(result, label) {
  assert.ok(result.tooltip.length > 0, `${label}: combined tooltip exists`);
  assert.doesNotMatch(result.tooltip, /\*\*Models\*\*|Models \(|API est\.|\*\*Details\*\*|- Source:|- Freshness:/, `${label}: compact tooltip omits debug/model sections`);
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
    assertCompactTooltipContract(result, 'remote quota');
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
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      lastUpdatedEpochMs: now - 45_000,
      sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assertCompactTooltipContract(result, 'fresh local quota');
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
