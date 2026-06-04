import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfiguredSourcesFromInspection,
  resolveSourcesFromRaw,
  getEnabledProvidersFromSources,
  getSnapshotSourcesFromSources
} from '../configSources';
import type { SourceConfigEntry } from '../types';

describe('source config normalization', () => {
  it('returns known provider defaults when no sources configured', () => {
    const result = resolveSourcesFromRaw(undefined);
    assert.equal(Object.keys(result).length, 2);
    assert.ok(result.claude);
    assert.ok(result.codex);
    assert.equal(result.claude.enabled, true);
    assert.equal(result.claude.label, 'Claude');
    assert.equal(result.claude.shortLabel, 'C');
    assert.equal(result.claude.statusBar, true);
    assert.equal(result.codex.label, 'Codex');
    assert.equal(result.codex.shortLabel, 'X');
  });

  it('returns known provider defaults when empty sources configured', () => {
    const result = resolveSourcesFromRaw({});
    assert.equal(Object.keys(result).length, 2);
    assert.equal(result.claude.label, 'Claude');
    assert.equal(result.codex.label, 'Codex');
  });

  it('absorbs custom source configuration', () => {
    const raw = {
      claude: { enabled: true, label: 'My Claude', shortLabel: 'MC', statusBar: false },
      codex: { enabled: false }
    };
    const result = resolveSourcesFromRaw(raw);
    assert.equal(result.claude.label, 'My Claude');
    assert.equal(result.claude.shortLabel, 'MC');
    assert.equal(result.claude.statusBar, false);
    assert.equal(result.codex.enabled, false);
    assert.equal(result.codex.label, 'Codex'); // default fallback
    assert.equal(result.codex.shortLabel, 'X'); // default fallback
  });

  it('does not synthesize omitted known providers for explicit sources', () => {
    const result = resolveSourcesFromRaw({
      codex: { enabled: true }
    });
    assert.deepEqual(Object.keys(result), ['codex']);
    assert.equal(result.codex.label, 'Codex');
    assert.equal(result.codex.shortLabel, 'X');
    assert.equal(result.claude, undefined);
  });

  it('keeps explicit local and snapshot sources without adding omitted locals', () => {
    const result = resolveSourcesFromRaw({
      codex: { enabled: true },
      'PHOENIX/claude': { enabled: true, label: 'ClaudeP', shortLabel: 'CP', statusBar: true }
    });
    assert.deepEqual(Object.keys(result), ['codex', 'PHOENIX/claude']);
    assert.equal(result.codex.label, 'Codex');
    assert.equal(result['PHOENIX/claude'].shortLabel, 'CP');
    assert.equal(result.claude, undefined);
  });

  it('adds snapshot sources alongside known providers', () => {
    const raw = {
      claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true },
      'WATCHER/codex': { enabled: true, label: 'Codex · WATCHER', shortLabel: 'XW', statusBar: true }
    };
    const result = resolveSourcesFromRaw(raw);
    assert.equal(Object.keys(result).length, 3);
    assert.equal(result['WATCHER/codex'].label, 'Codex · WATCHER');
    assert.equal(result['WATCHER/codex'].shortLabel, 'XW');
    assert.equal(result['WATCHER/codex'].statusBar, true);
  });

  it('applies partial overrides with defaults for missing fields', () => {
    const raw = {
      claude: { enabled: true, label: '' } as Partial<SourceConfigEntry>,
      codex: { enabled: false }
    };
    const result = resolveSourcesFromRaw(raw);
    assert.equal(result.claude.enabled, true);
    assert.equal(result.claude.label, 'Claude'); // default
    assert.equal(result.claude.shortLabel, 'C'); // default
  });
});

describe('source config inspection', () => {
  it('ignores extension defaults when explicit sources are configured', () => {
    const result = resolveConfiguredSourcesFromInspection({
      defaultValue: {
        claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
        codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true }
      },
      workspaceValue: {
        codex: { enabled: true }
      }
    });
    assert.deepEqual(result, {
      codex: { enabled: true }
    });
  });

  it('returns undefined when no explicit sources are configured', () => {
    const result = resolveConfiguredSourcesFromInspection({
      defaultValue: {
        claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
        codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true }
      }
    });
    assert.equal(result, undefined);
  });
});

describe('getEnabledProvidersFromSources', () => {
  it('returns only enabled local providers', () => {
    const sources: Record<string, SourceConfigEntry> = {
      claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: false, label: 'Codex', shortLabel: 'X', statusBar: true },
      'WATCHER/codex': { enabled: true, label: 'Codex · W', shortLabel: 'XW', statusBar: true }
    };
    const result = getEnabledProvidersFromSources(sources);
    assert.deepEqual(result, ['claude']);
  });

  it('returns all enabled local providers', () => {
    const sources: Record<string, SourceConfigEntry> = {
      claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true }
    };
    const result = getEnabledProvidersFromSources(sources);
    assert.deepEqual(result, ['claude', 'codex']);
  });

  it('returns empty when all local providers disabled', () => {
    const sources: Record<string, SourceConfigEntry> = {
      claude: { enabled: false, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: false, label: 'Codex', shortLabel: 'X', statusBar: true }
    };
    const result = getEnabledProvidersFromSources(sources);
    assert.deepEqual(result, []);
  });

  it('returns only explicitly configured enabled local providers', () => {
    const sources = resolveSourcesFromRaw({
      codex: { enabled: true },
      'PHOENIX/claude': { enabled: true, label: 'ClaudeP', shortLabel: 'CP', statusBar: true }
    });
    const result = getEnabledProvidersFromSources(sources);
    assert.deepEqual(result, ['codex']);
  });

  it('does not return imported snapshot sources as local providers', () => {
    const sources = resolveSourcesFromRaw({
      'PHOENIX/claude': { enabled: true, label: 'ClaudeP', shortLabel: 'CP', statusBar: true },
      'PHOENIX/codex': { enabled: true, label: 'CodexP', shortLabel: 'XP', statusBar: true }
    });
    const result = getEnabledProvidersFromSources(sources);
    assert.deepEqual(result, []);
  });
});

describe('getSnapshotSourcesFromSources', () => {
  it('returns empty when no snapshot sources', () => {
    const sources: Record<string, SourceConfigEntry> = {
      claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true }
    };
    const result = getSnapshotSourcesFromSources(sources);
    assert.deepEqual(result.remoteSources, []);
    assert.deepEqual(result.statusBarSources, []);
    assert.deepEqual(result.remoteMachineLabels, {});
  });

  it('categorizes snapshot sources by enabled and statusBar', () => {
    const sources: Record<string, SourceConfigEntry> = {
      claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
      codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true },
      'WATCHER/codex': { enabled: true, label: 'Codex · W', shortLabel: 'XW', statusBar: true },
      'WATCHER/claude': { enabled: true, label: 'Claude · W', shortLabel: 'CW', statusBar: false },
      'DISABLED/codex': { enabled: false, label: 'Disabled', shortLabel: 'D', statusBar: true }
    };
    const result = getSnapshotSourcesFromSources(sources);
    assert.deepEqual(result.remoteSources, ['WATCHER/codex', 'WATCHER/claude']);
    assert.deepEqual(result.statusBarSources, ['WATCHER/codex']);
    assert.deepEqual(result.remoteMachineLabels, {
      WATCHER: 'WATCHER'
    });
  });
});
