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
import { SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION, SNAPSHOT_SCHEMA_V1 } from '../snapshot/types';
import type { PromptFuelMachineSnapshotV2, PromptFuelSnapshotHistoryArchiveMonth, SnapshotHistoryBucket } from '../snapshot/types';

let tmpDir: string;

const TODAY_KEY = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();

function makeSnapshot(overrides: Partial<PromptFuelMachineSnapshotV2> = {}): PromptFuelMachineSnapshotV2 {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_V1,
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
  snap.schemaVersion = 99;
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
    schemaVersion: SNAPSHOT_SCHEMA_V1,
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

    it('reads optional generic meters and keeps older snapshots without meters compatible', async () => {
      await writeLatest('WITH-METERS-latest.json', makeSnapshot({
        machineLabel: 'WITH-METERS',
        providerUsage: [{
          provider: 'claude',
          sourceLabel: 'Claude',
          fiveHourUsedPercent: 30,
          sevenDayUsedPercent: 60,
          fiveHourResetAtEpochSeconds: 1_800_000_000,
          sevenDayResetAtEpochSeconds: 1_900_000_000,
          meters: [{
            id: 'fake-scoped-meter',
            label: 'preview 1d',
            scope: 'model' as const,
            windowSeconds: 86_400,
            usedPercent: 12,
            resetAtEpochSeconds: 1_810_000_000,
            temporary: true
          }],
          lastUpdatedEpochMs: Date.now(),
          stale: false,
          source: 'authenticated',
          sourceConfidence: 'quotaState',
          historyBuckets: [{ dateKey: TODAY_KEY }]
        }]
      }));

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });
      const entry = result.snapshots.find(s => s.snapshot.machineLabel === 'WITH-METERS');

      assert.ok(entry);
      assert.equal(entry?.snapshot.providerUsage?.[0]?.meters?.[0]?.id, 'fake-scoped-meter');
      assert.equal(entry?.snapshot.providerUsage?.[0]?.meters?.[0]?.usedPercent, 12);
    });

    it('accepts a provider entry and a meter with an unknown forward-compatible extra field', async () => {
      await writeLatest('FUTURE-FIELD-latest.json', makeSnapshot({
        machineLabel: 'FUTURE-FIELD',
        providerUsage: [{
          provider: 'claude',
          sourceLabel: 'Claude',
          fiveHourUsedPercent: 30,
          sevenDayUsedPercent: 60,
          fiveHourResetAtEpochSeconds: 1_800_000_000,
          sevenDayResetAtEpochSeconds: 1_900_000_000,
          meters: [{
            id: 'fake-scoped-meter',
            label: 'preview 1d',
            scope: 'model' as const,
            usedPercent: 12,
            futureMeterField: 'from-a-newer-writer'
          } as any],
          lastUpdatedEpochMs: Date.now(),
          stale: false,
          source: 'authenticated',
          sourceConfidence: 'quotaState',
          futureProviderField: 'from-a-newer-writer'
        } as any]
      }));

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });
      const entry = result.snapshots.find(s => s.snapshot.machineLabel === 'FUTURE-FIELD');

      assert.ok(entry, 'snapshot with an unknown extra field must still be accepted');
      assert.ok(!result.errors.some(e => e.filePath.includes('FUTURE-FIELD')));
      assert.equal(entry?.snapshot.providerUsage?.[0]?.meters?.[0]?.id, 'fake-scoped-meter');
      assert.equal(entry?.snapshot.providerUsage?.[0]?.meters?.[0]?.usedPercent, 12);
    });

    it('rejects non-current schema snapshot files', async () => {
      await writeLatest('old-schema-latest.json', makeNonCurrentSnapshot());

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      assert.equal(result.snapshots.find(s => s.filePath.includes('old-schema')), undefined);
      assert.ok(result.errors.some(error => error.filePath.includes('old-schema-latest.json')));
    });

    it('ignores unrecognized/removed provider fields instead of rejecting the snapshot', async () => {
      for (const field of ['model', 'resetAtEpochSeconds', 'windowResetMeta', 'todaySummary', 'modelContribution']) {
        const snap = makeSnapshot() as any;
        snap.machineLabel = `IGNORED_${field}`;
        snap.providerUsage[0][field] = field === 'windowResetMeta'
          ? { fiveHourResetAtEpochSeconds: 1_800_000_000 }
          : field === 'todaySummary'
            ? { inputTokens: 1 }
            : field === 'modelContribution'
              ? [{ model: 'gpt-5.5', tokens: 1 }]
              : field === 'model'
                ? 'gpt-5.5'
                : 1_800_000_000;
        await writeLatest(`ignored-${field}-latest.json`, snap);
      }

      const result = await readMachineSnapshots({ readEnabled: true, readPath: tmpDir });

      for (const field of ['model', 'resetAtEpochSeconds', 'windowResetMeta', 'todaySummary', 'modelContribution']) {
        const entry = result.snapshots.find(s => s.filePath.includes(`ignored-${field}`));
        assert.ok(entry, `${field} snapshot must still be accepted`);
        assert.ok(!result.errors.some(e => e.filePath.includes(`ignored-${field}`)), `${field} snapshot must not produce an error`);
      }
    });

    it('rejects schema version 2 snapshot files', async () => {
      for (const field of ['role', 'roleLabel']) {
        const snap: any = {
          schemaVersion: 2,
          generatedAtEpochMs: Date.now(),
          machine: { label: `BAD_MACHINE_${field}`, [field]: field === 'role' ? 'legacy-role' : 'legacy source' },
          providerUsage: [{
            provider: 'claude',
            laneLabel: 'Claude',
            stale: false,
            source: 'authenticated',
            sourceConfidence: 'quotaState'
          }],
          exportMeta: { extensionVersion: '0.4.38', schemaVersion: 2 }
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
      assert.equal(sources[0].schemaVersion, SNAPSHOT_SCHEMA_V1);
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
      assert.equal(projection.claudeToday?.assistantMessages, 2);
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
        // Simulate a schema version 2 archive (should be rejected — only V1 is supported)
        delete archive.machineLabel;
        delete archive.writerVersion;
        archive.machine = { label: 'vm-source', roleLabel: 'legacy source' };
        archive.schemaVersion = 2;
        archive.exportMeta = {
          extensionVersion: '0.4.45',
          schemaVersion: 2,
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
      assert.equal(dp.windows.find(w => w.key === 'fiveHour')?.health, undefined);
      assert.equal(dp.windows.find(w => w.key === 'sevenDay')?.health, undefined);
      assert.equal(dp.windows.find(w => w.key === 'fiveHour')?.resetIso, new Date(1_800_000_000 * 1000).toISOString());
      assert.equal(dp.windows.find(w => w.key === 'sevenDay')?.resetIso, new Date(1_900_000_000 * 1000).toISOString());
    });

    it('maps snapshot generic meters into dashboard windows', () => {
      const baseProvider = makeSnapshot().providerUsage![0]!;
      const snapProvider = {
        ...baseProvider,
        meters: [{
          id: 'fake-scoped-meter',
          label: 'preview 1d',
          scope: 'model' as const,
          windowSeconds: 86_400,
          usedPercent: 18,
          resetAtEpochSeconds: 1_810_000_000
        }]
      };

      const dp = snapshotProviderToDashboardProvider(snapProvider, 'desktop');
      const meterWindow = dp.windows.find(w => w.key === 'meter:fake-scoped-meter');

      assert.ok(meterWindow);
      assert.equal(meterWindow?.label, 'preview 1d');
      assert.equal(meterWindow?.remainingPercent, 82);
      assert.equal(meterWindow?.resetIso, new Date(1_810_000_000 * 1000).toISOString());
    });
    it('marks provider stale when containing snapshot file is stale', () => {
      const dp = snapshotProviderToDashboardProvider({
        provider: 'codex',
        sourceLabel: 'Codex',
        stale: false,
        source: 'localSession',
        sourceConfidence: 'apiEquivalentEstimate',
        sevenDayUsedPercent: 20,
        fiveHourUsedPercent: 35
      }, 'vm-source', true);

      assert.equal(dp.provider, 'codex');
      assert.equal(dp.stale, true);
      assert.ok(dp.source?.includes('stale snapshot'));
      assert.equal(dp.windows.find(w => w.key === 'sevenDay')?.health, 'stale');
      assert.equal(dp.windows.find(w => w.key === 'fiveHour')?.health, 'stale');
    });

    it('uses snapshot generatedAt freshness instead of a carried provider stale flag', () => {
      const snapshot = makeSnapshot({
        generatedAtEpochMs: Date.now() - 30 * 60_000,
        providerUsage: [{
          ...makeSnapshot().providerUsage![0],
          stale: true,
          lastUpdatedEpochMs: Date.now() - 25 * 60 * 60_000
        }]
      });
      const providers = buildSelectedRemoteSourceProviders([{
        snapshot,
        filePath: path.join(tmpDir, 'desktop-latest.json'),
        stale: false
      }], new Set(['desktop/claude']), {});

      assert.equal(providers.length, 1);
      assert.equal(providers[0].stale, false);
      assert.equal(providers[0].windows.find(window => window.key === 'sevenDay')?.health, undefined);
      assert.equal(providers[0].windows.find(window => window.key === 'fiveHour')?.health, undefined);
    });

    it('keeps an old generated snapshot stale despite a recent provider timestamp', () => {
      const snapshot = makeSnapshot({
        generatedAtEpochMs: Date.now() - SNAPSHOT_STALE_THRESHOLD_MS - 60_000,
        providerUsage: [{
          ...makeSnapshot().providerUsage![0],
          stale: false,
          lastUpdatedEpochMs: Date.now()
        }]
      });
      const providers = buildSelectedRemoteSourceProviders([{
        snapshot,
        filePath: path.join(tmpDir, 'desktop-latest.json'),
        stale: true
      }], new Set(['desktop/claude']), {});

      assert.equal(providers[0].stale, true);
      assert.equal(providers[0].windows.find(window => window.key === 'sevenDay')?.health, 'stale');
    });

    it('maps snapshot remaining-percent to the same six-level scale as status bar dots', () => {
      const testCases: Array<{ usedPercent: number; expectedLevel: string }> = [
        { usedPercent: 0, expectedLevel: 'purple' },
        { usedPercent: 9, expectedLevel: 'purple' },
        { usedPercent: 10, expectedLevel: 'blue' },
        { usedPercent: 29, expectedLevel: 'blue' },
        { usedPercent: 30, expectedLevel: 'green' },
        { usedPercent: 49, expectedLevel: 'green' },
        { usedPercent: 50, expectedLevel: 'yellow' },
        { usedPercent: 69, expectedLevel: 'yellow' },
        { usedPercent: 70, expectedLevel: 'orange' },
        { usedPercent: 89, expectedLevel: 'orange' },
        { usedPercent: 90, expectedLevel: 'red' },
        { usedPercent: 100, expectedLevel: 'red' },
      ];

      for (const { usedPercent, expectedLevel } of testCases) {
        const dp = snapshotProviderToDashboardProvider({
          provider: 'claude',
          sourceLabel: 'Claude',
          stale: false,
          source: 'authenticated',
          sourceConfidence: 'quotaState',
          sevenDayUsedPercent: usedPercent,
          fiveHourUsedPercent: 0,
          fiveHourResetAtEpochSeconds: 1_800_000_000,
          sevenDayResetAtEpochSeconds: 1_900_000_000,
          lastUpdatedEpochMs: Date.now()
        }, 'desktop');

        const sevenDayWindow = dp.windows.find(w => w.key === 'sevenDay');
        assert.ok(sevenDayWindow, `sevenDay window must exist at used=${usedPercent}`);
        assert.equal(sevenDayWindow.level, expectedLevel,
          `At ${usedPercent}% used (${100 - usedPercent}% remaining): expected level=${expectedLevel}, got=${sevenDayWindow.level}`);
      }
    });

    it('produces undefined level for unavailable windows', () => {
      const dp = snapshotProviderToDashboardProvider({
        provider: 'claude',
        sourceLabel: 'Claude',
        stale: false,
        source: 'authenticated',
        sourceConfidence: 'quotaState'
      }, 'desktop');

      assert.equal(dp.windows.length, 2);
      assert.equal(dp.windows[0].available, false);
      assert.equal(dp.windows[0].level, undefined);
      assert.equal(dp.windows[1].available, false);
      assert.equal(dp.windows[1].level, undefined);
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
