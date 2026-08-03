import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cleanupTempSnapshotFile } from '../snapshot/cleanupSnapshotFiles';
import type { ClaudeDayContribution, ClaudeDayModelContribution, ClaudeFileContribution } from './claudeDayBucketScanner';
import type { CodexDayContribution, CodexDayModelContribution, CodexFileContribution } from './codexCorrelatedDayBucketScanner';
import { makeClaudeHistoryCache, makeCodexHistoryCache, type ClaudeHistoryCache, type CodexHistoryCache } from './historyCache';

// ---------------------------------------------------------------------------
// Versioned on-disk persistence for the per-file history contribution cache.
//
// Schema versioning: the store file name is versioned (history-cache-store-v1.json)
// and the payload carries a version number plus the scanner revision that produced
// it. A mismatched version, missing scannerRevision, or structurally incompatible
// payload is treated as an empty cache (fail-open) so a changed scanner never
// reuses stale contributions.
// ---------------------------------------------------------------------------

export const HISTORY_CACHE_STORE_VERSION = 1;
export const HISTORY_CACHE_STORE_FILE = 'history-cache-store-v1.json';

export interface HistoryCacheStoreOptions {
  scannerRevision: string;
  onSanitizedLog?: (message: string) => void;
}

export interface LoadHistoryCacheStoreResult {
  claude: ClaudeHistoryCache;
  codex: CodexHistoryCache;
  loaded: boolean;
  discardedReason?: string;
}

export interface ClaudeStoredDayContribution {
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  modelBreakdown: Record<string, ClaudeDayModelContribution>;
}

export interface CodexStoredDayContribution {
  correlatedTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  modelBreakdown: Record<string, CodexDayModelContribution>;
}

interface ClaudeStoredFileEntry {
  file: string;
  mtimeMs: number;
  size: number;
  recordsRead: number;
  recordsMatched: number;
  days: Record<string, ClaudeStoredDayContribution>;
}

interface CodexStoredFileEntry {
  file: string;
  mtimeMs: number;
  size: number;
  recordsRead: number;
  recordsMatched: number;
  skippedMissingTokenData: number;
  skippedMissingModel: number;
  skippedMissingBaseline: number;
  skippedNegativeDelta: number;
  skippedTaskStartedWithoutTurnId: number;
  skippedTokenCountOutsideTurn: number;
  skippedCloseWithoutTurn: number;
  skippedCompletionTimestampMissing: number;
  days: Record<string, CodexStoredDayContribution>;
}

interface DeserializedClaudeFileEntry {
  file: string;
  mtimeMs: number;
  size: number;
  recordsRead: number;
  recordsMatched: number;
  days: Record<string, ClaudeDayContribution>;
}

interface DeserializedCodexFileEntry {
  file: string;
  mtimeMs: number;
  size: number;
  recordsRead: number;
  recordsMatched: number;
  skippedMissingTokenData: number;
  skippedMissingModel: number;
  skippedMissingBaseline: number;
  skippedNegativeDelta: number;
  skippedTaskStartedWithoutTurnId: number;
  skippedTokenCountOutsideTurn: number;
  skippedCloseWithoutTurn: number;
  skippedCompletionTimestampMissing: number;
  days: Record<string, CodexDayContribution>;
}

interface StoredStoreShape {
  version: number;
  scannerRevision?: string;
  claude: {
    dirPath: string;
    dateKey: string;
    files: ClaudeStoredFileEntry[];
  };
  codex: {
    dirPath: string;
    dateKey: string;
    files: CodexStoredFileEntry[];
  };
}

