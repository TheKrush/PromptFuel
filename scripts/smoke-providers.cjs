'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const assert = require('assert');

const OUT = path.resolve(__dirname, '../out');

const { ClaudeLocalReader } = require(path.join(OUT, 'providers/claudeLocal'));
const { CodexLocalReader } = require(path.join(OUT, 'providers/codexLocal'));
const { parseClaudeUsage } = require(path.join(OUT, 'providers/claudeUsageParser'));
const { parseCodexUsage } = require(path.join(OUT, 'providers/codexUsageParser'));
const { runEnabledReaders } = require(path.join(OUT, 'providers/readProviders'));
const {
  formatRefreshSummary,
  formatStatusBarText,
  formatTooltip,
  formatTokenCount,
} = require(path.join(OUT, 'core/formatQuota'));
const { _test: authTest } = require(path.join(OUT, 'providers/authenticatedQuota'));
const {
  createInitialStatus,
  applyRefreshResults,
  applyLiveQuotaResults,
  getProviderState,
  hasAnyLoaded,
  hasAnyError,
} = require(path.join(OUT, 'core/statusModel'));
const {
  applyLiveQuotaCacheFallback,
  LIVE_QUOTA_CACHE_KEY,
  readCachedLiveQuotaStateForTest,
} = require(path.join(OUT, 'core/liveQuotaCache'));
const {
  PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
} = require(path.join(OUT, 'core/snapshotTypes'));
const {
  applySnapshotReadResults,
} = require(path.join(OUT, 'core/statusModel'));
const {
  readPromptFuelSnapshots,
} = require(path.join(OUT, 'snapshots/snapshotReader'));
const {
  getPromptFuelSnapshotImportFolderPath,
  getEffectivePromptFuelSnapshotImportFolderPath,
  getPromptFuelSnapshotExportFolderPathFromContext,
  ensurePromptFuelSnapshotImportFolder,
  ensurePromptFuelSnapshotExportFolder,
} = require(path.join(OUT, 'snapshots/snapshotStorage'));
const {
  buildPromptFuelUsageSnapshot,
  exportPromptFuelUsageSnapshot,
} = require(path.join(OUT, 'snapshots/snapshotExporter'));
const {
  buildDashboardModel,
} = require(path.join(OUT, 'panel/dashboardModel'));

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    fail++;
  }
}

function createMemoryStorage(initial = {}) {
  return {
    values: { ...initial },
    get(key) {
      return this.values[key];
    },
    async update(key, value) {
      this.values[key] = value;
    },
  };
}

const FIXTURE_DIR = path.join(os.tmpdir(), `pf-smoke-fixtures-${Date.now()}`);

async function writeFile(dir, fileName, content) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, fileName), content, 'utf8');
}

async function createClaudeFixture(dir, records) {
  const lines = records.map(r => JSON.stringify(r));
  await writeFile(dir, 'session.jsonl', lines.join('\n') + '\n');
}

async function createCodexFixture(dir, records) {
  const lines = records.map(r => JSON.stringify(r));
  await writeFile(dir, 'session.jsonl', lines.join('\n') + '\n');
}

