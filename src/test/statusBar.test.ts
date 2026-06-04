import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, quotaIndicatorForRemaining, type FormatOptions } from '../display/format';
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
  it('compact mode uses shortLabel from normalizedSources for imported source', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot()],
      ['WATCHER/codex'],
      emptyAliasMap,
      'compact',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );
    assert.equal(items.length, 1);
    assert.ok(items[0].text.startsWith('XW '), `expected "XW " prefix, got "${items[0].text}"`);
    assert.ok(!items[0].text.includes('Codex'), `should not contain "Codex", got "${items[0].text}"`);
  });

  it('compact mode joins related imported source percentages with per-window dots', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot('WATCHER', 'codex', 35, 78)],
      ['WATCHER/codex'],
      emptyAliasMap,
      'compact',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );
    const expected = `XW ${quotaIndicatorForRemaining(65)}65% \u00B7 ${quotaIndicatorForRemaining(22)}22%`;
    assert.equal(items.length, 1);
    assert.equal(items[0].text, expected);
    assert.ok(!items[0].text.includes('/'), `compact imported windows should not use slash, got "${items[0].text}"`);
    assert.ok(!items[0].text.includes(' | '), `should not split imported windows into separate providers, got "${items[0].text}"`);
  });

  it('standard mode uses label from normalizedSources for imported source', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot()],
      ['WATCHER/codex'],
      emptyAliasMap,
      'standard',
      { 'WATCHER/codex': { enabled: true, label: 'Codex \u00B7 WATCHER', shortLabel: 'XW', statusBar: true } }
    );
    assert.equal(items.length, 1);
    assert.ok(items[0].text.startsWith('Codex \u00B7 WATCHER '), `expected "Codex · WATCHER " prefix, got "${items[0].text}"`);
  });

  it('falls back to formatSourceLabel when sourceId missing from normalizedSources', () => {
    const items = buildRemoteStatusBarItems(
      [makeSnapshot()],
      ['WATCHER/codex'],
      { WATCHER: 'WatchTower' },
      'compact'
    );
    assert.equal(items.length, 1);
    assert.ok(items[0].text.startsWith('Codex WatchTower '), `expected fallback "Codex WatchTower " prefix, got "${items[0].text}"`);
  });

  it('compact status omits local providers missing from explicit sources', () => {
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
    assert.ok(!result.text.includes('C unavailable'), `should not render omitted local Claude, got "${result.text}"`);
    assert.ok(!result.text.includes('Claude unavailable'), `should not render omitted local Claude, got "${result.text}"`);
    assert.ok(result.text.startsWith(`X ${quotaIndicatorForRemaining(69)}69%`), `expected local Codex first, got "${result.text}"`);
    assert.ok(result.text.includes(`CP ${quotaIndicatorForRemaining(65)}65% \u00B7 ${quotaIndicatorForRemaining(22)}22%`), `expected PHOENIX Claude snapshot, got "${result.text}"`);
    assert.ok(result.text.includes(`XP ${quotaIndicatorForRemaining(69)}69% \u00B7 ${quotaIndicatorForRemaining(25)}25%`), `expected PHOENIX Codex snapshot, got "${result.text}"`);
  });

  it('compact status hides local sources with statusBar disabled', () => {
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

    assert.ok(!result.text.startsWith('X '), `local Codex should be hidden from status bar, got "${result.text}"`);
    assert.equal(result.text, `XP ${quotaIndicatorForRemaining(69)}69% \u00B7 ${quotaIndicatorForRemaining(25)}25%`);
  });
});