// A factory, not a shared constant: every discard path below spreads this into
// its own result, and callers mutate the returned cache's `.entries` Map in
// place (e.g. readClaudeHistoryIncremental populates it on the next scan). A
// single shared object would let a later fail-open load return a Map already
// populated by an earlier discard path in the same process.
function emptyLoad(): LoadHistoryCacheStoreResult {
  return {
    claude: makeClaudeHistoryCache(),
    codex: makeCodexHistoryCache(),
    loaded: false
  };
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeClaudeDay(day: ClaudeDayContribution): ClaudeStoredDayContribution {
  return {
    assistantMessages: day.assistantMessages,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheCreationInputTokens: day.cacheCreationInputTokens,
    cacheReadInputTokens: day.cacheReadInputTokens,
    modelBreakdown: Object.fromEntries(day.modelBreakdown)
  };
}

function serializeCodexDay(day: CodexDayContribution): CodexStoredDayContribution {
  return {
    correlatedTurns: day.correlatedTurns,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheCreationInputTokens: day.cacheCreationInputTokens,
    cacheReadInputTokens: day.cacheReadInputTokens,
    reasoningOutputTokens: day.reasoningOutputTokens,
    totalTokens: day.totalTokens,
    modelBreakdown: Object.fromEntries(day.modelBreakdown)
  };
}

function serializeClaudeFiles(entries: Map<string, {
  mtimeMs: number;
  size: number;
  contribution: ClaudeFileContribution;
}>): ClaudeStoredFileEntry[] {
  return Array.from(entries.entries()).map(([file, entry]) => ({
    file,
    mtimeMs: entry.mtimeMs,
    size: entry.size,
    recordsRead: entry.contribution.recordsRead,
    recordsMatched: entry.contribution.recordsMatched,
    days: Object.fromEntries(
      Array.from(entry.contribution.days.entries(), ([dateKey, day]) => [dateKey, serializeClaudeDay(day)])
    )
  }));
}

function serializeCodexFiles(entries: Map<string, {
  mtimeMs: number;
  size: number;
  contribution: CodexFileContribution;
}>): CodexStoredFileEntry[] {
  return Array.from(entries.entries()).map(([file, entry]) => ({
    file,
    mtimeMs: entry.mtimeMs,
    size: entry.size,
    recordsRead: entry.contribution.recordsRead,
    recordsMatched: entry.contribution.recordsMatched,
    skippedMissingTokenData: entry.contribution.skippedMissingTokenData,
    skippedMissingModel: entry.contribution.skippedMissingModel,
    skippedMissingBaseline: entry.contribution.skippedMissingBaseline,
    skippedNegativeDelta: entry.contribution.skippedNegativeDelta,
    skippedTaskStartedWithoutTurnId: entry.contribution.skippedTaskStartedWithoutTurnId,
    skippedTokenCountOutsideTurn: entry.contribution.skippedTokenCountOutsideTurn,
    skippedCloseWithoutTurn: entry.contribution.skippedCloseWithoutTurn,
    skippedCompletionTimestampMissing: entry.contribution.skippedCompletionTimestampMissing,
    days: Object.fromEntries(
      Array.from(entry.contribution.days.entries(), ([dateKey, day]) => [dateKey, serializeCodexDay(day)])
    )
  }));
}

function serializeStore(claude: ClaudeHistoryCache, codex: CodexHistoryCache, scannerRevision: string): string {
  const shape: StoredStoreShape = {
    version: HISTORY_CACHE_STORE_VERSION,
    scannerRevision,
    claude: {
      dirPath: claude.dirPath,
      dateKey: claude.dateKey,
      files: serializeClaudeFiles(claude.entries)
    },
    codex: {
      dirPath: codex.dirPath,
      dateKey: codex.dateKey,
      files: serializeCodexFiles(codex.entries)
    }
  };
  return JSON.stringify(shape, undefined, 2);
}

// ---------------------------------------------------------------------------
// Deserialization (fail-open: any structural problem discards the store)
// ---------------------------------------------------------------------------

// Every field gated by this check is a timestamp, size, count, or token total,
// all of which are nonnegative by construction; a negative value only appears
// through corruption or tampering, so it is treated as fail-open incompatible.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function claudeDayContribution(value: unknown): ClaudeDayContribution | undefined {
  if (!isRecord(value)) { return undefined; }
  if (!isFiniteNumber(value.assistantMessages) || !isFiniteNumber(value.inputTokens) ||
      !isFiniteNumber(value.outputTokens) || !isFiniteNumber(value.cacheCreationInputTokens) ||
      !isFiniteNumber(value.cacheReadInputTokens)) { return undefined; }
  const modelBreakdownRaw = value.modelBreakdown;
  if (!isRecord(modelBreakdownRaw)) { return undefined; }
  const modelBreakdown = new Map<string, ClaudeDayModelContribution>();
  for (const [model, mcRaw] of Object.entries(modelBreakdownRaw)) {
    if (!isRecord(mcRaw) || !isFiniteNumber(mcRaw.assistantMessages) || !isFiniteNumber(mcRaw.inputTokens) ||
        !isFiniteNumber(mcRaw.outputTokens) || !isFiniteNumber(mcRaw.cacheCreationInputTokens) ||
        !isFiniteNumber(mcRaw.cacheReadInputTokens)) { return undefined; }
    modelBreakdown.set(model, {
      assistantMessages: mcRaw.assistantMessages,
      inputTokens: mcRaw.inputTokens,
      outputTokens: mcRaw.outputTokens,
      cacheCreationInputTokens: mcRaw.cacheCreationInputTokens,
      cacheReadInputTokens: mcRaw.cacheReadInputTokens
    });
  }
  return {
    assistantMessages: value.assistantMessages,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheCreationInputTokens: value.cacheCreationInputTokens,
    cacheReadInputTokens: value.cacheReadInputTokens,
    modelBreakdown
  };
}

