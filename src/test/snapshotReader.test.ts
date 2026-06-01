import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readMachineSnapshots,
  snapshotProviderToDashboardProvider,
  buildRemoteProvidersFromSnapshots,
  buildSelectedRemoteSourceProviders,
  buildSanitizedHistorySources,
  resolveRemoteResetEpoch,
  SNAPSHOT_STALE_THRESHOLD_MS
} from '../snapshot/readMachineSnapshots';
import {
  parseRemoteSourceId,
  getDisplayAlias,
  formatSourceLabel,
  formatStatusBarTooltipSuffix
} from '../snapshot/remoteSourceHelper';
import { buildRemoteUsageProjection } from '../snapshot/remoteUsageProjection';
import { SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION, SNAPSHOT_SCHEMA_V2, SNAPSHOT_SCHEMA_V3, SNAPSHOT_SCHEMA_V4 } from '../snapshot/types';
import type { PromptFuelMachineSnapshotV2, PromptFuelSnapshotHistoryArchiveMonth, SnapshotHistoryBucket } from '../snapshot/types';

let tmpDir: string;

const TODAY_KEY = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();

function makeSnapshot(overrides: Partial<PromptFuelMachineSnapshotV2> = {}): PromptFuelMachineSnapshotV2 {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_V4,
    writerVersion: '0.6.0',
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
      sourceConfidence: 'quotaState',
      historyBuckets: [{
        dateKey: TODAY_KEY,
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 250,
        cacheReadTokens: 100,
        reasoningOutputTokens: 75,
        messages: 2,
        turns: 1,
        models: [{
          model: 'claude-sonnet-4-20250514',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 250,
          cacheReadTokens: 100,
          reasoningOutputTokens: 75,
          messages: 2,
          turns: 1
        }]
      }]
    }],
    ...overrides
  };
}

function makeNonCurrentSnapshot(): any {
  const snap = makeSnapshot() as any;
  snap.schemaVersion = 1;
  return snap;
}

async function writeLatest(fileName: string, payload: unknown): Promise<void> {
  await fs.writeFile(path.join(tmpDir, fileName), JSON.stringify(payload, null, 2), 'utf-8');
}

async function writeArchive(
  rootDir: string,
  machineLabel: string,
  month: string,
  providers: PromptFuelSnapshotHistoryArchiveMonth['providers']
): Promise<void> {
  const [year, monthPart] = month.split('-');
  assert.ok(year);
  assert.ok(monthPart);
  const archive: PromptFuelSnapshotHistoryArchiveMonth = {
    schemaVersion: SNAPSHOT_SCHEMA_V4,
    archiveSchemaVersion: SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION,
    writerVersion: '0.6.0',
    generatedAtEpochMs: Date.now(),
    machineLabel,
    month,
    providers,
  };
  const archiveDir = path.join(rootDir, 'archive', machineLabel);
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.writeFile(path.join(archiveDir, `${year}-${monthPart}.json`), JSON.stringify(archive, null, 2), 'utf-8');
}

function historyProvider(
  provider: 'claude' | 'codex',
  buckets: SnapshotHistoryBucket[]
): PromptFuelSnapshotHistoryArchiveMonth['providers'][number] {
  return { provider, historyBuckets: buckets };
}

