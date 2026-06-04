#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

const {
  parseRemoteSourceId,
  getDisplayAlias,
  formatSourceLabel,
  formatStatusBarTooltipSuffix,
  parsePerWindowReset
} = require('../out/snapshot/remoteSourceHelper.js');
const { formatCountdown } = require('../out/usageTime.js');
const {
  buildSelectedRemoteSourceProviders,
  snapshotProviderToDashboardProvider
} = require('../out/snapshot/readMachineSnapshots.js');
const { formatStatus, formatRemoteProviderTooltip } = require('../out/display/format.js');

function makeSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    writerVersion: '0.7.0',
    generatedAtEpochMs: Date.now(),
    machineLabel: 'desktop',
    providerUsage: [{
      provider: 'claude',
      sourceLabel: 'Claude',
      fiveHourUsedPercent: 30,
      sevenDayUsedPercent: 60,
      fiveHourResetAtEpochSeconds: 1_800_000_000,
      sevenDayResetAtEpochSeconds: 1_900_000_000,
      lastUpdatedEpochMs: Date.now(),
      stale: false,
      source: 'authenticated',
      sourceConfidence: 'quotaState'
    }],
    ...overrides
  };
}

function baseFormatOptions() {
  return {
    displayMode: 'compact',
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
    statusMode: 'remaining'
  };
}

function makeLocalState(provider, usedPercent) {
  return {
    provider,
    source: `local ${provider}`,
    sevenDay: { usedPercentage: usedPercent },
    fiveHour: { usedPercentage: usedPercent + 5 }
  };
}

function makeRemoteItem(provider, label, withQuotaData = true) {
  const item = {
    provider,
    text: `${label} 🟢70%`,
    tooltip: `## ${label} Quota\n\n**Source:** Snapshot-backed · 5m ago`,
    severity: 'normal'
  };
  if (withQuotaData) {
    item.remoteQuotaData = {
      label,
      sevenDayRemainingPercent: 80,
      fiveHourRemainingPercent: 70,
      stale: false,
      snapshotAgeLabel: '5m'
    };
  }
  return item;
}

{
  assert.deepEqual(parseRemoteSourceId('vm-source/claude'), { machineLabel: 'vm-source', provider: 'claude' });
  assert.equal(parseRemoteSourceId('bad'), undefined);
  assert.equal(parseRemoteSourceId('/claude'), undefined);
  assert.equal(parseRemoteSourceId('vm-source/gpt'), undefined);
  console.log('parseRemoteSourceId: PASS');
}

{
  assert.equal(getDisplayAlias('vm-source', { 'vm-source': 'VM' }), 'VM');
  assert.equal(getDisplayAlias('vm-source', {}), 'vm-source');
  assert.equal(formatSourceLabel('codex', 'vm-source', { 'vm-source': 'VM' }), 'Codex VM');
  assert.equal(formatSourceLabel('claude', 'vm-source', { 'vm-source': 'VM' }), 'Claude VM');
  console.log('remote source alias/label helpers: PASS');
}

{
  assert.ok(formatStatusBarTooltipSuffix(true, 'Snapshot is stale').includes('stale'));
  assert.ok(formatStatusBarTooltipSuffix(false, undefined, Date.now() - 60000).includes('1m'));
  assert.ok(formatStatusBarTooltipSuffix(false).includes('snapshot-backed'));
  console.log('formatStatusBarTooltipSuffix: PASS');
}

{
  const snapshots = [{
    snapshot: makeSnapshot({
      machineLabel: 'vm-source',
      providerUsage: [{
        provider: 'codex',
        sourceLabel: 'Codex',
        fiveHourUsedPercent: 10,
        sevenDayUsedPercent: 20,
        fiveHourResetAtEpochSeconds: 1_800_000_000,
        sevenDayResetAtEpochSeconds: 1_900_000_000,
        lastUpdatedEpochMs: Date.now(),
        stale: false,
        source: 'authenticated',
        sourceConfidence: 'quotaState'
      }]
    }),
    filePath: '/tmp/vm-source-latest.json',
    stale: false
  }];
  assert.equal(buildSelectedRemoteSourceProviders(snapshots, new Set(), {}).length, 0);
  const providers = buildSelectedRemoteSourceProviders(snapshots, new Set(['vm-source/codex']), { 'vm-source': 'VM' });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].label, 'Codex VM');
  console.log('selected remote source providers: PASS');
}