function codexDayContribution(value: unknown): CodexDayContribution | undefined {
  if (!isRecord(value)) { return undefined; }
  const numericFields = ['correlatedTurns', 'inputTokens', 'outputTokens', 'cacheCreationInputTokens',
    'cacheReadInputTokens', 'reasoningOutputTokens', 'totalTokens'];
  for (const field of numericFields) {
    if (!isFiniteNumber(value[field])) { return undefined; }
  }
  const modelBreakdownRaw = value.modelBreakdown;
  if (!isRecord(modelBreakdownRaw)) { return undefined; }
  const modelBreakdown = new Map<string, CodexDayModelContribution>();
  for (const [model, mcRaw] of Object.entries(modelBreakdownRaw)) {
    if (!isRecord(mcRaw)) { return undefined; }
    const modelEntry: Record<string, number> = {};
    for (const field of numericFields) {
      if (!isFiniteNumber(mcRaw[field])) { return undefined; }
      modelEntry[field] = mcRaw[field];
    }
    modelBreakdown.set(model, modelEntry as unknown as CodexDayModelContribution);
  }
  const dayValues: Record<string, number> = {};
  for (const field of numericFields) {
    if (!isFiniteNumber(value[field])) { return undefined; }
    dayValues[field] = value[field];
  }
  return {
    correlatedTurns: dayValues.correlatedTurns,
    inputTokens: dayValues.inputTokens,
    outputTokens: dayValues.outputTokens,
    cacheCreationInputTokens: dayValues.cacheCreationInputTokens,
    cacheReadInputTokens: dayValues.cacheReadInputTokens,
    reasoningOutputTokens: dayValues.reasoningOutputTokens,
    totalTokens: dayValues.totalTokens,
    modelBreakdown
  };
}

function claudeFileEntry(value: unknown): DeserializedClaudeFileEntry | undefined {
  if (!isRecord(value) || typeof value.file !== 'string' || !isFiniteNumber(value.mtimeMs) ||
      !isFiniteNumber(value.size) || !isFiniteNumber(value.recordsRead) || !isFiniteNumber(value.recordsMatched)) {
    return undefined;
  }
  const daysRaw = value.days;
  if (!isRecord(daysRaw)) { return undefined; }
  const days: Record<string, ClaudeDayContribution> = {};
  for (const [dateKey, dayValue] of Object.entries(daysRaw)) {
    const day = claudeDayContribution(dayValue);
    if (!day) { return undefined; }
    days[dateKey] = day;
  }
  return {
    file: value.file,
    mtimeMs: value.mtimeMs,
    size: value.size,
    recordsRead: value.recordsRead,
    recordsMatched: value.recordsMatched,
    days
  };
}

