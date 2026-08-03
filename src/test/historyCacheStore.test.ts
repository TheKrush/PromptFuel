import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HISTORY_CACHE_STORE_FILE,
  HISTORY_CACHE_STORE_VERSION,
  loadHistoryCacheStore,
  saveHistoryCacheStore
} from '../providers/historyCacheStore';
import {
  makeClaudeHistoryCache,
  makeCodexHistoryCache,
  readClaudeHistoryIncremental
} from '../providers/historyCache';
import type { ClaudeDayContribution, ClaudeDayModelContribution, ClaudeFileContribution } from '../providers/claudeDayBucketScanner';
import type { CodexDayContribution, CodexDayModelContribution, CodexFileContribution } from '../providers/codexCorrelatedDayBucketScanner';

const REVISION = 'test-rev-v1';

function claudeRecord(model: string, isoTimestamp: string, input: number, output: number): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: isoTimestamp,
    message: { model, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
  });
}

function claudeContributionFixture(): ClaudeFileContribution {
  const modelBreakdown = new Map<string, ClaudeDayModelContribution>([
    ['claude-sonnet-4-6', { assistantMessages: 2, inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 5, cacheReadInputTokens: 3 }]
  ]);
  const days = new Map<string, ClaudeDayContribution>([
    ['2026-05-15', { assistantMessages: 2, inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 5, cacheReadInputTokens: 3, modelBreakdown }]
  ]);
  return { days, recordsRead: 3, recordsMatched: 2 };
}

function codexContributionFixture(): CodexFileContribution {
  const modelBreakdown = new Map<string, CodexDayModelContribution>([
    ['gpt-5.4', { correlatedTurns: 1, inputTokens: 200, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 210 }]
  ]);
  const days = new Map<string, CodexDayContribution>([
    ['2026-05-15', { correlatedTurns: 1, inputTokens: 200, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 210, modelBreakdown }]
  ]);
  return {
    days, recordsRead: 5, recordsMatched: 1,
    skippedMissingTokenData: 0, skippedMissingModel: 0, skippedMissingBaseline: 0, skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0, skippedTokenCountOutsideTurn: 0, skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0
  };
}

function populatedClaudeCache(): ReturnType<typeof makeClaudeHistoryCache> {
  const cache = makeClaudeHistoryCache();
  cache.dirPath = 'C:\\projects\\claude';
  cache.dateKey = '2026-05-15';
  cache.entries.set('C:\\projects\\claude\\a.jsonl', {
    mtimeMs: 123456789000,
    size: 1024,
    contribution: claudeContributionFixture()
  });
  return cache;
}

function populatedCodexCache(): ReturnType<typeof makeCodexHistoryCache> {
  const cache = makeCodexHistoryCache();
  cache.dirPath = 'C:\\sessions\\codex';
  cache.dateKey = '2026-05-15';
  cache.entries.set('C:\\sessions\\codex\\session.jsonl', {
    mtimeMs: 123456789000,
    size: 2048,
    contribution: codexContributionFixture()
  });
  return cache;
}