async function main() {
  await fsp.mkdir(FIXTURE_DIR, { recursive: true });

  const ABSENT = path.join(FIXTURE_DIR, 'absent-' + Date.now());

  // ===== statusModel: createInitialStatus =====

  await test('createInitialStatus: creates no-data states for all enabled providers', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    assert.strictEqual(status.providerStates.length, 2);
    assert.strictEqual(status.providerStates[0].status, 'no-data');
    assert.strictEqual(status.providerStates[1].status, 'no-data');
    assert.strictEqual(status.lastRefreshedMs, undefined);
    assert.strictEqual(status.localHistoryLastRefreshedMs, undefined);
    assert.strictEqual(status.liveQuotaLastRefreshedMs, undefined);
    assert.strictEqual(status.liveQuotaEnabled, true);
    assert.deepStrictEqual(status.enabledProviderIds, ['claude', 'codex']);
  });

  await test('createInitialStatus: explicit opt-out disables live quota', async () => {
    const status = createInitialStatus(['claude'], false);
    assert.strictEqual(status.liveQuotaEnabled, false);
  });

  await test('createInitialStatus: empty enabledProviders yields empty states', async () => {
    const status = createInitialStatus([]);
    assert.strictEqual(status.providerStates.length, 0);
  });

  // ===== statusModel: applyRefreshResults =====

  await test('applyRefreshResults: updates lastRefreshedMs', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    assert.ok(typeof updated.lastRefreshedMs === 'number', 'expected lastRefreshedMs to be a number');
    assert.ok(updated.lastRefreshedMs > 0, 'expected lastRefreshedMs > 0');
    assert.strictEqual(updated.localHistoryLastRefreshedMs, updated.lastRefreshedMs);
    assert.strictEqual(updated.liveQuotaLastRefreshedMs, undefined);
  });

  await test('applyRefreshResults: ok with tokens -> loaded status', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 3, filesFound: 2 },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'loaded');
    assert.strictEqual(claudeState.totalTokens, 1000);
    assert.strictEqual(claudeState.totalAssistantMessages, 3);
  });

  await test('applyRefreshResults: not-found -> no-data status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'no-data');
  });

  await test('applyRefreshResults: error -> unknown status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'error' },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'unknown');
  });

  await test('applyRefreshResults: ok with 0 tokens -> no-data status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 0, totalAssistantMessages: 0, filesFound: 1 },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'no-data');
  });

  await test('applyRefreshResults: ignores unknown providerId', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'openai', status: 'ok', totalTokens: 999 },
      { providerId: 'claude', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    assert.strictEqual(updated.providerStates.length, 1);
    assert.strictEqual(updated.providerStates[0].providerId, 'claude');
  });

  // ===== liveQuotaCache: last-known-good stale fallback =====

  await test('liveQuotaCache: first successful live read stores cache', async () => {
    const storage = createMemoryStorage();
    const refreshedAt = Date.now();
    const results = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        lastUpdatedEpochMs: refreshedAt,
        windows: [
          { windowId: '5h', usedPercentage: 92, remainingPercentage: 8, resetsAtEpochMs: refreshedAt + 1000 },
          { windowId: '7d', usedPercentage: 72, remainingPercentage: 28, resetsAtEpochMs: refreshedAt + 2000 },
        ],
      }],
      nowMs: refreshedAt,
    });
    assert.strictEqual(results[0].freshness, 'live');
    const cached = storage.get(LIVE_QUOTA_CACHE_KEY);
    assert.ok(cached, 'expected live quota cache to be stored');
    assert.strictEqual(cached.providers.claude.windows.length, 2);
  });

  await test('liveQuotaCache: failed refresh with cache returns stale windows', async () => {
    const storage = createMemoryStorage();
    const refreshedAt = Date.now();
    await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        lastUpdatedEpochMs: refreshedAt,
        windows: [
          { windowId: '5h', usedPercentage: 92, remainingPercentage: 8 },
          { windowId: '7d', usedPercentage: 72, remainingPercentage: 28 },
        ],
      }],
      nowMs: refreshedAt,
    });
    const results = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'error',
        status: 'error',
        windows: [],
        error: 'raw provider failure /private/path/session.jsonl private-auth-value',
      }],
      nowMs: refreshedAt + 1000,
    });
    assert.strictEqual(results[0].freshness, 'stale');
    assert.strictEqual(results[0].status, 'stale');
    assert.strictEqual(results[0].windows.length, 2);
    assert.strictEqual(results[0].windows[0].sourceKind, 'stale');
  });

  await test('liveQuotaCache: failed refresh without cache returns unavailable', async () => {
    const storage = createMemoryStorage();
    const results = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'unavailable',
        status: 'unavailable',
        windows: [],
      }],
    });
    assert.strictEqual(results[0].freshness, 'unavailable');
    assert.strictEqual(results[0].windows.length, 0);
  });

  await test('liveQuotaCache: disabled live quota does not use cache', async () => {
    const storage = createMemoryStorage();
    await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        windows: [{ windowId: '5h', usedPercentage: 92 }],
      }],
    });
    const results = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: false,
      liveResults: [{
        providerId: 'claude',
        freshness: 'error',
        status: 'error',
        windows: [],
      }],
    });
    assert.deepStrictEqual(results, []);
  });

  await test('liveQuotaCache: mixed providers can return Claude stale and Codex live', async () => {
    const storage = createMemoryStorage();
    await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        windows: [
          { windowId: '5h', usedPercentage: 92 },
          { windowId: '7d', usedPercentage: 72 },
        ],
      }],
    });
    const results = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude', 'codex'],
      liveQuotaEnabled: true,
      liveResults: [
        { providerId: 'claude', freshness: 'error', status: 'error', windows: [] },
        {
          providerId: 'codex',
          freshness: 'live',
          windows: [
            { windowId: '5h', usedPercentage: 15 },
            { windowId: '7d', usedPercentage: 27 },
          ],
        },
      ],
    });
    const byProvider = Object.fromEntries(results.map(result => [result.providerId, result]));
    assert.strictEqual(byProvider.claude.freshness, 'stale');
    assert.strictEqual(byProvider.codex.freshness, 'live');
  });

  await test('liveQuotaCache: stale fallback does not overwrite local-history refresh timestamp', async () => {
    const storage = createMemoryStorage();
    await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        windows: [{ windowId: '5h', usedPercentage: 92 }],
      }],
    });
    const localStatus = applyRefreshResults(
      createInitialStatus(['claude']),
      [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 }],
    );
    const localHistoryRefreshed = localStatus.localHistoryLastRefreshedMs;
    const staleResults = await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{ providerId: 'claude', freshness: 'error', status: 'error', windows: [] }],
    });
    const updated = applyLiveQuotaResults(localStatus, staleResults);
    assert.strictEqual(updated.localHistoryLastRefreshedMs, localHistoryRefreshed);
    assert.ok(typeof updated.liveQuotaLastRefreshedMs === 'number', 'expected live quota refresh timestamp');
  });

  await test('liveQuotaCache: cache contains no raw/private provider data', async () => {
    const storage = createMemoryStorage();
    await applyLiveQuotaCacheFallback({
      storage,
      enabledProviderIds: ['claude'],
      liveQuotaEnabled: true,
      liveResults: [{
        providerId: 'claude',
        freshness: 'live',
        error: 'raw provider failure /private/path/session.jsonl private-auth-value',
        sanitizedMessage: 'Live quota unavailable',
        windows: [{
          windowId: '5h',
          label: '5h',
          usedPercentage: 92,
          remainingPercentage: 8,
          resetsAtEpochMs: Date.now() + 1000,
          sourceLabel: 'raw provider payload should not persist',
        }],
      }],
    });
    const cached = readCachedLiveQuotaStateForTest(storage);
    const serialized = JSON.stringify(cached);
    assert.ok(!serialized.includes('raw provider'), 'cache should not include raw provider strings');
    assert.ok(!serialized.includes('private-auth-value'), 'cache should not include auth values');
    assert.ok(!serialized.includes('.jsonl'), 'cache should not include filenames');
    assert.ok(!serialized.includes('/private/path'), 'cache should not include local paths');
    assert.ok(!serialized.includes('sourceLabel'), 'cache should not include source labels');
  });

  // ===== snapshot reader foundation =====

  const snapshotRoot = path.join(FIXTURE_DIR, 'snapshot-storage-root');
  const snapshotDir = getPromptFuelSnapshotImportFolderPath(snapshotRoot);
  const snapshotNow = new Date('2026-05-31T20:00:00.000Z').getTime();

  await test('snapshotStorage: import folder is under PromptFuel storage root', async () => {
    assert.strictEqual(snapshotDir, path.join(snapshotRoot, 'snapshot-imports'));
  });

  await test('snapshotStorage: ensure creates snapshot import folder', async () => {
    const storageRoot = path.join(FIXTURE_DIR, 'snapshot-storage-ensure');
    const ensuredPath = await ensurePromptFuelSnapshotImportFolder({ globalStorageUri: { fsPath: storageRoot } });
    assert.strictEqual(ensuredPath, path.join(storageRoot, 'snapshot-imports'));
    assert.strictEqual(fs.existsSync(ensuredPath), true);
    assert.strictEqual(fs.statSync(ensuredPath).isDirectory(), true);
  });

  await test('snapshotStorage: configured import path overrides default folder', async () => {
    const storageRoot = path.join(FIXTURE_DIR, 'snapshot-storage-config-root');
    const configuredPath = path.join(FIXTURE_DIR, 'configured-imports');
    assert.strictEqual(
      getEffectivePromptFuelSnapshotImportFolderPath(storageRoot, configuredPath),
      configuredPath,
    );
    const ensuredPath = await ensurePromptFuelSnapshotImportFolder(
      { globalStorageUri: { fsPath: storageRoot } },
      configuredPath,
    );
    assert.strictEqual(ensuredPath, configuredPath);
    assert.strictEqual(fs.existsSync(ensuredPath), true);
  });

  await test('snapshotStorage: configured export path is recognized', async () => {
    const storageRoot = path.join(FIXTURE_DIR, 'snapshot-export-config-root');
    const configuredPath = path.join(FIXTURE_DIR, 'configured-exports');
    assert.strictEqual(
      getPromptFuelSnapshotExportFolderPathFromContext({ globalStorageUri: { fsPath: storageRoot } }, configuredPath),
      configuredPath,
    );
    const ensuredPath = await ensurePromptFuelSnapshotExportFolder(
      { globalStorageUri: { fsPath: storageRoot } },
      configuredPath,
    );
    assert.strictEqual(ensuredPath, configuredPath);
    assert.strictEqual(fs.existsSync(ensuredPath), true);
  });

  await test('readPromptFuelSnapshots: missing storage produces empty snapshot state', async () => {
    const diagnostics = [];
    const result = await readPromptFuelSnapshots({
      snapshotDir: path.join(FIXTURE_DIR, 'missing-snapshot-storage'),
      diagnostics: { info: message => diagnostics.push(message) },
      nowMs: snapshotNow,
    });
    assert.strictEqual(result.state.providers.length, 0);
    assert.strictEqual(result.state.snapshotCount, 0);
    assert.strictEqual(result.filesRead, 0);
    assert.ok(diagnostics.includes('snapshot data not found'), 'expected no-data diagnostic');
  });

  await test('readPromptFuelSnapshots: valid snapshot schema read preserves aggregate totals', async () => {
    const dir = path.join(snapshotDir, 'valid');
    await writeFile(dir, 'usage.json', JSON.stringify({
      schemaVersion: PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAtEpochMs: snapshotNow,
      providers: [{
        providerId: 'claude',
        generatedAtEpochMs: snapshotNow,
        sourceLabel: 'snapshot import',
        aggregate: {
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheCreationInputTokens: 200,
          totalCacheReadInputTokens: 100,
          totalTokens: 1800,
          totalAssistantMessages: 3,
        },
        windowTotals: {
          today: {
            totalInputTokens: 400,
            totalOutputTokens: 100,
            totalCacheCreationInputTokens: 0,
            totalCacheReadInputTokens: 0,
            totalTokens: 500,
            totalAssistantMessages: 1,
          },
        },
        modelTotals: [{
          providerId: 'claude',
          modelLabel: 'claude-sonnet-4-20250514',
          totalTokens: 1800,
          totalAssistantMessages: 3,
        }],
        modelWindowTotals: {
          today: [{
            model: 'claude-sonnet-4-20250514',
            totalTokens: 500,
            messages: 1,
          }],
        },
      }],
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['claude'], nowMs: snapshotNow });
    assert.strictEqual(result.state.snapshotCount, 1);
    assert.strictEqual(result.state.providers.length, 1);
    assert.strictEqual(result.state.providers[0].providerId, 'claude');
    assert.strictEqual(result.state.providers[0].aggregate.totalTokens, 1800);
    assert.strictEqual(result.state.providers[0].aggregate.totalAssistantMessages, 3);
    assert.strictEqual(result.state.providers[0].windowTotals.today.totalTokens, 500);
    assert.strictEqual(result.state.providers[0].modelAggregates[0].modelLabel, 'claude-sonnet-4-20250514');
    assert.strictEqual(result.state.providers[0].modelAggregates[0].totalTokens, 1800);
    assert.strictEqual(result.state.providers[0].modelWindowTotals.today[0].totalTokens, 500);
    assert.strictEqual(result.state.providers[0].sourceLabel, 'snapshot import');
  });

  await test('readPromptFuelSnapshots: AgentBridge-compatible v2 snapshot imports aggregate and model windows', async () => {
    const dir = path.join(snapshotDir, 'agentbridge-v2');
    await writeFile(dir, 'REMOTE-latest.json', JSON.stringify({
      schemaVersion: 2,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'WATCHER' },
      providerUsage: [{
        provider: 'codex',
        laneLabel: 'Codex',
        lastUpdatedEpochMs: snapshotNow,
        stale: false,
        source: 'snapshot',
        sourceConfidence: 'snapshotOnly',
        historyBuckets: [{
          dateKey: '2026-05-31',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 100,
          turns: 3,
          models: [{
            model: 'gpt-5.4-codex',
            inputTokens: 600,
            outputTokens: 300,
            turns: 2,
          }],
        }],
      }],
      exportMeta: {
        extensionVersion: '0.4.29',
        schemaVersion: 2,
        includeAnalytics: true,
      },
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['codex'], nowMs: snapshotNow });
    assert.strictEqual(result.state.snapshotCount, 1);
    assert.strictEqual(result.state.providers.length, 1);
    const provider = result.state.providers[0];
    assert.strictEqual(provider.providerId, 'codex');
    assert.strictEqual(provider.aggregate.totalTokens, 1800);
    assert.strictEqual(provider.aggregate.totalAssistantMessages, 3);
    assert.strictEqual(provider.windowTotals.today.totalTokens, 1800);
    assert.strictEqual(provider.windowTotals.last7d.totalTokens, 1800);
    assert.strictEqual(provider.modelAggregates[0].modelLabel, 'gpt-5.4-codex');
    assert.strictEqual(provider.modelAggregates[0].totalTokens, 900);
    assert.strictEqual(provider.modelWindowTotals.today[0].totalTokens, 900);
    assert.strictEqual(provider.sourceLabel, 'WATCHER');
    assert.deepStrictEqual(provider.modelAggregates[0].sourceLabels, ['WATCHER']);
  });

  await test('readPromptFuelSnapshots: versioned imports accept PromptFuel v1 and compatible v2 together', async () => {
    const dir = path.join(snapshotDir, 'multi-version');
    await writeFile(dir, 'promptfuel-v1.json', JSON.stringify({
      schemaVersion: PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAtEpochMs: snapshotNow,
      providers: [{
        providerId: 'claude',
        aggregate: {
          totalTokens: 1200,
          totalAssistantMessages: 2,
        },
      }],
    }));
    await writeFile(dir, 'compatible-v2.json', JSON.stringify({
      schemaVersion: 2,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'WATCHER' },
      providerUsage: [{
        provider: 'codex',
        laneLabel: 'Codex',
        stale: false,
        source: 'snapshot',
        sourceConfidence: 'snapshotOnly',
        historyBuckets: [{ dateKey: '2026-05-31', inputTokens: 300, outputTokens: 200, turns: 1 }],
      }],
      exportMeta: { extensionVersion: '0.4.29', schemaVersion: 2, includeAnalytics: true },
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['claude', 'codex'], nowMs: snapshotNow });
    assert.strictEqual(result.state.snapshotCount, 2);
    assert.strictEqual(result.state.providers.find(p => p.providerId === 'claude').aggregate.totalTokens, 1200);
    assert.strictEqual(result.state.providers.find(p => p.providerId === 'codex').aggregate.totalTokens, 500);
  });

  await test('readPromptFuelSnapshots: AgentBridge-compatible archive months import history buckets', async () => {
    const dir = path.join(snapshotDir, 'agentbridge-archive');
    const archiveDir = path.join(dir, 'archive', 'WATCHER');
    await writeFile(archiveDir, '2026-05.json', JSON.stringify({
      schemaVersion: 2,
      archiveSchemaVersion: 1,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'WATCHER' },
      month: '2026-05',
      providers: [{
        provider: 'claude',
        historyBuckets: [{
          dateKey: '2026-05-30',
          inputTokens: 700,
          outputTokens: 300,
          messages: 2,
          models: [{ model: 'claude-sonnet-4-20250514', inputTokens: 700, outputTokens: 300, messages: 2 }],
        }],
      }],
      exportMeta: {
        extensionVersion: '0.4.29',
        schemaVersion: 2,
        includeAnalytics: true,
        exportKind: 'historyBucketsArchive',
        archiveSchemaVersion: 1,
      },
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['claude'], nowMs: snapshotNow });
    assert.strictEqual(result.state.snapshotCount, 1);
    assert.strictEqual(result.state.providers[0].aggregate.totalTokens, 1000);
    assert.strictEqual(result.state.providers[0].windowTotals.last7d.totalTokens, 1000);
    assert.strictEqual(result.state.providers[0].modelAggregates[0].modelLabel, 'claude-sonnet-4-20250514');
  });

  await test('readPromptFuelSnapshots: malformed model aggregate entries are ignored', async () => {
    const dir = path.join(snapshotDir, 'malformed-models');
    await writeFile(dir, 'usage.json', JSON.stringify({
      schemaVersion: PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAtEpochMs: snapshotNow,
      providers: [{
        providerId: 'codex',
        aggregate: {
          totalTokens: 1200,
          totalAssistantMessages: 2,
        },
        modelTotals: [
          { modelLabel: 'gpt-5.4-codex', totalTokens: 900, turns: 1 },
          { modelLabel: '../secret/path', totalTokens: 100, turns: 1 },
          { modelLabel: 'gpt-5.4-codex', totalTokens: 100, rawPayload: 'private' },
          { providerId: 'unknown', modelLabel: 'gpt-other', totalTokens: 100 },
        ],
      }],
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['codex'], nowMs: snapshotNow });
    assert.strictEqual(result.state.providers.length, 1);
    assert.strictEqual(result.state.providers[0].modelAggregates.length, 1);
    assert.strictEqual(result.state.providers[0].modelAggregates[0].modelLabel, 'gpt-5.4-codex');
    assert.strictEqual(result.state.providers[0].modelAggregates[0].totalTokens, 900);
  });

  await test('readPromptFuelSnapshots: malformed snapshot ignored', async () => {
    const dir = path.join(snapshotDir, 'malformed');
    await writeFile(dir, 'bad.json', '{not valid json');
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, nowMs: snapshotNow });
    assert.strictEqual(result.state.providers.length, 0);
    assert.strictEqual(result.malformedRecords, 1);
  });

  await test('readPromptFuelSnapshots: unsupported schema version ignored', async () => {
    const dir = path.join(snapshotDir, 'unsupported');
    await writeFile(dir, 'unsupported.json', JSON.stringify({
      schemaVersion: 999,
      generatedAtEpochMs: snapshotNow,
      providers: [],
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, nowMs: snapshotNow });
    assert.strictEqual(result.state.providers.length, 0);
    assert.strictEqual(result.unsupportedSchemaVersions, 1);
  });

  await test('readPromptFuelSnapshots: unknown provider ignored safely', async () => {
    const dir = path.join(snapshotDir, 'unknown-provider');
    await writeFile(dir, 'unknown.json', JSON.stringify({
      schemaVersion: PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAtEpochMs: snapshotNow,
      providers: [{
        providerId: 'other-provider',
        aggregate: {
          totalTokens: 999,
          totalAssistantMessages: 9,
        },
      }, {
        providerId: 'codex',
        aggregate: {
          totalTokens: 1200,
          totalAssistantMessages: 2,
        },
      }],
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['codex'], nowMs: snapshotNow });
    assert.strictEqual(result.unknownProviders, 1);
    assert.strictEqual(result.state.providers.length, 1);
    assert.strictEqual(result.state.providers[0].providerId, 'codex');
    assert.strictEqual(result.state.providers[0].aggregate.totalTokens, 1200);
  });

  await test('applySnapshotReadResults: reading snapshots does not change local history totals', async () => {
    const localStatus = applyRefreshResults(
      createInitialStatus(['claude']),
      [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
    );
    const localHistoryRefreshed = localStatus.localHistoryLastRefreshedMs;
    const snapshotState = {
      providers: [{
        providerId: 'claude',
        generatedAtEpochMs: snapshotNow,
        aggregate: {
          totalInputTokens: 1,
          totalOutputTokens: 2,
          totalCacheCreationInputTokens: 3,
          totalCacheReadInputTokens: 4,
          totalTokens: 10,
          totalAssistantMessages: 1,
        },
      }],
      snapshotCount: 1,
      lastReadEpochMs: snapshotNow,
    };
    const updated = applySnapshotReadResults(localStatus, snapshotState);
    assert.strictEqual(updated.providerStates[0].totalTokens, 5000);
    assert.strictEqual(updated.providerStates[0].totalAssistantMessages, 2);
    assert.strictEqual(updated.localHistoryLastRefreshedMs, localHistoryRefreshed);
    assert.strictEqual(updated.snapshotState.providers[0].aggregate.totalTokens, 10);
  });

  await test('snapshots: raw private fields are not emitted into dashboard/status/tooltip strings', async () => {
    const dir = path.join(snapshotDir, 'private-fields');
    const rawPrivateValue = 'raw-provider-payload /tmp/session.jsonl credential-value';
    await writeFile(dir, 'private.json', JSON.stringify({
      schemaVersion: PROMPTFUEL_SNAPSHOT_SCHEMA_VERSION,
      generatedAtEpochMs: snapshotNow,
      privateInternalField: rawPrivateValue,
      providers: [{
        providerId: 'claude',
        sourceLabel: rawPrivateValue,
        aggregate: {
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalCacheCreationInputTokens: 0,
          totalCacheReadInputTokens: 0,
          totalTokens: 150,
          totalAssistantMessages: 1,
        },
        modelTotals: [{
          modelLabel: rawPrivateValue,
          totalTokens: 150,
          totalAssistantMessages: 1,
        }],
        rawPayload: rawPrivateValue,
      }],
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['claude'], nowMs: snapshotNow });
    const status = applySnapshotReadResults(createInitialStatus(['claude']), result.state);
    const dashboard = buildDashboardModel(status);
    const combinedUiStrings = [
      formatStatusBarText(status),
      formatTooltip(status),
      JSON.stringify(dashboard),
    ].join('\n');
    assert.ok(!combinedUiStrings.includes(rawPrivateValue), 'raw private value should not be emitted');
    assert.ok(!combinedUiStrings.includes('.jsonl'), 'filenames should not be emitted');
    assert.ok(!combinedUiStrings.includes('credential-value'), 'credential-looking values should not be emitted');
    assert.strictEqual(dashboard.snapshotAggregate.providers[0].sourceLabel, undefined);
  });

  await test('snapshots: schema 2 machine labels appear safely in dashboard and tooltip output', async () => {
    const dir = path.join(snapshotDir, 'label-sanitization');
    await writeFile(dir, 'PHOENIX-latest.json', JSON.stringify({
      schemaVersion: 2,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'PHOENIX' },
      providerUsage: [{
        provider: 'claude',
        laneLabel: 'Claude',
        stale: false,
        source: 'snapshot',
        sourceConfidence: 'snapshotOnly',
        historyBuckets: [{ dateKey: '2026-05-31', inputTokens: 200, outputTokens: 50, messages: 1, models: [{ model: 'claude-sonnet-4-20250514', inputTokens: 200, outputTokens: 50, messages: 1 }] }],
      }],
      exportMeta: { extensionVersion: '0.4.29', schemaVersion: 2, includeAnalytics: true },
    }));
    await writeFile(dir, 'WATCHER-latest.json', JSON.stringify({
      schemaVersion: 2,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'WATCHER' },
      providerUsage: [{
        provider: 'codex',
        laneLabel: 'Codex',
        stale: false,
        source: 'snapshot',
        sourceConfidence: 'snapshotOnly',
        historyBuckets: [{ dateKey: '2026-05-31', inputTokens: 100, outputTokens: 50, turns: 1, models: [{ model: 'gpt-5.4-codex', inputTokens: 100, outputTokens: 50, turns: 1 }] }],
      }],
      exportMeta: { extensionVersion: '0.4.29', schemaVersion: 2, includeAnalytics: true },
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['claude', 'codex'], nowMs: snapshotNow });
    const status = applySnapshotReadResults(createInitialStatus(['claude', 'codex']), result.state);
    const dashboard = buildDashboardModel(status);
    const combinedUiStrings = [
      formatStatusBarText(status),
      formatTooltip(status),
      JSON.stringify(dashboard),
    ].join('\n');
    assert.ok(combinedUiStrings.includes('PHOENIX'), 'safe schema 2 machine label should be emitted');
    assert.ok(combinedUiStrings.includes('WATCHER'), 'safe schema 2 machine label should be emitted');
    assert.ok(!combinedUiStrings.includes('WATCHER-latest.json'), 'snapshot filenames should not be emitted');
    assert.ok(!combinedUiStrings.includes(`${dir}`), 'snapshot paths should not be emitted');
    assert.deepStrictEqual(dashboard.snapshotAggregate.sourceLabels, ['PHOENIX', 'WATCHER']);
    assert.ok(dashboard.sourceModeTotals.find(t => t.sourceMode === 'snapshots').sourceLabels.includes('WATCHER'));
    assert.strictEqual(dashboard.snapshotAggregate.providers.find(p => p.providerId === 'claude').sourceLabel, 'PHOENIX');
    assert.strictEqual(dashboard.snapshotAggregate.providers.find(p => p.providerId === 'codex').sourceLabel, 'WATCHER');
  });

  await test('snapshots: unsafe schema 2 machine labels fall back to generic imported snapshot labels', async () => {
    const dir = path.join(snapshotDir, 'unsafe-label-fallback');
    await writeFile(dir, 'unsafe-latest.json', JSON.stringify({
      schemaVersion: 2,
      generatedAtEpochMs: snapshotNow,
      machine: { label: 'keith@example.com' },
      providerUsage: [{
        provider: 'codex',
        laneLabel: 'Codex',
        stale: false,
        source: 'snapshot',
        sourceConfidence: 'snapshotOnly',
        historyBuckets: [{ dateKey: '2026-05-31', inputTokens: 100, outputTokens: 50, turns: 1 }],
      }],
      exportMeta: { extensionVersion: '0.4.29', schemaVersion: 2, includeAnalytics: true },
    }));
    const result = await readPromptFuelSnapshots({ snapshotDir: dir, enabledProviderIds: ['codex'], nowMs: snapshotNow });
    const status = applySnapshotReadResults(createInitialStatus(['codex']), result.state);
    const dashboard = buildDashboardModel(status);
    const combinedUiStrings = [
      formatTooltip(status),
      JSON.stringify(dashboard),
    ].join('\n');
    assert.ok(!combinedUiStrings.includes('keith@example.com'), 'email-like machine label should not be emitted');
    assert.strictEqual(dashboard.snapshotAggregate.providers[0].sourceLabel, 'Imported snapshot');
  });

  await test('snapshot export: writes latest compatible aggregate-only schema to configured folder', async () => {
    const dir = path.join(snapshotDir, 'export-latest');
    const status = applyRefreshResults(
      createInitialStatus(['claude']),
      [{
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 2,
        filesFound: 1,
        localHistoryWindows: {
          today: {
            totalInputTokens: 400,
            totalOutputTokens: 300,
            totalCacheCreationInputTokens: 200,
            totalCacheReadInputTokens: 100,
            totalTokens: 1000,
            totalAssistantMessages: 2,
          },
          last5h: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, totalTokens: 0, totalAssistantMessages: 0 },
          last7d: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, totalTokens: 0, totalAssistantMessages: 0 },
          all: { totalInputTokens: 400, totalOutputTokens: 300, totalCacheCreationInputTokens: 200, totalCacheReadInputTokens: 100, totalTokens: 1000, totalAssistantMessages: 2 },
        },
        modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
        localHistoryModelWindows: {
          today: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
          last5h: [],
          last7d: [],
          all: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
        },
      }],
    );
    const filePath = await exportPromptFuelUsageSnapshot(status, dir, snapshotNow);
    assert.strictEqual(path.dirname(filePath), dir);
    const exported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(exported.schemaVersion, 2);
    assert.strictEqual(exported.machine.label, 'promptfuel');
    assert.strictEqual(exported.providerUsage[0].provider, 'claude');
    assert.strictEqual(exported.providerUsage[0].historyBuckets[0].inputTokens, 400);
    assert.strictEqual(exported.providerUsage[0].historyBuckets[0].models[0].model, 'claude-sonnet-4-20250514');
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['.jsonl', 'D:\\', 'keith', 'PHOENIX', 'WATCHER', 'token', 'secret']) {
      assert.ok(!serialized.includes(forbidden), `export should not include ${forbidden}`);
    }
  });

  await test('snapshot export: builder always emits latest compatible schema version', async () => {
    const exported = buildPromptFuelUsageSnapshot(createInitialStatus(['claude']), snapshotNow);
    assert.strictEqual(exported.schemaVersion, 2);
    assert.strictEqual(exported.exportMeta.schemaVersion, 2);
  });

  // ===== statusModel: hasAnyLoaded / hasAnyError =====

  await test('hasAnyLoaded: true when at least one provider loaded', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyLoaded(updated), true);
  });

  await test('hasAnyLoaded: false when no provider loaded', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyLoaded(updated), false);
  });

  await test('hasAnyError: true when at least one provider errored', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyError(updated), true);
  });

  await test('hasAnyError: false when no provider errored', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyError(updated), false);
  });

  // ===== formatStatusBarText: live quota status bar =====

  await test('formatStatusBarText: all providers no-data shows live quota loading', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const text = formatStatusBarText(status);
    assert.strictEqual(text, 'PromptFuel: live quota loading');
  });

  await test('formatStatusBarText: one provider loaded does not mask loading live quota', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    const text = formatStatusBarText(updated);
    assert.strictEqual(text, 'PromptFuel: live quota loading');
    assert.ok(!text.includes('12.4K'), `local history should not be primary in "${text}"`);
  });

  await test('formatStatusBarText: both providers loaded keeps live quota primary', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3100, totalAssistantMessages: 2, filesFound: 1 },
    ]);
    const text = formatStatusBarText(updated);
    assert.strictEqual(text, 'PromptFuel: live quota loading');
    assert.ok(!text.includes('15.5K'), `local history should not be primary in "${text}"`);
    assert.ok(!text.includes('⛽'), `should not include emoji in "${text}"`);
  });

  await test('formatStatusBarText: local error keeps live quota primary', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
    ]);
    const text = formatStatusBarText(updated);
    assert.strictEqual(text, 'PromptFuel: live quota loading');
  });

  await test('formatStatusBarText: mixed local states keep live quota primary', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ]);
    const text = formatStatusBarText(updated);
    assert.strictEqual(text, 'PromptFuel: live quota loading');
    assert.ok(!text.includes('5.0K'), `local history should not be primary in "${text}"`);
  });

  // ===== formatTooltip =====

  await test('formatTooltip: initial state shows live quota loading first', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const tooltip = formatTooltip(status);
    assert.ok(tooltip.includes('PromptFuel'), `expected "PromptFuel" in tooltip`);
    assert.ok(tooltip.includes('Live quota loading'), `expected "Live quota loading" in tooltip`);
    assert.ok(!tooltip.includes('## Usage history'), `usage history section should be omitted`);
    assert.ok(!tooltip.includes('Local history only'), `should not lead with local history only`);
    assert.ok(!tooltip.includes('no local data'), `local usage details should be omitted`);
    assert.ok(!tooltip.includes('Local history refreshed'), 'should not show refresh time before first refresh');
  });

  await test('formatTooltip: loaded state omits local usage but keeps refresh time', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 25000, totalAssistantMessages: 7, filesFound: 4 },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(tooltip.includes('Claude'), `expected "Claude" in tooltip`);
    assert.ok(!tooltip.includes('loaded'), `local usage status should be omitted from tooltip`);
    assert.ok(!tooltip.includes('25.0K'), `local token total should be omitted from tooltip`);
    assert.ok(!tooltip.includes('7 messages'), `local message total should be omitted from tooltip`);
    assert.ok(tooltip.includes('Local history refreshed'), `expected "Local history refreshed" in tooltip`);
  });

  await test('formatTooltip: error state omits local read error', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(!tooltip.includes('read error'), `local read error should be omitted from tooltip`);
  });

  await test('formatTooltip: local history refreshed shows time', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(tooltip.includes('Local history refreshed:'), `expected "Local history refreshed:" in tooltip`);
    const timeMatch = tooltip.match(/Local history refreshed: (\d{2}:\d{2}:\d{2})/);
    assert.ok(timeMatch, `expected HH:MM:SS format in tooltip`);
  });

  await test('formatTooltip: multiple providers shown on separate lines', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    const tooltip = formatTooltip(updated);
    const lines = tooltip.split('\n');
    assert.ok(lines.length >= 3, `expected at least 3 lines in tooltip, got ${lines.length}`);
    assert.ok(lines.some(l => l.includes('Claude')), 'expected Claude line');
    assert.ok(lines.some(l => l.includes('Codex')), 'expected Codex line');
  });

  // ===== formatTokenCount =====

  await test('formatTokenCount: M suffix for >= 1M', async () => {
    assert.strictEqual(formatTokenCount(2_500_000), '2.5M tokens');
  });

  await test('formatTokenCount: K suffix for >= 1K', async () => {
    assert.strictEqual(formatTokenCount(12_400), '12.4K tokens');
  });

  await test('formatTokenCount: raw number for < 1K', async () => {
    assert.strictEqual(formatTokenCount(500), '500 tokens');
  });

  await test('formatTokenCount: zero', async () => {
    assert.strictEqual(formatTokenCount(0), '0 tokens');
  });

  // ===== formatRefreshSummary =====

  await test('formatRefreshSummary: empty results returns no-providers message', async () => {
    const s = formatRefreshSummary([]);
    assert.ok(s.includes('no providers'), `expected "no providers" in "${s}"`);
  });

  await test('formatRefreshSummary: not-found includes label and "not found"', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'not-found' }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('not found'), `expected "not found" in "${s}"`);
  });

  await test('formatRefreshSummary: ok includes aggregate data', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 3,
      totalAssistantMessages: 5,
      totalTokens: 15000,
    }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('5'), `expected message count "5" in "${s}"`);
    assert.ok(s.includes('K tokens'), `expected "K tokens" in "${s}"`);
    assert.ok(!s.includes('.jsonl'), `should not include file extensions in "${s}"`);
    assert.ok(!s.includes('\\'), `should not include backslashes in "${s}"`);
    assert.ok(!s.includes('/'), `should not include slashes in "${s}"`);
  });

  await test('formatRefreshSummary: ok with 1 file omits file count', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'ok', filesFound: 1, totalAssistantMessages: 1, totalTokens: 200 }]);
    assert.ok(!s.includes('file'), `should not include file count in "${s}"`);
    assert.ok(!s.includes('files'), `should not include files in "${s}"`);
  });

  await test('formatRefreshSummary: no-data includes label and "no local usage history"', async () => {
    const s = formatRefreshSummary([{ providerId: 'codex', status: 'no-data', filesFound: 0 }]);
    assert.ok(s.includes('Codex'), `expected "Codex" in "${s}"`);
    assert.ok(s.includes('no local usage history'), `expected "no local usage history" in "${s}"`);
  });

  await test('formatRefreshSummary: error includes label and "read error"', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'error' }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('read error'), `expected "read error" in "${s}"`);
  });

  await test('formatRefreshSummary: mixed states joined with " | "', async () => {
    const s = formatRefreshSummary([
      { providerId: 'claude', status: 'ok', filesFound: 3 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.ok(s.includes(' | '), `expected " | " separator in "${s}"`);
  });

  await test('formatRefreshSummary: parse errors shown in summary', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 2,
      totalAssistantMessages: 1,
      totalTokens: 500,
      parseErrors: 3,
    }]);
    assert.ok(s.includes('Parse errors: 3 lines skipped'), `expected parse error skipped wording in "${s}"`);
  });

  await test('formatRefreshSummary: single parse error uses singular', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 1,
      totalAssistantMessages: 1,
      totalTokens: 200,
      parseErrors: 1,
    }]);
    assert.ok(s.includes('Parse errors: 1 line skipped'), `expected singular parse error skipped wording in "${s}"`);
    assert.ok(!s.includes('1 lines skipped'), `expected singular "line" in "${s}"`);
  });

  await test('formatRefreshSummary: large token counts use M suffix', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 2,
      totalAssistantMessages: 10,
      totalTokens: 2500000,
    }]);
    assert.ok(s.includes('2.5M'), `expected "2.5M" in "${s}"`);
  });

  await test('formatRefreshSummary: small token counts show raw number', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 1,
      totalAssistantMessages: 1,
      totalTokens: 500,
    }]);
    assert.ok(s.includes('500'), `expected "500" in "${s}"`);
    assert.ok(s.includes('tokens'), `expected "tokens" in "${s}"`);
  });

  // ===== ClaudeLocalReader integration =====

  await test('ClaudeLocalReader: returns not-found for absent path', async () => {
    const reader = new ClaudeLocalReader(ABSENT);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'claude');
    assert.strictEqual(result.status, 'not-found');
  });

  await test('ClaudeLocalReader: providerId is claude', async () => {
    const reader = new ClaudeLocalReader(ABSENT);
    assert.strictEqual(reader.providerId, 'claude');
  });

  // Claude parser: valid fixture
  const claudeValid = path.join(FIXTURE_DIR, 'claude-valid');
  await createClaudeFixture(claudeValid, [
    {
      type: 'assistant',
      timestamp: Date.now(),
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 1200,
          output_tokens: 800,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 200,
        },
      },
    },
    {
      type: 'assistant',
      timestamp: Date.now() + 1000,
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 500,
          output_tokens: 300,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      },
    },
  ]);

  await test('ClaudeLocalReader: parses valid fixture and returns aggregate', async () => {
    const reader = new ClaudeLocalReader(claudeValid);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'claude');
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 2);
    assert.strictEqual(result.totalInputTokens, 1700);
    assert.strictEqual(result.totalOutputTokens, 1100);
    assert.strictEqual(result.totalTokens, 3450);
    assert.strictEqual(result.modelAggregates[0].providerId, 'claude');
    assert.strictEqual(result.modelAggregates[0].modelLabel, 'claude-sonnet-4-20250514');
    assert.strictEqual(result.modelAggregates[0].totalTokens, 3450);
    assert.strictEqual(result.modelAggregates[0].totalAssistantMessages, 2);
    assert.strictEqual(result.localHistoryModelWindows.all[0].modelLabel, 'claude-sonnet-4-20250514');
  });

  // Claude parser: timestamp windows
  const claudeWindowed = path.join(FIXTURE_DIR, 'claude-windowed');
  const windowNow = new Date('2026-05-31T20:00:00.000Z').getTime();
  await createClaudeFixture(claudeWindowed, [
    {
      type: 'assistant',
      timestamp: windowNow - 2 * 60 * 60 * 1000,
      message: { usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      timestamp: windowNow - 6 * 60 * 60 * 1000,
      message: { usage: { input_tokens: 200, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      timestamp: windowNow - 2 * 24 * 60 * 60 * 1000,
      message: { usage: { input_tokens: 300, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      timestamp: windowNow - 8 * 24 * 60 * 60 * 1000,
      message: { usage: { input_tokens: 400, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      message: { usage: { input_tokens: 500, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
    {
      type: 'assistant',
      timestamp: 'invalid timestamp',
      message: { usage: { input_tokens: 600, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
  ]);

  await test('parseClaudeUsage: returns timestamp-aware local history windows', async () => {
    const result = await parseClaudeUsage(claudeWindowed, { nowMs: windowNow });
    assert.strictEqual(result.aggregate.totalTokens, 2100, 'all-history aggregate should be unchanged');
    assert.strictEqual(result.localHistoryWindows.all.totalTokens, 2100);
    assert.strictEqual(result.localHistoryWindows.today.totalTokens, 300);
    assert.strictEqual(result.localHistoryWindows.last5h.totalTokens, 100);
    assert.strictEqual(result.localHistoryWindows.last7d.totalTokens, 600);
    assert.strictEqual(result.localHistoryWindows.all.totalAssistantMessages, 6);
    assert.strictEqual(result.localHistoryWindows.last7d.totalAssistantMessages, 3);
    assert.strictEqual(result.modelAggregates[0].modelLabel, 'Unknown model');
    assert.strictEqual(result.modelAggregates[0].totalTokens, 2100);
    assert.strictEqual(result.localHistoryModelWindows.last7d[0].modelLabel, 'Unknown model');
    assert.strictEqual(result.localHistoryModelWindows.last7d[0].totalTokens, 600);
  });

  // Claude parser: malformed lines
  const claudeMalformed = path.join(FIXTURE_DIR, 'claude-malformed');
  await createClaudeFixture(claudeMalformed, [
    {
      type: 'assistant',
      timestamp: Date.now(),
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ]);
  const malformedFile = path.join(claudeMalformed, 'session.jsonl');
  await fsp.appendFile(malformedFile, 'this is not valid json\n', 'utf8');
  await fsp.appendFile(malformedFile, '{broken json\n', 'utf8');

  await test('ClaudeLocalReader: skips malformed lines gracefully', async () => {
    const reader = new ClaudeLocalReader(claudeMalformed);
    const result = await reader.read();
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 1);
    assert.ok(result.parseErrors >= 2, `expected parseErrors >= 2, got ${result.parseErrors}`);
  });

  // Claude parser: NUL-padded line recovered
  const claudeNulPadded = path.join(FIXTURE_DIR, 'claude-nul-padded');
  const nul = String.fromCharCode(0);
  await writeFile(claudeNulPadded, 'session.jsonl', nul + JSON.stringify({
    type: 'assistant',
    timestamp: Date.now(),
    message: {
      usage: {
        input_tokens: 700,
        output_tokens: 300,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }) + nul + '\n');

  await test('parseClaudeUsage: recovers boundary NUL-padded records without parse errors', async () => {
    const result = await parseClaudeUsage(claudeNulPadded);
    assert.strictEqual(result.stats.parseErrors, 0);
    assert.strictEqual(result.stats.recordsMatched, 1);
    assert.strictEqual(result.aggregate.totalTokens, 1000);
  });

  // Claude parser: no assistant records
  const claudeNoMatch = path.join(FIXTURE_DIR, 'claude-no-match');
  await createClaudeFixture(claudeNoMatch, [
    { type: 'human', timestamp: Date.now(), message: { content: 'hello' } },
    { type: 'system', timestamp: Date.now(), message: { content: 'be helpful' } },
  ]);

  await test('ClaudeLocalReader: returns no-data when no assistant records', async () => {
    const reader = new ClaudeLocalReader(claudeNoMatch);
    const result = await reader.read();
    assert.strictEqual(result.status, 'no-data');
    assert.strictEqual(result.recordsMatched, 0);
  });

  // ===== CodexLocalReader integration =====

  await test('CodexLocalReader: returns not-found for absent path', async () => {
    const reader = new CodexLocalReader(ABSENT);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'codex');
    assert.strictEqual(result.status, 'not-found');
  });

  await test('CodexLocalReader: providerId is codex', async () => {
    const reader = new CodexLocalReader(ABSENT);
    assert.strictEqual(reader.providerId, 'codex');
  });

  // Codex parser: valid fixture
  const codexValid = path.join(FIXTURE_DIR, 'codex-valid');
  await createCodexFixture(codexValid, [
    {
      type: 'tool_use',
      timestamp: Date.now(),
      payload: {
        model: 'gpt-5.4-codex',
        info: {
          last_token_usage: {
            input_tokens: 2000,
            output_tokens: 1500,
            cached_input_tokens: 400,
          },
        },
      },
    },
    {
      type: 'tool_use',
      timestamp: Date.now() + 1000,
      payload: {
        model: 'gpt-5.4-codex',
        info: {
          last_token_usage: {
            input_tokens: 800,
            output_tokens: 600,
            cached_input_tokens: 200,
          },
        },
      },
    },
  ]);

  await test('CodexLocalReader: parses valid fixture and returns aggregate', async () => {
    const reader = new CodexLocalReader(codexValid);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'codex');
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 2);
    assert.strictEqual(result.totalInputTokens, 2800);
    assert.strictEqual(result.totalOutputTokens, 2100);
    assert.strictEqual(result.modelAggregates[0].providerId, 'codex');
    assert.strictEqual(result.modelAggregates[0].modelLabel, 'gpt-5.4-codex');
    assert.strictEqual(result.modelAggregates[0].totalTokens, 5500);
    assert.strictEqual(result.modelAggregates[0].totalAssistantMessages, 2);
  });

  // Codex parser: timestamp windows
  const codexWindowed = path.join(FIXTURE_DIR, 'codex-windowed');
  await createCodexFixture(codexWindowed, [
    {
      type: 'tool_use',
      timestamp: new Date(windowNow - 1 * 60 * 60 * 1000).toISOString(),
      payload: { info: { last_token_usage: { input_tokens: 600, output_tokens: 400, cached_input_tokens: 0 } } },
    },
    {
      type: 'tool_use',
      timestamp: new Date(windowNow - 6 * 24 * 60 * 60 * 1000).toISOString(),
      payload: { info: { last_token_usage: { input_tokens: 1000, output_tokens: 1000, cached_input_tokens: 0 } } },
    },
    {
      type: 'tool_use',
      payload: { info: { last_token_usage: { input_tokens: 1500, output_tokens: 1500, cached_input_tokens: 0 } } },
    },
    {
      type: 'tool_use',
      timestamp: 'not a timestamp',
      payload: { info: { last_token_usage: { input_tokens: 2000, output_tokens: 2000, cached_input_tokens: 0 } } },
    },
  ]);

  await test('parseCodexUsage: returns timestamp-aware local history windows', async () => {
    const result = await parseCodexUsage(codexWindowed, { nowMs: windowNow });
    assert.strictEqual(result.aggregate.totalTokens, 10000, 'all-history aggregate should be unchanged');
    assert.strictEqual(result.localHistoryWindows.all.totalTokens, 10000);
    assert.strictEqual(result.localHistoryWindows.today.totalTokens, 1000);
    assert.strictEqual(result.localHistoryWindows.last5h.totalTokens, 1000);
    assert.strictEqual(result.localHistoryWindows.last7d.totalTokens, 3000);
    assert.strictEqual(result.localHistoryWindows.all.totalAssistantMessages, 4);
    assert.strictEqual(result.localHistoryWindows.last7d.totalAssistantMessages, 2);
  });

  // Codex parser: malformed lines
  const codexMalformed = path.join(FIXTURE_DIR, 'codex-malformed');
  await createCodexFixture(codexMalformed, [
    {
      type: 'tool_use',
      timestamp: Date.now(),
      payload: {
        info: {
          last_token_usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
          },
        },
      },
    },
  ]);
  const codexMalformedFile = path.join(codexMalformed, 'session.jsonl');
  await fsp.appendFile(codexMalformedFile, 'not json at all\n', 'utf8');

  await test('CodexLocalReader: skips malformed lines gracefully', async () => {
    const reader = new CodexLocalReader(codexMalformed);
    const result = await reader.read();
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 1);
    assert.ok(result.parseErrors >= 1, `expected parseErrors >= 1, got ${result.parseErrors}`);
  });

  // Codex parser: active-file tail artifacts
  const codexTailArtifacts = path.join(FIXTURE_DIR, 'codex-tail-artifacts');
  const codexTailRecord = {
    type: 'tool_use',
    timestamp: Date.now(),
    payload: {
      info: {
        last_token_usage: {
          input_tokens: 400,
          output_tokens: 100,
          cached_input_tokens: 0,
        },
      },
    },
  };

  await writeFile(
    codexTailArtifacts,
    'nul-tail.jsonl',
    JSON.stringify(codexTailRecord) + '\n' + String.fromCharCode(0).repeat(16),
  );

  await writeFile(
    codexTailArtifacts,
    'partial-tail.jsonl',
    JSON.stringify(codexTailRecord) + '\n{"type":"tool_use"',
  );

  await test('parseCodexUsage: ignores NUL-only and unfinished final tails without parse errors', async () => {
    const result = await parseCodexUsage(codexTailArtifacts);
    assert.strictEqual(result.stats.parseErrors, 0);
    assert.strictEqual(result.stats.recordsMatched, 2);
    assert.strictEqual(result.aggregate.totalTokens, 1000);
  });

  // Codex parser: no usage records
  const codexNoMatch = path.join(FIXTURE_DIR, 'codex-no-match');
  await createCodexFixture(codexNoMatch, [
    { type: 'session_meta', timestamp: Date.now(), payload: { id: 'test-session' } },
    { type: 'user', timestamp: Date.now(), payload: { content: 'hello' } },
  ]);

  await test('CodexLocalReader: returns no-data when no usage records', async () => {
    const reader = new CodexLocalReader(codexNoMatch);
    const result = await reader.read();
    assert.strictEqual(result.status, 'no-data');
    assert.strictEqual(result.recordsMatched, 0);
  });

  // ===== runEnabledReaders =====

  await test('runEnabledReaders: empty enabledProviders returns empty array', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, []);
    assert.strictEqual(results.length, 0);
  });

  await test('runEnabledReaders: only enabled providers run', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['claude']);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].providerId, 'claude');
  });

  await test('runEnabledReaders: unknown provider id is skipped', async () => {
    const readers = [new ClaudeLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['openai']);
    assert.strictEqual(results.length, 0);
  });

  await test('runEnabledReaders: both providers run when both enabled', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['claude', 'codex']);
    assert.strictEqual(results.length, 2);
    const ids = results.map(r => r.providerId).sort();
    assert.deepStrictEqual(ids, ['claude', 'codex']);
  });

  // ===== Authenticated quota window mapping (synthetic data) =====

  await test('parseClaudeWindow: five_hour maps to 5h', async () => {
    const w = authTest.parseClaudeWindow('5h', { utilization: 0.45, resets_at: Date.now() / 1000 + 5000 });
    assert.strictEqual(w.windowId, '5h', 'five_hour should map to 5h');
  });

  await test('parseClaudeWindow: seven_day maps to 7d', async () => {
    const w = authTest.parseClaudeWindow('7d', { utilization: 0.3, resets_at: Date.now() / 1000 + 70000 });
    assert.strictEqual(w.windowId, '7d', 'seven_day should map to 7d');
  });

  await test('parseClaudeWindow: undefined window returns undefined', async () => {
    const w = authTest.parseClaudeWindow('5h', undefined);
    assert.strictEqual(w, undefined);
  });

  await test('parseCodexWindow: 18000s window maps to 5h', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 18000, used_percent: 50 }, 18000);
    assert.strictEqual(w.windowId, '5h', '18000s should map to 5h');
  });

  await test('parseCodexWindow: 604800s window maps to 7d', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 604800, used_percent: 20 }, 604800);
    assert.strictEqual(w.windowId, '7d', '604800s should map to 7d');
  });

  await test('parseCodexWindow: mismatched seconds returns undefined', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 99999, used_percent: 50 }, 18000);
    assert.strictEqual(w, undefined);
  });

  await test('buildWindow: preserves windowId', async () => {
    const w = authTest.buildWindow('7d', 50, Math.floor(Date.now() / 1000) + 86400);
    assert.strictEqual(w.windowId, '7d');
    assert.strictEqual(w.usedPercentage, 50);
    assert.strictEqual(w.remainingPercentage, 50);
  });

  console.log('');
  console.log(`smoke-providers: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('smoke-providers: fatal error:', e);
  process.exit(1);
});