function codexFileEntry(value: unknown): DeserializedCodexFileEntry | undefined {
  if (!isRecord(value) || typeof value.file !== 'string' || !isFiniteNumber(value.mtimeMs) ||
      !isFiniteNumber(value.size) || !isFiniteNumber(value.recordsRead) || !isFiniteNumber(value.recordsMatched)) {
    return undefined;
  }
  const counterFields = ['skippedMissingTokenData', 'skippedMissingModel', 'skippedMissingBaseline',
    'skippedNegativeDelta', 'skippedTaskStartedWithoutTurnId', 'skippedTokenCountOutsideTurn',
    'skippedCloseWithoutTurn', 'skippedCompletionTimestampMissing'];
  const counterValues: Record<string, number> = {};
  for (const field of counterFields) {
    if (!isFiniteNumber(value[field])) { return undefined; }
    counterValues[field] = value[field];
  }
  const daysRaw = value.days;
  if (!isRecord(daysRaw)) { return undefined; }
  const days: Record<string, CodexDayContribution> = {};
  for (const [dateKey, dayValue] of Object.entries(daysRaw)) {
    const day = codexDayContribution(dayValue);
    if (!day) { return undefined; }
    days[dateKey] = day;
  }
  return {
    file: value.file,
    mtimeMs: value.mtimeMs,
    size: value.size,
    recordsRead: value.recordsRead,
    recordsMatched: value.recordsMatched,
    skippedMissingTokenData: counterValues.skippedMissingTokenData,
    skippedMissingModel: counterValues.skippedMissingModel,
    skippedMissingBaseline: counterValues.skippedMissingBaseline,
    skippedNegativeDelta: counterValues.skippedNegativeDelta,
    skippedTaskStartedWithoutTurnId: counterValues.skippedTaskStartedWithoutTurnId,
    skippedTokenCountOutsideTurn: counterValues.skippedTokenCountOutsideTurn,
    skippedCloseWithoutTurn: counterValues.skippedCloseWithoutTurn,
    skippedCompletionTimestampMissing: counterValues.skippedCompletionTimestampMissing,
    days
  };
}