describe('history cache store', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-history-store-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function storePath(name: string): string {
    return path.join(tmpDir, name, HISTORY_CACHE_STORE_FILE);
  }

  it('16. saves then loads both provider caches round-trip', async () => {
    const file = storePath('roundtrip');
    const claude = populatedClaudeCache();
    const codex = populatedCodexCache();
    await saveHistoryCacheStore(file, claude, codex, REVISION);

    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, true);
    assert.equal(loaded.claude.dirPath, claude.dirPath);
    assert.equal(loaded.claude.dateKey, claude.dateKey);
    assert.equal(loaded.codex.dirPath, codex.dirPath);
    assert.equal(loaded.codex.dateKey, codex.dateKey);
    assert.equal(loaded.claude.entries.size, 1);
    assert.equal(loaded.codex.entries.size, 1);

    const claudeEntry = [...loaded.claude.entries.values()][0];
    assert.equal(claudeEntry.mtimeMs, 123456789000);
    assert.equal(claudeEntry.size, 1024);
    assert.equal(claudeEntry.contribution.recordsRead, 3);
    const day = claudeEntry.contribution.days.get('2026-05-15');
    assert.ok(day);
    assert.equal(day!.assistantMessages, 2);
    assert.equal(day!.inputTokens, 100);
    assert.equal(day!.modelBreakdown.get('claude-sonnet-4-6')!.inputTokens, 100);

    const codexEntry = [...loaded.codex.entries.values()][0];
    assert.equal(codexEntry.contribution.recordsMatched, 1);
    assert.equal(codexEntry.contribution.days.get('2026-05-15')!.correlatedTurns, 1);
  });

  it('17. load returns empty caches when the store file is absent', async () => {
    const file = storePath('absent');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'not-present');
    assert.equal(loaded.claude.entries.size, 0);
    assert.equal(loaded.codex.entries.size, 0);
  });

  it('18. load discards the store on an unsupported schema version', async () => {
    const file = storePath('version');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ ...parsedStore(), version: HISTORY_CACHE_STORE_VERSION + 1 }), 'utf8');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'incompatible-version');
    assert.equal(loaded.claude.entries.size, 0);
  });

  it('19. load discards the store on a scanner revision mismatch', async () => {
    const file = storePath('revision');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ ...parsedStore(), scannerRevision: 'other-rev' }), 'utf8');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'scanner-revision-mismatch');
    assert.equal(loaded.claude.entries.size, 0);
  });

  it('20. load discards the store on corrupt JSON', async () => {
    const file = storePath('corrupt');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not valid json', 'utf8');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'corrupt-json');
    assert.equal(loaded.claude.entries.size, 0);
  });

  it('21. load discards the store on a structurally incompatible entry', async () => {
    const file = storePath('incompatible');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const store = parsedStore();
    (store.claude.files[0].days as unknown) = { '2026-05-15': { assistantMessages: 'many' } };
    await fs.writeFile(file, JSON.stringify(store), 'utf8');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'incompatible-claude-entry');
    assert.equal(loaded.claude.entries.size, 0);
    assert.equal(loaded.codex.entries.size, 0);
  });

  it('21b. load discards the store on a negative numeric field', async () => {
    const file = storePath('negative');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const store = parsedStore();
    store.claude.files[0].days['2026-05-15'].inputTokens = -1;
    await fs.writeFile(file, JSON.stringify(store), 'utf8');
    const loaded = await loadHistoryCacheStore(file, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, false);
    assert.equal(loaded.discardedReason, 'incompatible-claude-entry');
    assert.equal(loaded.claude.entries.size, 0);
    assert.equal(loaded.codex.entries.size, 0);
  });

  it('22. saving identical content does not rewrite the store', async () => {
    const file = storePath('dedup');
    const claude = populatedClaudeCache();
    const codex = populatedCodexCache();
    await saveHistoryCacheStore(file, claude, codex, REVISION);
    const stat1 = await fs.stat(file);

    const oldStamp = new Date(2000, 0, 1);
    await fs.utimes(file, oldStamp, oldStamp);

    await saveHistoryCacheStore(file, claude, codex, REVISION);
    const stat2 = await fs.stat(file);
    assert.equal(stat2.mtimeMs, oldStamp.getTime(), 'identical payload must skip the write');
  });

  it('23. save leaves no temp file behind after success', async () => {
    const dir = path.join(tmpDir, 'no-temp');
    const file = storePath('no-temp');
    await saveHistoryCacheStore(file, populatedClaudeCache(), populatedCodexCache(), REVISION);
    const leftovers = (await fs.readdir(dir)).filter(name => name.includes('.tmp.'));
    assert.deepEqual(leftovers, []);
  });

  it('24. a store-reloaded cache reuses contributions without rescanning', async () => {
    const dir = path.join(tmpDir, 'reuse');
    await fs.mkdir(path.join(dir, 'proj', 's1'), { recursive: true });
    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    const filePath = path.join(dir, 'proj', 's1', 'a.jsonl');
    await fs.writeFile(filePath, claudeRecord('claude-sonnet-4-6', ts, 100, 40));

    const cacheA = makeClaudeHistoryCache();
    await readClaudeHistoryIncremental(path.join(dir, 'proj'), 30, cacheA, new Date(2026, 4, 15));
    const storeFile = path.join(dir, HISTORY_CACHE_STORE_FILE);
    await saveHistoryCacheStore(storeFile, cacheA, makeCodexHistoryCache(), REVISION);

    const loaded = await loadHistoryCacheStore(storeFile, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, true);
    const [cachedFile, cachedEntry] = [...loaded.claude.entries.entries()][0];
    assert.equal(cachedFile, filePath);
    assert.equal(cachedEntry.contribution.recordsRead, 1);

    const result = await readClaudeHistoryIncremental(path.join(dir, 'proj'), 30, loaded.claude, new Date(2026, 4, 15));
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.inputTokens, 100);
    const [, entryAfter] = [...loaded.claude.entries.entries()][0];
    assert.strictEqual(entryAfter.contribution, cachedEntry.contribution, 'reader must reuse the store-loaded contribution');
  });

  it('25. a file deleted from disk drops out of the next persisted store round trip', async () => {
    const dir = path.join(tmpDir, 'delete-roundtrip');
    await fs.mkdir(path.join(dir, 'proj', 's1'), { recursive: true });
    const ts = new Date(2026, 4, 15, 10, 0, 0).toISOString();
    const filePath = path.join(dir, 'proj', 's1', 'a.jsonl');
    await fs.writeFile(filePath, claudeRecord('claude-sonnet-4-6', ts, 100, 40));

    const cache = makeClaudeHistoryCache();
    await readClaudeHistoryIncremental(path.join(dir, 'proj'), 30, cache, new Date(2026, 4, 15));
    assert.equal(cache.entries.size, 1);

    await fs.rm(filePath);
    await readClaudeHistoryIncremental(path.join(dir, 'proj'), 30, cache, new Date(2026, 4, 15));
    assert.equal(cache.entries.size, 0, 'deleted file must drop out of the in-memory cache before the next persist');

    const storeFile = path.join(dir, HISTORY_CACHE_STORE_FILE);
    await saveHistoryCacheStore(storeFile, cache, makeCodexHistoryCache(), REVISION);
    const loaded = await loadHistoryCacheStore(storeFile, { scannerRevision: REVISION });
    assert.equal(loaded.loaded, true);
    assert.equal(loaded.claude.entries.size, 0, 'deleted file must not reappear after a store round trip');
  });

  // Parses the shape produced by saveHistoryCacheStore into a mutable object so
  // tests can corrupt a single field.
  function parsedStore(): any {
    return {
      version: HISTORY_CACHE_STORE_VERSION,
      scannerRevision: REVISION,
      claude: {
        dirPath: 'C:\\projects\\claude',
        dateKey: '2026-05-15',
        files: [{
          file: 'C:\\projects\\claude\\a.jsonl',
          mtimeMs: 123456789000,
          size: 1024,
          recordsRead: 3,
          recordsMatched: 2,
          days: {
            '2026-05-15': {
              assistantMessages: 2,
              inputTokens: 100,
              outputTokens: 40,
              cacheCreationInputTokens: 5,
              cacheReadInputTokens: 3,
              modelBreakdown: {
                'claude-sonnet-4-6': {
                  assistantMessages: 2, inputTokens: 100, outputTokens: 40,
                  cacheCreationInputTokens: 5, cacheReadInputTokens: 3
                }
              }
            }
          }
        }]
      },
      codex: {
        dirPath: 'C:\\sessions\\codex',
        dateKey: '2026-05-15',
        files: [{
          file: 'C:\\sessions\\codex\\session.jsonl',
          mtimeMs: 123456789000,
          size: 2048,
          recordsRead: 5,
          recordsMatched: 1,
          skippedMissingTokenData: 0, skippedMissingModel: 0, skippedMissingBaseline: 0, skippedNegativeDelta: 0,
          skippedTaskStartedWithoutTurnId: 0, skippedTokenCountOutsideTurn: 0, skippedCloseWithoutTurn: 0,
          skippedCompletionTimestampMissing: 0,
          days: {
            '2026-05-15': {
              correlatedTurns: 1, inputTokens: 200, outputTokens: 10, cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 210,
              modelBreakdown: {
                'gpt-5.4': {
                  correlatedTurns: 1, inputTokens: 200, outputTokens: 10, cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 210
                }
              }
            }
          }
        }]
      }
    };
  }
});
