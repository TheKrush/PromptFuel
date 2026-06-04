import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, type FormatOptions } from '../display/format';
import { getEnabledProvidersFromSources, resolveSourcesFromRaw } from '../configSources';
import { buildRemoteStatusBarItems } from '../statusBarBuild';
import type { ValidatedSnapshot } from '../snapshot/readMachineSnapshots';
import type { ProviderUsageState } from '../types';

function makeSnapshot(
  machineLabel = 'WATCHER',
  provider: 'claude' | 'codex' = 'codex',
  sevenDayUsedPercent = 35,
  fiveHourUsedPercent = 100
): ValidatedSnapshot {
  return {
    snapshot: {
      schemaVersion: 1,
      writerVersion: '0.9.0',
      generatedAtEpochMs: Date.now(),
      machineLabel,
      providerUsage: [{
        provider,
        sourceLabel: 'Codex',
        sevenDayUsedPercent,
        fiveHourUsedPercent,
        sevenDayResetAtEpochSeconds: 1_900_000_000,
        fiveHourResetAtEpochSeconds: 1_800_000_000,
        lastUpdatedEpochMs: Date.now(),
        stale: false,
        source: 'authenticated',
        sourceConfidence: 'quotaState',
      }],
    },
    filePath: '/fake/snapshot.json',
    stale: false,
  };
}

const emptyAliasMap: Record<string, string> = {};

function compactOptions(): FormatOptions {
  return {
    displayMode: 'compact',
    statusMode: 'remaining'
  };
}

function makeLocalState(provider: 'claude' | 'codex', sevenDayUsedPercent: number, fiveHourUsedPercent: number): ProviderUsageState {
  return {
    provider,
    sevenDay: { usedPercentage: sevenDayUsedPercent },
    fiveHour: { usedPercentage: fiveHourUsedPercent }
  };
}