function parseStore(raw: string, scannerRevision: string, onSanitizedLog: (message: string) => void): LoadHistoryCacheStoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onSanitizedLog('Discarding history cache store: JSON is corrupt.');
    return { ...emptyLoad(), discardedReason: 'corrupt-json' };
  }

  if (!isRecord(parsed)) {
    onSanitizedLog('Discarding history cache store: top-level shape is not an object.');
    return { ...emptyLoad(), discardedReason: 'incompatible-shape' };
  }
  if (parsed.version !== HISTORY_CACHE_STORE_VERSION) {
    onSanitizedLog(`Discarding history cache store: unsupported schema version ${String(parsed.version)}.`);
    return { ...emptyLoad(), discardedReason: 'incompatible-version' };
  }
  if (parsed.scannerRevision !== scannerRevision) {
    onSanitizedLog('Discarding history cache store: scanner revision mismatch.');
    return { ...emptyLoad(), discardedReason: 'scanner-revision-mismatch' };
  }

  const claudeRaw = parsed.claude;
  const codexRaw = parsed.codex;
  if (!isRecord(claudeRaw) || !isRecord(codexRaw) ||
      typeof claudeRaw.dirPath !== 'string' || typeof claudeRaw.dateKey !== 'string' ||
      typeof codexRaw.dirPath !== 'string' || typeof codexRaw.dateKey !== 'string' ||
      !Array.isArray(claudeRaw.files) || !Array.isArray(codexRaw.files)) {
    onSanitizedLog('Discarding history cache store: provider payload is incompatible.');
    return { ...emptyLoad(), discardedReason: 'incompatible-provider-payload' };
  }

  const claude = makeClaudeHistoryCache();
  claude.dirPath = claudeRaw.dirPath;
  claude.dateKey = claudeRaw.dateKey;
  for (const entryRaw of claudeRaw.files) {
    const entry = claudeFileEntry(entryRaw);
    if (!entry) {
      onSanitizedLog('Discarding history cache store: claude file entry is incompatible.');
      return { ...emptyLoad(), discardedReason: 'incompatible-claude-entry' };
    }
    const contribution: ClaudeFileContribution = {
      days: new Map(Object.entries(entry.days)),
      recordsRead: entry.recordsRead,
      recordsMatched: entry.recordsMatched
    };
    claude.entries.set(entry.file, { mtimeMs: entry.mtimeMs, size: entry.size, contribution });
  }

  const codex = makeCodexHistoryCache();
  codex.dirPath = codexRaw.dirPath;
  codex.dateKey = codexRaw.dateKey;
  for (const entryRaw of codexRaw.files) {
    const entry = codexFileEntry(entryRaw);
    if (!entry) {
      onSanitizedLog('Discarding history cache store: codex file entry is incompatible.');
      return { ...emptyLoad(), discardedReason: 'incompatible-codex-entry' };
    }
    const contribution: CodexFileContribution = {
      days: new Map(Object.entries(entry.days)),
      recordsRead: entry.recordsRead,
      recordsMatched: entry.recordsMatched,
      skippedMissingTokenData: entry.skippedMissingTokenData,
      skippedMissingModel: entry.skippedMissingModel,
      skippedMissingBaseline: entry.skippedMissingBaseline,
      skippedNegativeDelta: entry.skippedNegativeDelta,
      skippedTaskStartedWithoutTurnId: entry.skippedTaskStartedWithoutTurnId,
      skippedTokenCountOutsideTurn: entry.skippedTokenCountOutsideTurn,
      skippedCloseWithoutTurn: entry.skippedCloseWithoutTurn,
      skippedCompletionTimestampMissing: entry.skippedCompletionTimestampMissing
    };
    codex.entries.set(entry.file, { mtimeMs: entry.mtimeMs, size: entry.size, contribution });
  }

  return { claude, codex, loaded: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadHistoryCacheStore(
  cacheFilePath: string,
  options: HistoryCacheStoreOptions
): Promise<LoadHistoryCacheStoreResult> {
  const onSanitizedLog = options.onSanitizedLog ?? (() => undefined);
  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    return parseStore(raw, options.scannerRevision, onSanitizedLog);
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown';
    if (code !== 'ENOENT') {
      onSanitizedLog('Discarding history cache store: unreadable cache file.');
    }
    return { ...emptyLoad(), discardedReason: code === 'ENOENT' ? 'not-present' : 'unreadable' };
  }
}

export async function saveHistoryCacheStore(
  cacheFilePath: string,
  claude: ClaudeHistoryCache,
  codex: CodexHistoryCache,
  scannerRevision: string
): Promise<void> {
  const serialized = serializeStore(claude, codex, scannerRevision);
  await enqueueWrite(async () => {
    try {
      let current: string | undefined;
      try {
        current = await fs.readFile(cacheFilePath, 'utf8');
      } catch {
        current = undefined;
      }
      if (current === serialized) { return; }
      await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
      const tmpPath = `${cacheFilePath}.tmp.${process.pid}.${Date.now()}`;
      try {
        await fs.writeFile(tmpPath, serialized, 'utf8');
        await fs.rename(tmpPath, cacheFilePath);
      } catch (writeError) {
        await cleanupTempSnapshotFile(tmpPath);
        throw writeError;
      }
    } catch {
      // Save failures are non-fatal: the in-memory cache still serves the session.
    }
  });
}
