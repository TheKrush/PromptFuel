import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quotaIndicatorForRemaining } from '../display/format';
import { buildRemoteStatusBarItems } from '../statusBarBuild';
import type { ValidatedSnapshot } from '../snapshot/readMachineSnapshots';

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
});
