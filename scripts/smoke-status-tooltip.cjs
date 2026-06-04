#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { formatStatus } = require('../out/display/format.js');
const { formatCountdown } = require('../out/usageTime.js');

function markdownCells(line) {
  return line.trim().split('|').slice(1, -1).map(cell => cell.trim());
}

function assertMarkdownTablesAligned(markdown, label) {
  const lines = markdown.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.includes('-') || !/^\|[:\-\s|]+$/.test(line)) {
      continue;
    }
    const expected = markdownCells(line).length;
    assert.equal(markdownCells(lines[i - 1]).length, expected, `${label}: header matches separator`);
    for (let j = i + 1; j < lines.length; j += 1) {
      const row = lines[j].trim();
      if (!row.startsWith('|')) {
        break;
      }
      assert.equal(markdownCells(row).length, expected, `${label}: row matches separator`);
    }
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
    assertMarkdownTablesAligned(provider.tooltip, 'provider tooltip');

    const sevenDayRow = provider.tooltip.split(/\r?\n/).find(line => line.startsWith('| 7d |'));
    const fiveHourRow = provider.tooltip.split(/\r?\n/).find(line => line.startsWith('| 5h |'));
    assert.ok(sevenDayRow, 'provider 7d row present');
    assert.ok(fiveHourRow, 'provider 5h row present');
    assert.match(fiveHourRow, /blocked/, '5h row marks provider blocked by an exhausted 7d window');

    const cells = markdownCells(sevenDayRow);
    assert.equal(cells.length, 6, 'provider quota row has split countdown and reset time columns');
    assert.match(cells[4], /^\*\*\d+[dhm]\*\*$/, 'countdown column contains a compact countdown');
    assert.ok(cells[5].length > 0 && !cells[5].includes('**'), 'reset time column is separate from countdown');
  }

  {
    const result = formatStatus([{
      provider: 'codex',
      source: 'test',
      sevenDay: { usedPercentage: 95, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: fiveHourReset }
    }], opts);
    assert.doesNotMatch(result.providers[0].text, /blocked/, 'critical but non-empty 7d quota does not block 5h');
  }

  {
    const remoteSevenDayReset = Math.floor((Date.now() + ((5 * 24 + 1) * 60 * 60 * 1000)) / 1000);
    const remoteFiveHourReset = Math.floor((Date.now() + (3 * 60 * 60 * 1000)) / 1000);
    const remoteSevenDayCountdown = formatCountdown(remoteSevenDayReset);
    const remoteFiveHourCountdown = formatCountdown(remoteFiveHourReset);
    const result = formatStatus([], opts, [{
      provider: 'codex',
      text: `VM Codex ${remoteSevenDayCountdown} 80% - ${remoteFiveHourCountdown} 70%`,
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

    assertMarkdownTablesAligned(result.tooltip, 'combined remote tooltip');
    const remoteRow = result.tooltip.split(/\r?\n/).find(line => line.startsWith('| VM Codex | 7d |'));
    assert.ok(remoteRow, 'remote combined 7d row present');
    const cells = markdownCells(remoteRow);
    assert.equal(cells.length, 8, 'remote row has split countdown, reset time, and source columns');
    assert.equal(cells[5], `**${remoteSevenDayCountdown}**`, 'remote countdown column contains countdown only');
    assert.ok(cells[6].length > 0 && !cells[6].includes('snap'), 'remote reset time is separate from source note');
    assert.equal(cells[7], 'snap 5m', 'remote snapshot source note stays in source column');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'test',
      sevenDay: { usedPercentage: 50 },
      fiveHour: { usedPercentage: 25 }
    }], opts);

    assertMarkdownTablesAligned(result.tooltip, 'unknown reset combined tooltip');
    assertMarkdownTablesAligned(result.providers[0].tooltip, 'unknown reset provider tooltip');
    const providerCells = markdownCells(result.providers[0].tooltip.split(/\r?\n/).find(line => line.startsWith('| 7d |')));
    const combinedCells = markdownCells(result.tooltip.split(/\r?\n/).find(line => line.startsWith('| Claude | 7d |')));
    assert.equal(providerCells[4], 'unknown');
    assert.equal(providerCells[5], '');
    assert.equal(combinedCells[5], 'unknown');
    assert.equal(combinedCells[6], '');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      lastUpdatedEpochMs: now - 45_000,
      sevenDay: { usedPercentage: 75, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assert.ok(result.tooltip.includes('<span style="color:'), 'generated progress span remains HTML');
    assert.ok(result.tooltip.includes('|  |  |  |  |  |'), 'quota tables use blank header convention');
    assert.ok(!result.tooltip.includes('| Window |'), 'quota tables do not expose visible header labels');
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

    assert.ok(result.tooltip.includes('<span style="color:'), 'generated progress span remains HTML');
    assert.ok(!result.tooltip.includes(unsafeHtml), 'dynamic raw HTML is not present');
    assert.ok(result.tooltip.includes('&lt;span data-unsafe'), 'dynamic hover text is escaped');
  }

  {
    const result = formatStatus([{
      provider: 'claude',
      source: 'local statusLine/hook state',
      sevenDay: { usedPercentage: 100, resetsAtEpochSeconds: sevenDayReset },
      fiveHour: { usedPercentage: 2, resetsAtEpochSeconds: fiveHourReset }
    }], opts);

    assert.ok(result.tooltip.includes('blocked'), 'blocked indicator present');
    assert.ok(result.tooltip.includes('#F44336'), 'blocked 5h row uses critical color');
    assert.ok(!result.tooltip.includes('#4CAF50'), 'blocked 5h row does not use normal color');
  }

  console.log('status tooltip smoke passed');
}

main();