describe('buildRemoteStatusBarItems', () => {
  it('builds imported source quota data from normalizedSources in compact mode', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot('WATCHER', 'codex', 35, 78)],
      ['WATCHER/codex'],
      emptyAliasMap,
      'compact',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].provider, 'codex');
    assert.equal(items[0].severity, 'normal');
    assert.deepEqual(items[0].remoteQuotaData, {
      label: 'Codex \u00B7 WATCHER',
      sevenDayRemainingPercent: 65,
      fiveHourRemainingPercent: 22,
      sevenDayResetEpochSeconds: 1_900_000_000,
      fiveHourResetEpochSeconds: 1_800_000_000,
      stale: false,
      snapshotAgeLabel: items[0].remoteQuotaData?.snapshotAgeLabel
    });
  });

  it('builds imported source quota data from normalizedSources in standard mode', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot('WATCHER', 'codex', 35, 78)],
      ['WATCHER/codex'],
      emptyAliasMap,
      'standard',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].provider, 'codex');
    assert.equal(items[0].remoteQuotaData?.label, 'Codex \u00B7 WATCHER');
    assert.equal(items[0].remoteQuotaData?.sevenDayRemainingPercent, 65);
    assert.equal(items[0].remoteQuotaData?.fiveHourRemainingPercent, 22);
    assert.equal(items[0].remoteQuotaData?.sevenDayResetEpochSeconds, 1_900_000_000);
    assert.equal(items[0].remoteQuotaData?.fiveHourResetEpochSeconds, 1_800_000_000);
    assert.equal(items[0].remoteQuotaData?.stale, false);
  });

  it('uses fallback source label when sourceId is missing from normalizedSources', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot('WATCHER', 'codex', 35, 78)],
      ['WATCHER/codex'],
      { WATCHER: 'WatchTower' },
      'compact'
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].provider, 'codex');
    assert.equal(items[0].remoteQuotaData?.label, 'Codex WatchTower');
    assert.equal(items[0].remoteQuotaData?.sevenDayRemainingPercent, 65);
    assert.equal(items[0].remoteQuotaData?.fiveHourRemainingPercent, 22);
  });

  it('omits unselected imported sources', () => {
    const items = buildRemoteStatusBarItems(
      [
        makeSnapshot('WATCHER', 'codex', 35, 78),
        makeSnapshot('PHOENIX', 'codex', 31, 75)
      ],
      ['PHOENIX/codex'],
      emptyAliasMap,
      'compact',
      {
        'WATCHER/codex': { enabled: true, label: 'CodexW', shortLabel: 'XW', statusBar: true },
        'PHOENIX/codex': { enabled: true, label: 'CodexP', shortLabel: 'XP', statusBar: true }
      }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].remoteQuotaData?.label, 'CodexP');
    assert.equal(items[0].remoteQuotaData?.sevenDayRemainingPercent, 69);
    assert.equal(items[0].remoteQuotaData?.fiveHourRemainingPercent, 25);
  });

  it('keeps explicit local and imported sources separate', () => {
    const sources = resolveSourcesFromRaw({
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true },
      'PHOENIX/claude': { enabled: true, label: 'ClaudeP', shortLabel: 'CP', statusBar: true },
      'PHOENIX/codex': { enabled: true, label: 'CodexP', shortLabel: 'XP', statusBar: true }
    });
    const enabledProviders = getEnabledProvidersFromSources(sources);
    const localStates = enabledProviders.map(provider => makeLocalState(provider, 31, 0));
    const remoteItems = buildRemoteStatusBarItems(
      [
        makeSnapshot('PHOENIX', 'claude', 35, 78),
        makeSnapshot('PHOENIX', 'codex', 31, 75)
      ],
      ['PHOENIX/claude', 'PHOENIX/codex'],
      emptyAliasMap,
      'compact',
      sources
    );

    const result = formatStatus(localStates, { ...compactOptions(), normalizedSources: sources }, remoteItems);

    assert.deepEqual(enabledProviders, ['codex']);
    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider, 'codex');
    assert.equal(remoteItems.length, 2);
    assert.deepEqual(remoteItems.map(item => item.remoteQuotaData?.label), ['ClaudeP', 'CodexP']);
    assert.deepEqual(remoteItems.map(item => item.remoteQuotaData?.sevenDayRemainingPercent), [65, 69]);
    assert.deepEqual(remoteItems.map(item => item.remoteQuotaData?.fiveHourRemainingPercent), [22, 25]);
  });

  it('hides local sources with statusBar disabled while preserving imported status items', () => {
    const sources = resolveSourcesFromRaw({
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: false },
      'PHOENIX/codex': { enabled: true, label: 'CodexP', shortLabel: 'XP', statusBar: true }
    });
    const localStates = [makeLocalState('codex', 31, 0)];
    const remoteItems = buildRemoteStatusBarItems(
      [makeSnapshot('PHOENIX', 'codex', 31, 75)],
      ['PHOENIX/codex'],
      emptyAliasMap,
      'compact',
      sources
    );

    const result = formatStatus(localStates, { ...compactOptions(), normalizedSources: sources }, remoteItems);

    assert.equal(result.providers.length, 0);
    assert.equal(remoteItems.length, 1);
    assert.equal(remoteItems[0].provider, 'codex');
    assert.equal(remoteItems[0].remoteQuotaData?.label, 'CodexP');
    assert.equal(remoteItems[0].remoteQuotaData?.sevenDayRemainingPercent, 69);
    assert.equal(remoteItems[0].remoteQuotaData?.fiveHourRemainingPercent, 25);
  });

  it('preserves severity for stale imported snapshots', () => {
    const staleSnapshot = makeSnapshot('WATCHER', 'codex', 35, 78);
    staleSnapshot.stale = true;

    const items = buildRemoteStatusBarItems(
      [staleSnapshot],
      ['WATCHER/codex'],
      emptyAliasMap,
      'compact',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].provider, 'codex');
    assert.equal(items[0].severity, 'warning');
    assert.equal(items[0].remoteQuotaData?.stale, true);
  });
});