describe('snapshotReader', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-reader-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readMachineSnapshots', () => {
    beforeEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
    });

    it('returns empty when disabled, unconfigured, or missing', async () => {
      assert.deepEqual(await readMachineSnapshots({ readEnabled: false, readPath: tmpDir }), { snapshots: [], errors: [] });
      assert.deepEqual(await readMachineSnapshots({ readEnabled: true, readPath: '' }), { snapshots: [], errors: [] });
      assert.deepEqual(await readMachineSnapshots({ readEnabled: true, readPath: path.join(tmpDir, 'missing') }), { snapshots: [], errors: [] });
    });

    it('reads valid current snapshots with direct reset fields', async () => {
      await writeLatest('V2MACHINE-latest.json', makeSnapshot({ machineLabel: 'V2MACHINE' }));

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      const entry = result.snapshots.find(s => s.snapshot.machineLabel === 'V2MACHINE');
      assert.ok(entry);
      const provider = entry.snapshot.providerUsage?.[0] as unknown as Record<string, unknown>;
      assert.equal(provider.fiveHourResetAtEpochSeconds, 1_800_000_000);
      assert.equal(provider.sevenDayResetAtEpochSeconds, 1_900_000_000);
      assert.equal(provider.windowResetMeta, undefined);
      assert.equal(provider.resetAtEpochSeconds, undefined);
      assert.equal(provider.todaySummary, undefined);
      assert.equal(provider.modelContribution, undefined);
      assert.ok(entry.snapshot.providerUsage?.[0]?.historyBuckets);
    });

    it('rejects non-current schema snapshot files', async () => {
      await writeLatest('old-schema-latest.json', makeNonCurrentSnapshot());

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      assert.equal(result.snapshots.find(s => s.filePath.includes('old-schema')), undefined);
      assert.ok(result.errors.some(error => error.filePath.includes('old-schema-latest.json')));
    });

    it('rejects current-schema snapshots containing removed provider fields', async () => {
      for (const field of ['model', 'resetAtEpochSeconds', 'windowResetMeta', 'todaySummary', 'modelContribution']) {
        const snap = makeSnapshot() as any;
        snap.machineLabel = `BAD_${field}`;
        snap.providerUsage[0][field] = field === 'windowResetMeta'
          ? { fiveHourResetAtEpochSeconds: 1_800_000_000 }
          : field === 'todaySummary'
            ? { inputTokens: 1 }
            : field === 'modelContribution'
              ? [{ model: 'gpt-5.5', tokens: 1 }]
              : field === 'model'
                ? 'gpt-5.5'
                : 1_800_000_000;
        await writeLatest(`bad-${field}-latest.json`, snap);
      }

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      for (const field of ['model', 'resetAtEpochSeconds', 'windowResetMeta', 'todaySummary', 'modelContribution']) {
        assert.equal(result.snapshots.find(s => s.filePath.includes(`bad-${field}`)), undefined, `${field} snapshot must be rejected`);
        assert.ok(result.errors.some(e => e.filePath.includes(`bad-${field}`)), `${field} snapshot must produce an error`);
      }
    });

    it('rejects V2 snapshots containing extra machine metadata fields during upgrade', async () => {
      for (const field of ['role', 'roleLabel']) {
        const snap: any = {
          schemaVersion: SNAPSHOT_SCHEMA_V2,
          generatedAtEpochMs: Date.now(),
          machine: { label: `BAD_MACHINE_${field}`, [field]: field === 'role' ? 'legacy-role' : 'legacy source' },
          providerUsage: [{
            provider: 'claude',
            laneLabel: 'Claude',
            stale: false,
            source: 'authenticated',
            sourceConfidence: 'quotaState'
          }],
          exportMeta: { extensionVersion: '0.4.38', schemaVersion: SNAPSHOT_SCHEMA_V2 }
        };
        await writeLatest(`bad-machine-${field}-latest.json`, snap);
      }

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      for (const field of ['role', 'roleLabel']) {
        assert.equal(result.snapshots.find(s => s.filePath.includes(`bad-machine-${field}`)), undefined);
        assert.ok(result.errors.some(e => e.filePath.includes(`bad-machine-${field}`)));
      }
    });

    it('rejects bucket model tokens and windowDays fields', async () => {
      for (const field of ['tokens', 'windowDays']) {
        const snap = makeSnapshot() as any;
        snap.machine = { label: `BAD_MODEL_${field}` };
        snap.providerUsage[0].historyBuckets[0].models[0][field] = 123;
        await writeLatest(`bad-model-${field}-latest.json`, snap);
      }

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      for (const field of ['tokens', 'windowDays']) {
        assert.equal(result.snapshots.find(s => s.filePath.includes(`bad-model-${field}`)), undefined);
        assert.ok(result.errors.some(e => e.filePath.includes(`bad-model-${field}`)));
      }
    });

    it('rejects forbidden exact and normalized sensitive field names', async () => {
      const cases: Array<[string, (snap: any) => void]> = [
        ['bad-exact-token', snap => { snap.token = 'redacted'; }],
        ['bad-session', snap => { snap.sessionId = 'sess_secret123'; }],
        ['bad-token-like', snap => { snap.sessionToken = 'redacted'; }],
        ['bad-credential', snap => { snap.userCredential = 'redacted'; }],
        ['bad-secret', snap => { snap.apiSecret = 'redacted'; }],
        ['bad-password', snap => { snap.userPassword = 'redacted'; }],
        ['bad-auth', snap => { snap.apiKey = 'redacted'; }],
        ['bad-prompt', snap => { snap.promptText = 'redacted'; }],
        ['bad-response', snap => { snap.responseBody = 'redacted'; }],
        ['bad-transcript', snap => { snap.transcriptPath = '/Users/example/transcript.jsonl'; }],
        ['bad-session-like', snap => { snap.sessionContext = 'redacted'; }],
        ['bad-workspace', snap => { snap.workspaceRoot = '/Users/example/project'; }],
        ['bad-cwd', snap => { snap.cwdPath = '/Users/example/project'; }],
        ['bad-payload', snap => { snap.providerPayload = { safeLooking: true }; }],
        ['bad-provider-payload', snap => { snap.providerPayloadData = { safeLooking: true }; }],
        ['bad-raw-payload', snap => { snap.rawPayloadBlob = { safeLooking: true }; }]
      ];

      for (const [name, mutate] of cases) {
        const snap = makeSnapshot() as any;
        mutate(snap);
        await writeLatest(`${name}-latest.json`, snap);
      }

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });
      for (const [name] of cases) {
        assert.equal(result.snapshots.find(s => s.filePath.includes(name)), undefined);
        assert.ok(result.errors.some(e => e.filePath.includes(name)));
      }
    });

    it('marks stale snapshots based on age threshold', async () => {
      const staleTime = Date.now() - SNAPSHOT_STALE_THRESHOLD_MS - 60000;
      await writeLatest('STALE-latest.json', makeSnapshot({ generatedAtEpochMs: staleTime, machineLabel: 'STALE' }));

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });
      const staleEntry = result.snapshots.find(s => s.snapshot.machineLabel === 'STALE');
      assert.ok(staleEntry);
      assert.equal(staleEntry.stale, true);
    });
  });

  describe('v2 history projection', () => {
    it('sanitized sources expose historyBuckets and direct reset fields only', () => {
      const sources = buildSanitizedHistorySources([{
        snapshot: makeSnapshot(),
        filePath: path.join(tmpDir, 'V2MACHINE-latest.json'),
        stale: false
      }]);

      assert.equal(sources.length, 1);
      assert.equal(sources[0].quotaOnly, false);
      assert.equal(sources[0].schemaVersion, SNAPSHOT_SCHEMA_V4);
      assert.equal(sources[0].fiveHourResetAtEpochSeconds, 1_800_000_000);
      assert.equal(sources[0].sevenDayResetAtEpochSeconds, 1_900_000_000);
      assert.equal(sources[0].historyBuckets?.[0]?.models?.[0]?.model, 'claude-sonnet-4-20250514');
      assert.equal(sources[0].historyBuckets?.[0]?.models?.[0]?.inputTokens, 1000);
      assert.equal((sources[0] as any).todaySummary, undefined);
      assert.equal((sources[0] as any).modelContribution, undefined);
      assert.equal((sources[0] as any).windowResetMeta, undefined);
    });

    it('remote projection derives Today and model rows from historyBuckets', () => {
      const sources = buildSanitizedHistorySources([{
        snapshot: makeSnapshot({ machineLabel: 'vm-source' }),
        filePath: path.join(tmpDir, 'vm-source-latest.json'),
        stale: false
      }]);

      const projection = buildRemoteUsageProjection(sources, new Set(['vm-source/claude']));

      assert.equal(projection.claudeToday?.inputTokens, 1000);
      assert.equal(projection.claudeToday?.outputTokens, 500);
      assert.equal(projection.claudeToday?.cacheCreationTokens, 250);
      assert.equal(projection.claudeToday?.cacheReadTokens, 100);
      assert.equal(projection.claudeModelEntries[0].model, 'claude-sonnet-4-20250514');
      assert.equal(projection.claudeModelEntries[0].tokens, 1850);
      assert.equal(projection.claudeModelEntries[0].assistantMessages, 2);
    });

    it('stale source still exposes payload but projection excludes it', () => {
      const sources = buildSanitizedHistorySources([{
        snapshot: makeSnapshot(),
        filePath: path.join(tmpDir, 'STALE-latest.json'),
        stale: true
      }]);

      assert.equal(sources[0].stale, true);
      assert.ok(sources[0].historyBuckets);
      const projection = buildRemoteUsageProjection(sources, new Set(['desktop/claude']));
      assert.equal(projection.claudeToday, undefined);
      assert.equal(projection.claudeModelEntries.length, 0);
    });

    it('loads archive and latest sources without double-counting overlapping buckets', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-reader-archive-dedupe-'));
      try {
        await writeArchive(rootDir, 'vm-source', '2026-05', [
          historyProvider('claude', [{
            dateKey: '2026-05-19',
            inputTokens: 1000,
            outputTokens: 200,
            models: [{
              model: 'claude-sonnet-4-20250514',
              inputTokens: 1000,
              outputTokens: 200
            }]
          }])
        ]);
        const latest = makeSnapshot({
          machineLabel: 'vm-source',
          providerUsage: [{
            provider: 'claude',
            sourceLabel: 'Claude',
            fiveHourUsedPercent: 30,
            sevenDayUsedPercent: 60,
            lastUpdatedEpochMs: Date.now(),
            stale: false,
            source: 'authenticated',
            sourceConfidence: 'quotaState',
            historyBuckets: [{
              dateKey: '2026-05-19',
              inputTokens: 1200,
              outputTokens: 300,
              models: [{
                model: 'claude-sonnet-4-20250514',
                inputTokens: 1200,
                outputTokens: 300
              }]
            }]
          }]
        });
        await fs.writeFile(path.join(rootDir, 'vm-source-latest.json'), JSON.stringify(latest, null, 2), 'utf-8');

        const result = await readMachineSnapshots({ readEnabled: true, readPath: rootDir });
        const sources = [...(result.archiveSources ?? []), ...buildSanitizedHistorySources(result.snapshots)];
        const projection = buildRemoteUsageProjection(sources, new Set(['vm-source/claude']));
        const overlapPoints = projection.claudeHistoryPoints.filter(point => point.dateKey === '2026-05-19');

        assert.equal(result.archiveSources?.length, 1);
        assert.equal(overlapPoints.length, 1);
        assert.equal(overlapPoints[0].totalTokens, 1500);
        assert.equal(projection.claudeModelEntries[0].tokens, 1500);
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });

    it('rejects archive months containing removed machine metadata fields', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-reader-archive-machine-fields-'));
      try {
        await writeArchive(rootDir, 'vm-source', '2026-05', [
          historyProvider('claude', [{
            dateKey: '2026-05-19',
            inputTokens: 1000,
            outputTokens: 200
          }])
        ]);
        const archivePath = path.join(rootDir, 'archive', 'vm-source', '2026-05.json');
        const archive = JSON.parse(await fs.readFile(archivePath, 'utf-8'));
        // Simulate a V2 archive with extra machine metadata field (should be rejected)
        delete archive.machineLabel;
        delete archive.writerVersion;
        archive.machine = { label: 'vm-source', roleLabel: 'legacy source' };
        archive.schemaVersion = SNAPSHOT_SCHEMA_V2;
        archive.exportMeta = {
          extensionVersion: '0.4.45',
          schemaVersion: SNAPSHOT_SCHEMA_V2,
          includeHistoryBuckets: true,
          exportKind: 'historyBucketsArchive',
          archiveSchemaVersion: SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION
        };
        await fs.writeFile(archivePath, JSON.stringify(archive, null, 2), 'utf-8');

        const result = await readMachineSnapshots({ readEnabled: true, readPath: rootDir });

        assert.equal(result.archiveSources, undefined);
        assert.ok(result.errors.some(error => error.filePath.endsWith('2026-05.json')));
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });

    it('archive months still supply dashboard history when latest is bounded to recent buckets', async () => {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-reader-archive-bounded-'));
      try {
        await writeArchive(rootDir, 'vm-source', '2026-04', [
          historyProvider('codex', [{
            dateKey: '2026-04-15',
            inputTokens: 400,
            outputTokens: 100,
            reasoningOutputTokens: 25,
            turns: 1,
            models: [{
              model: 'gpt-5.5',
              inputTokens: 400,
              outputTokens: 100,
              reasoningOutputTokens: 25,
              turns: 1
            }]
          }])
        ]);
        const latest = makeSnapshot({
          machineLabel: 'vm-source',
          providerUsage: [{
            provider: 'codex',
            sourceLabel: 'Codex',
            fiveHourUsedPercent: 30,
            sevenDayUsedPercent: 60,
            lastUpdatedEpochMs: Date.now(),
            stale: false,
            source: 'authenticated',
            sourceConfidence: 'quotaState',
            historyBuckets: [{
              dateKey: '2026-05-20',
              inputTokens: 100,
              outputTokens: 50,
              turns: 1,
              models: [{
                model: 'gpt-5.5',
                inputTokens: 100,
                outputTokens: 50,
                turns: 1
              }]
            }]
          }]
        });
        await fs.writeFile(path.join(rootDir, 'vm-source-latest.json'), JSON.stringify(latest, null, 2), 'utf-8');

        const result = await readMachineSnapshots({ readEnabled: true, readPath: rootDir });
        const sources = [...(result.archiveSources ?? []), ...buildSanitizedHistorySources(result.snapshots)];
        const projection = buildRemoteUsageProjection(sources, new Set(['vm-source/codex']));

        assert.deepEqual(projection.codexHistoryPoints.map(point => point.dateKey), ['2026-04-15', '2026-05-20']);
        assert.equal(projection.codexHistoryPoints[0].totalTokens, 500);
        assert.equal(projection.codexHistoryPoints[1].totalTokens, 150);
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    });
  });

  describe('per-window reset metadata', () => {
    it('resolves direct reset epochs from current provider fields', () => {
      const snapProvider = makeSnapshot().providerUsage?.[0];
      assert.ok(snapProvider);

      assert.equal(resolveRemoteResetEpoch(snapProvider, 'sevenDay'), 1_900_000_000);
      assert.equal(resolveRemoteResetEpoch(snapProvider, 'fiveHour'), 1_800_000_000);
    });
  });

  describe('snapshotProviderToDashboardProvider', () => {
    it('maps snapshot provider and reset countdown fields to dashboard windows', () => {
      const snapProvider = makeSnapshot().providerUsage?.[0];
      assert.ok(snapProvider);

      const dp = snapshotProviderToDashboardProvider(snapProvider, 'desktop');

      assert.equal(dp.provider, 'claude');
      assert.equal(dp.label, 'Claude');
      assert.equal(dp.machineLabel, 'desktop');
      assert.equal(dp.stale, false);
      assert.equal(dp.windows.find(w => w.key === 'fiveHour')?.resetIso, new Date(1_800_000_000 * 1000).toISOString());
      assert.equal(dp.windows.find(w => w.key === 'sevenDay')?.resetIso, new Date(1_900_000_000 * 1000).toISOString());
    });

    it('marks provider stale when containing snapshot file is stale', () => {
      const dp = snapshotProviderToDashboardProvider({
        provider: 'codex',
        sourceLabel: 'Codex',
        stale: false,
        source: 'localSession',
        sourceConfidence: 'apiEquivalentEstimate'
      }, 'vm-source', true);

      assert.equal(dp.provider, 'codex');
      assert.equal(dp.stale, true);
      assert.ok(dp.source?.includes('stale snapshot'));
    });
  });

  describe('remote provider grouping', () => {
    it('builds grouped remote providers and selected source providers', () => {
      const snapshots = [{
        snapshot: makeSnapshot({ machineLabel: 'desktop' }),
        filePath: path.join(tmpDir, 'desktop-latest.json'),
        stale: false
      }, {
        snapshot: makeSnapshot({
          machineLabel: 'workstation',
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
        filePath: path.join(tmpDir, 'workstation-latest.json'),
        stale: false
      }];

      const groups = buildRemoteProvidersFromSnapshots(snapshots);
      assert.equal(groups.length, 2);
      assert.equal(groups[0].providers[0].label, 'Claude');

      const selected = buildSelectedRemoteSourceProviders(snapshots, new Set(['workstation/codex']), { workstation: 'Server' });
      assert.equal(selected.length, 1);
      assert.equal(selected[0].label, 'Codex Server');
    });
  });

  describe('remote source helpers', () => {
    it('parses source ids and formats labels', () => {
      assert.deepEqual(parseRemoteSourceId('vm-source/claude'), { machineLabel: 'vm-source', provider: 'claude' });
      assert.deepEqual(parseRemoteSourceId('vm-source/codex'), { machineLabel: 'vm-source', provider: 'codex' });
      assert.equal(parseRemoteSourceId('vm-source/gpt'), undefined);
      assert.equal(getDisplayAlias('vm-source', { 'vm-source': 'VM' }), 'VM');
      assert.equal(formatSourceLabel('claude', 'vm-source', { 'vm-source': 'VM' }), 'Claude VM');
      assert.equal(formatSourceLabel('codex', 'vm-source', { 'vm-source': 'VM' }), 'Codex VM');
    });

    it('formats snapshot stale tooltip suffixes', () => {
      assert.match(formatStatusBarTooltipSuffix(true, 'Snapshot is 15 minutes old'), /Snapshot stale/);
      assert.match(formatStatusBarTooltipSuffix(true), /stale/);
      assert.match(formatStatusBarTooltipSuffix(false, undefined, Date.now() - 120_000), /2m old/);
    });
  });
});