{
  const dp = snapshotProviderToDashboardProvider(makeSnapshot().providerUsage[0], 'my-machine');
  assert.equal(dp.windows[0].key, 'sevenDay');
  assert.equal(dp.windows[1].key, 'fiveHour');
  assert.equal(dp.windows.find(w => w.key === 'sevenDay').resetIso, new Date(1_900_000_000 * 1000).toISOString());
  assert.equal(dp.windows.find(w => w.key === 'fiveHour').resetIso, new Date(1_800_000_000 * 1000).toISOString());
  console.log('remote provider card uses direct reset fields and 7d/5h order: PASS');
}

{
  const localClaude = makeLocalState('claude', 30);
  const localCodex = makeLocalState('codex', 40);
  const remoteCodex = makeRemoteItem('codex', 'VM Codex');
  const result = formatStatus([localClaude, localCodex], baseFormatOptions(), [remoteCodex]);
  assert.equal(result.providers.length, 2);
  assert.ok(result.text.includes('VM Codex'));
  assert.ok(result.tooltip.includes('| VM Codex |'));
  assert.ok(!result.providers.some(p => p.text.includes('VM')));
  console.log('formatStatus keeps local providers separate and includes remote quota row: PASS');
}

{
  const future4d = Math.floor((Date.now() + (4 * 24 + 6) * 60 * 60 * 1000) / 1000);
  const future3h = Math.floor((Date.now() + (3 * 60 + 3) * 60 * 1000) / 1000);
  assert.match(formatCountdown(future4d), /^\d+d$/);
  assert.match(formatCountdown(future3h), /^\d+h$/);
  assert.equal(formatCountdown(undefined), '?');
  assert.equal(formatCountdown(1), '?');
  console.log('formatCountdown: PASS');
}

{
  const sevenDayResetEpoch = Math.floor((Date.now() + (6 * 24 + 4) * 60 * 60 * 1000) / 1000);
  const fiveHourResetEpoch = Math.floor((Date.now() + (2 * 60 + 30) * 60 * 1000) / 1000);
  const resets = parsePerWindowReset(sevenDayResetEpoch, fiveHourResetEpoch);
  assert.equal(resets.sevenDayResetEpoch, sevenDayResetEpoch);
  assert.equal(resets.fiveHourResetEpoch, fiveHourResetEpoch);
  assert.equal(resets.hasPerWindowReset, true);
  assert.notEqual(formatCountdown(resets.sevenDayResetEpoch), formatCountdown(resets.fiveHourResetEpoch));
  console.log('direct per-window reset parsing for countdown: PASS');
}

{
  const result = formatRemoteProviderTooltip({
    label: 'VM Codex',
    provider: 'codex',
    sevenDayRemainingPercent: 80,
    fiveHourRemainingPercent: 70,
    sevenDayResetEpochSeconds: Math.floor((Date.now() + (4 * 24 + 6) * 3600) / 1000),
    fiveHourResetEpochSeconds: Math.floor((Date.now() + 150 * 60) / 1000),
    stale: false,
    snapshotAgeLabel: '5m',
    snapshotEpochMs: Date.now() - 5 * 60000,
    modelContributions: [{
      model: 'gpt-5.5',
      tokens: 10000,
      inputTokens: 6000,
      outputTokens: 3000,
      cacheCreationTokens: 750,
      cacheReadTokens: 250,
      assistantMessages: 5
    }]
  });
  assert.ok(result.startsWith('## VM Codex Quota'));
  assert.ok(result.includes('| 7d |'));
  assert.ok(result.includes('| 5h |'));
  assert.ok(result.includes('**Models**'));
  assert.ok(result.includes('gpt-5.5'));
  assert.ok(result.includes('API est.'));
  assert.ok(!result.includes('Remote API estimates excluded'));
  assert.ok(!result.includes('API estimate unavailable'));
  console.log('formatRemoteProviderTooltip renders remote model rows with computed API estimates: PASS');
}

{
  const staleResult = formatRemoteProviderTooltip({
    label: 'VM Codex',
    provider: 'codex',
    sevenDayRemainingPercent: 80,
    fiveHourRemainingPercent: 70,
    stale: true,
    staleReason: 'Provider stale',
    snapshotAgeLabel: '3h',
    snapshotEpochMs: Date.now() - 3 * 3600000,
    modelContributions: [{ model: 'gpt-5.5', tokens: 5000, assistantMessages: 2 }]
  });
  assert.ok(!staleResult.includes('**Models**'));
  assert.ok(staleResult.includes('stale'));
  console.log('formatRemoteProviderTooltip omits stale remote model rows: PASS');
}

console.log('\nAll remote sources smoke tests passed.');
