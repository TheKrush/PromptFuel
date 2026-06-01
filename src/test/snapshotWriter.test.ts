import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProviderUsageState } from '../types';
import {
  buildMachineSnapshot,
  writeMachineSnapshotToPath,
  writeMachineSnapshotIfEnabled,
  isMachineSnapshotPayload
} from '../snapshot/writeMachineSnapshot';
import { SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION, SNAPSHOT_SCHEMA_V2, SNAPSHOT_SCHEMA_V3, SNAPSHOT_SCHEMA_V4 } from '../snapshot/types';

let tmpDir: string;

const REMOVED_PROVIDER_FIELDS = ['model', 'resetAtEpochSeconds', 'windowResetMeta', 'todaySummary', 'modelContribution'];
const EXPECTED_PROVIDER_FIELDS = [
  'provider',
  'sourceLabel',
  'fiveHourUsedPercent',
  'sevenDayUsedPercent',
  'fiveHourResetAtEpochSeconds',
  'sevenDayResetAtEpochSeconds',
  'lastUpdatedEpochMs',
  'stale',
  'source',
  'sourceConfidence',
  'historyBuckets'
];

function mockState(overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    provider: 'claude',
    fiveHour: { usedPercentage: 42, resetsAtEpochSeconds: 1_800_000_000, sourceKind: 'authenticated' },
    sevenDay: { usedPercentage: 65, resetsAtEpochSeconds: 1_900_000_000, sourceKind: 'authenticated' },
    model: 'claude-sonnet-4-20250514',
    lastUpdatedEpochMs: Date.now(),
    stale: false,
    authenticatedStatus: 'success',
    ...overrides
  };
}

function mockStateWithTracing(overrides: Partial<ProviderUsageState> = {}): ProviderUsageState {
  return {
    ...mockState(),
    tracing: {
      totalInputTokens: 12000,
      totalOutputTokens: 8000,
      totalCachedInputTokens: 3000,
      totalReasoningOutputTokens: 2000,
      totalTokens: 23000,
      totalCostUsd: 0.125
    },
    ...overrides
  };
}

function assertRemovedProviderFieldsAbsent(provider: Record<string, unknown>): void {
  for (const field of REMOVED_PROVIDER_FIELDS) {
    assert.equal(provider[field], undefined, `${field} must not be emitted`);
  }
}

function assertArchiveSchemaCanonical(archive: any): void {
  assert.deepEqual(Object.keys(archive).sort(), [
    'archiveSchemaVersion',
    'generatedAtEpochMs',
    'machineLabel',
    'month',
    'providers',
    'schemaVersion',
    'writerVersion'
  ].sort());
  assert.equal(archive.schemaVersion, SNAPSHOT_SCHEMA_V4);
  assert.equal(archive.archiveSchemaVersion, SNAPSHOT_HISTORY_ARCHIVE_SCHEMA_VERSION);
  assert.equal(typeof archive.writerVersion, 'string');
  assert.ok(archive.writerVersion);

  for (const provider of archive.providers) {
    assert.deepEqual(Object.keys(provider).sort(), ['historyBuckets', 'provider'].sort());
    assert.equal(provider.model, undefined, 'archive provider must not include last-used model');
    assert.equal(provider.todaySummary, undefined);
    assert.equal(provider.modelContribution, undefined);
    assert.equal(provider.resetAtEpochSeconds, undefined);
    assert.equal(provider.windowResetMeta, undefined);
    for (const bucket of provider.historyBuckets) {
      assert.equal(bucket.todaySummary, undefined);
      assert.equal(bucket.modelContribution, undefined);
      assert.equal(bucket.resetAtEpochSeconds, undefined);
      assert.equal(bucket.windowResetMeta, undefined);
      assert.equal(bucket.model, undefined, 'bucket must not include top-level last-used model');
    }
  }

  const json = JSON.stringify(archive);
  for (const field of ['todaySummary', 'modelContribution', 'resetAtEpochSeconds', 'windowResetMeta', 'providerUsage', 'fiveHourUsedPercent', 'sevenDayUsedPercent', 'lastUpdatedEpochMs']) {
    assert.ok(!json.includes(`"${field}"`), `${field} must not appear in archive`);
  }
}

describe('snapshotWriter', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-snapshot-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('buildMachineSnapshot', () => {
    it('builds the current provider schema with direct reset fields only', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState()]
      );

      assert.equal(snap.schemaVersion, SNAPSHOT_SCHEMA_V4);
      assert.equal(snap.machineLabel, 'desktop');
      assert.equal(typeof snap.generatedAtEpochMs, 'number');
      assert.ok(snap.providerUsage);
      const provider = snap.providerUsage[0] as unknown as Record<string, unknown>;
      assert.equal(provider.provider, 'claude');
      assert.equal(provider.fiveHourUsedPercent, 42);
      assert.equal(provider.sevenDayUsedPercent, 65);
      assert.equal(provider.fiveHourResetAtEpochSeconds, 1_800_000_000);
      assert.equal(provider.sevenDayResetAtEpochSeconds, 1_900_000_000);
      assert.equal(provider.source, 'authenticated');
      assert.equal(provider.sourceConfidence, 'quotaState');
      assert.equal(provider.stale, false);
      assertRemovedProviderFieldsAbsent(provider);
      for (const key of Object.keys(provider)) {
        assert.ok(EXPECTED_PROVIDER_FIELDS.includes(key), `provider field "${key}" is not allowlisted`);
      }
    });

    it('emits only the safe machine label', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'workstation', path: '' },
        [mockState()]
      );
      assert.equal(snap.machineLabel, 'workstation');
    });

    it('omits providerUsage when no providers have quota data', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState({ fiveHour: undefined, sevenDay: undefined })]
      );
      assert.equal(snap.providerUsage, undefined);
    });

    it('handles codex provider', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState({ provider: 'codex' })]
      );
      assert.equal(snap.providerUsage?.[0]?.provider, 'codex');
    });
  });

  describe('historyBuckets payload', () => {
    it('always emits historyBuckets when tracing data is available', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockStateWithTracing()]
      );
      const provider = snap.providerUsage?.[0] as unknown as Record<string, unknown>;
      const buckets = snap.providerUsage?.[0]?.historyBuckets;
      assert.ok(buckets, 'historyBuckets must be present when tracing is available');
      assert.equal(buckets.length, 1);
      assert.match(buckets[0].dateKey, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(buckets[0].inputTokens, 12000);
      assert.equal(buckets[0].outputTokens, 8000);
      assert.equal(buckets[0].cacheCreationTokens, 3000);
      assert.equal(buckets[0].reasoningOutputTokens, 2000);
      assertRemovedProviderFieldsAbsent(provider);
    });

    it('exports scanner history bucket models with component fields and no derived token fields', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockStateWithTracing()],
        undefined,
        {
          claude: {
            buckets: [{
              dateKey: '2026-05-18',
              inputTokens: 1000,
              outputTokens: 500,
              cacheCreationTokens: 250,
              cacheReadTokens: 100,
              messages: 2,
              turns: 1,
              modelUsage: [{
                model: 'claude-sonnet-4-20250514',
                totalTokens: 1850,
                inputTokens: 1000,
                outputTokens: 500,
                cacheCreationTokens: 250,
                cacheReadTokens: 100,
                reasoningOutputTokens: 75,
                assistantMessages: 2,
                turns: 1
              }]
            }]
          }
        }
      );

      const model = snap.providerUsage?.[0]?.historyBuckets?.[0]?.models?.[0] as unknown as Record<string, unknown>;
      assert.equal(model.model, 'claude-sonnet-4-20250514');
      assert.equal(model.inputTokens, 1000);
      assert.equal(model.outputTokens, 500);
      assert.equal(model.cacheCreationTokens, 250);
      assert.equal(model.cacheReadTokens, 100);
      assert.equal(model.reasoningOutputTokens, 75);
      assert.equal(model.messages, 2);
      assert.equal(model.turns, 1);
      assert.equal(model.tokens, undefined, 'bucket model tokens must not be emitted');
      assert.equal(model.windowDays, undefined, 'bucket model windowDays must not be emitted');
    });

    it('historyBuckets are absent when no tracing data exists', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState()]
      );
      assert.equal(snap.providerUsage?.[0]?.historyBuckets, undefined);
    });
  });

  describe('forbidden-field serialization', () => {
    it('serialized snapshot omits private/runtime fields and removed schema fields', () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockStateWithTracing({
          sessionId: 'sess_abc123',
          workspace: 'D:\\secret\\project',
          source: 'raw statusLine path D:\\data',
          lastRequestId: 'req_xyz',
          lastUsageTimestamp: '2026-01-01T00:00:00Z',
          lastEntrypoint: 'some-entrypoint',
          error: 'some error detail',
          authenticatedError: 'detailed auth error'
        })]
      );
      const json = JSON.stringify(snap);

      assert.ok(!json.includes('sessionId'), 'sessionId must be absent');
      assert.ok(!json.includes('D:\\\\secret'), 'raw workspace paths must be absent');
      assert.ok(!json.includes('"token"'), 'token field must be absent');
      assert.ok(!json.includes('apiKey'), 'apiKey must be absent');
      assert.ok(!json.includes('credentials'), 'credentials must be absent');
      assert.ok(!json.includes('authHeader'), 'authHeader must be absent');
      assert.ok(!json.includes('"prompt"'), 'prompt field must be absent');
      assert.ok(!json.includes('"response"'), 'response field must be absent');
      assert.ok(!json.includes('"transcript"'), 'transcript field must be absent');
      assert.ok(!json.includes('lastRequestId'), 'lastRequestId must be absent');
      assert.ok(!json.includes('lastUsageTimestamp'), 'lastUsageTimestamp must be absent');
      assert.ok(!json.includes('lastEntrypoint'), 'lastEntrypoint must be absent');
      assert.ok(!json.includes('sess_'), 'credential-derived identifiers must be absent');
      for (const field of REMOVED_PROVIDER_FIELDS) {
        assert.ok(!json.includes(`"${field}"`), `${field} must be absent`);
      }
    });
  });

  describe('writeMachineSnapshotToPath', () => {
    it('writes valid JSON to the given path', async () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState()]
      );
      const filePath = path.join(tmpDir, 'test-latest.json');
      await writeMachineSnapshotToPath(filePath, snap);

      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      assert.equal(parsed.machineLabel, 'desktop');
    });

    it('uses atomic write: no temp files remain', async () => {
      const snap = buildMachineSnapshot(
        { enabled: true, machineLabel: 'desktop', path: '' },
        [mockState()]
      );
      const dir = path.join(tmpDir, 'atomic');
      const filePath = path.join(dir, 'atomic-latest.json');
      await writeMachineSnapshotToPath(filePath, snap);

      const files = await fs.readdir(dir);
      const tmpFiles = files.filter(f => f.includes('.tmp.'));
      assert.equal(tmpFiles.length, 0);
    });
  });

  describe('writeMachineSnapshotIfEnabled', () => {
    it('does not write when disabled', async () => {
      const stateDir = path.join(tmpDir, 'disabled-test');
      await writeMachineSnapshotIfEnabled(
        { enabled: false, machineLabel: 'desktop', path: '' },
        stateDir,
        [mockState()]
      );
      const snapPath = path.join(stateDir, 'snapshots', 'desktop-latest.json');
      await assert.rejects(() => fs.access(snapPath));
    });

    it('writes to stateDirectory/snapshots and syncPath when enabled', async () => {
      const stateDir = path.join(tmpDir, 'sync-state');
      const syncDir = path.join(tmpDir, 'sync-target');
      await writeMachineSnapshotIfEnabled(
        { enabled: true, machineLabel: 'desktop', path: syncDir },
        stateDir,
        [mockState()]
      );

      const localPath = path.join(stateDir, 'snapshots', 'desktop-latest.json');
      const syncPath = path.join(syncDir, 'desktop-latest.json');
      const localContent = JSON.parse(await fs.readFile(localPath, 'utf-8'));
      const syncContent = JSON.parse(await fs.readFile(syncPath, 'utf-8'));
      assert.equal(localContent.machineLabel, 'desktop');
      assert.equal(syncContent.machineLabel, 'desktop');
    });

    it('writes canonical monthly archive files under state and sync roots', async () => {
      const stateDir = path.join(tmpDir, 'archive-rollover-state');
      const syncDir = path.join(tmpDir, 'archive-rollover-sync');
      await writeMachineSnapshotIfEnabled(
        { enabled: true, machineLabel: 'desktop', path: syncDir },
        stateDir,
        [mockState(), mockState({ provider: 'codex' })],
        undefined,
        {
          claude: {
            buckets: [{
              dateKey: '2026-05-31',
              inputTokens: 1000,
              outputTokens: 500,
              cacheCreationTokens: 250,
              cacheReadTokens: 100,
              messages: 2,
              modelUsage: [{
                model: 'claude-sonnet-4-20250514',
                totalTokens: 1850,
                inputTokens: 1000,
                outputTokens: 500,
                cacheCreationTokens: 250,
                cacheReadTokens: 100,
                assistantMessages: 2
              }]
            }, {
              dateKey: '2026-06-01',
              inputTokens: 2000,
              outputTokens: 600,
              messages: 3,
              modelUsage: [{
                model: 'claude-opus-4-20250514',
                totalTokens: 2600,
                inputTokens: 2000,
                outputTokens: 600,
                assistantMessages: 3
              }]
            }]
          },
          codex: {
            buckets: [{
              dateKey: '2026-05-30',
              inputTokens: 300,
              outputTokens: 125,
              reasoningOutputTokens: 40,
              turns: 1,
              modelUsage: [{
                model: 'gpt-5.5',
                totalTokens: 465,
                inputTokens: 300,
                outputTokens: 125,
                reasoningOutputTokens: 40,
                turns: 1
              }]
            }]
          }
        }
      );

      for (const root of [path.join(stateDir, 'snapshots'), syncDir]) {
        const mayPath = path.join(root, 'archive', 'desktop', '2026-05.json');
        const junePath = path.join(root, 'archive', 'desktop', '2026-06.json');
        const mayArchive = JSON.parse(await fs.readFile(mayPath, 'utf-8'));
        const juneArchive = JSON.parse(await fs.readFile(junePath, 'utf-8'));

        assertArchiveSchemaCanonical(mayArchive);
        assertArchiveSchemaCanonical(juneArchive);
        assert.equal(mayArchive.machineLabel, 'desktop');
        assert.equal(mayArchive.month, '2026-05');
        assert.equal(juneArchive.month, '2026-06');
        assert.deepEqual(mayArchive.providers.map((p: any) => p.provider).sort(), ['claude', 'codex']);
        assert.equal(mayArchive.providers.find((p: any) => p.provider === 'claude').historyBuckets[0].dateKey, '2026-05-31');
        assert.equal(mayArchive.providers.find((p: any) => p.provider === 'codex').historyBuckets[0].dateKey, '2026-05-30');
        assert.equal(juneArchive.providers[0].historyBuckets[0].dateKey, '2026-06-01');
        await assert.rejects(() => fs.access(path.join(root, 'archive', 'desktop', '2026')));
      }
    });

    it('replaces duplicate archive buckets idempotently by provider and dateKey', async () => {
      const stateDir = path.join(tmpDir, 'archive-idempotent-state');
      const config = { enabled: true, machineLabel: 'desktop', path: '' };
      const archivePath = path.join(stateDir, 'snapshots', 'archive', 'desktop', '2026-05.json');

      await writeMachineSnapshotIfEnabled(
        config,
        stateDir,
        [mockState()],
        undefined,
        {
          claude: {
            buckets: [{
              dateKey: '2026-05-20',
              inputTokens: 100,
              outputTokens: 50
            }]
          }
        }
      );
      await writeMachineSnapshotIfEnabled(
        config,
        stateDir,
        [mockState()],
        undefined,
        {
          claude: {
            buckets: [{
              dateKey: '2026-05-20',
              inputTokens: 200,
              outputTokens: 75,
              cacheReadTokens: 25,
              messages: 2,
              modelUsage: [{
                model: 'claude-sonnet-4-20250514',
                totalTokens: 300,
                inputTokens: 200,
                outputTokens: 75,
                cacheReadTokens: 25,
                assistantMessages: 2
              }]
            }]
          }
        }
      );
      await writeMachineSnapshotIfEnabled(
        config,
        stateDir,
        [mockState()],
        undefined,
        {
          claude: {
            buckets: [{
              dateKey: '2026-05-20',
              inputTokens: 200,
              outputTokens: 75,
              cacheReadTokens: 25,
              messages: 2,
              modelUsage: [{
                model: 'claude-sonnet-4-20250514',
                totalTokens: 300,
                inputTokens: 200,
                outputTokens: 75,
                cacheReadTokens: 25,
                assistantMessages: 2
              }]
            }]
          }
        }
      );

      const archive = JSON.parse(await fs.readFile(archivePath, 'utf-8'));
      const claudeProvider = archive.providers.find((p: any) => p.provider === 'claude');
      assert.equal(claudeProvider.historyBuckets.length, 1);
      assert.equal(claudeProvider.historyBuckets[0].dateKey, '2026-05-20');
      assert.equal(claudeProvider.historyBuckets[0].inputTokens, 200);
      assert.equal(claudeProvider.historyBuckets[0].cacheReadTokens, 25);
      assert.equal(claudeProvider.historyBuckets[0].models.length, 1);
      assertArchiveSchemaCanonical(archive);
    });
  });

  describe('isMachineSnapshotPayload', () => {
    it('accepts valid v4 payload and rejects unsupported schemas', () => {
      assert.ok(isMachineSnapshotPayload({
        schemaVersion: SNAPSHOT_SCHEMA_V4,
        writerVersion: '0.6.0',
        generatedAtEpochMs: Date.now(),
        machineLabel: 'desktop',
      }));
      assert.ok(!isMachineSnapshotPayload({
        schemaVersion: SNAPSHOT_SCHEMA_V3,
        generatedAtEpochMs: Date.now(),
        machineLabel: 'desktop',
        exportMeta: { extensionVersion: '0.4.38', schemaVersion: SNAPSHOT_SCHEMA_V3 }
      }));
      assert.ok(!isMachineSnapshotPayload({
        schemaVersion: SNAPSHOT_SCHEMA_V4,
        writerVersion: '0.6.0',
        generatedAtEpochMs: Date.now(),
        machineLabel: '',
      }));
      assert.ok(!isMachineSnapshotPayload({
        schemaVersion: SNAPSHOT_SCHEMA_V4,
        writerVersion: '',
        generatedAtEpochMs: Date.now(),
        machineLabel: 'desktop',
      }));
      assert.ok(!isMachineSnapshotPayload(null));
    });
  });
});
