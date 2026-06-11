import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface CodexCorrelatedDayBucket {
  available: boolean;
  dateKey: string;
  dateLabel: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  models: string[];
  modelUsage?: CodexCorrelatedHistoryModelUsage[];
  correlatedTurns: number;
  filesFound: number;
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  fileReadErrors: number;
  skippedMissingTokenData: number;
  skippedMissingModel: number;
  skippedMissingBaseline: number;
  skippedNegativeDelta: number;
  error?: string;
}

export interface CodexCorrelatedHistoryModelUsage {
  model: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexCorrelatedHistoryBucket extends CodexCorrelatedDayBucket {
  modelUsage: CodexCorrelatedHistoryModelUsage[];
}

export interface CodexCorrelatedHistory {
  available: boolean;
  rangeLabel: string;
  totalDays: number;
  activeDays: number;
  days: CodexCorrelatedHistoryBucket[];
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  modelUsage: CodexCorrelatedHistoryModelUsage[];
  filesFound: number;
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  fileReadErrors: number;
  skippedMissingTokenData: number;
  skippedMissingModel: number;
  skippedMissingBaseline: number;
  skippedNegativeDelta: number;
  skippedTaskStartedWithoutTurnId: number;
  skippedTokenCountOutsideTurn: number;
  skippedCloseWithoutTurn: number;
  skippedCompletionTimestampMissing: number;
  error?: string;
}

interface JsonlFileCandidate {
  file: string;
  mtimeMs: number;
}

interface TurnState {
  firstTotal: CodexTotalUsage | null;
  lastTotal: CodexTotalUsage | null;
  baselineTotal: CodexTotalUsage | null;
  model: string;
  hasTokenData: boolean;
}

interface CodexTotalUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface HistoryAccumulator {
  totalDays: number;
  rangeLabel: string;
  rangeStartDateKey: string;
  rangeEndDateKey: string;
  filesFound: number;
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  fileReadErrors: number;
  skippedMissingTokenData: number;
  skippedMissingModel: number;
  skippedMissingBaseline: number;
  skippedNegativeDelta: number;
  skippedTaskStartedWithoutTurnId: number;
  skippedTokenCountOutsideTurn: number;
  skippedCloseWithoutTurn: number;
  skippedCompletionTimestampMissing: number;
  buckets: Map<string, CodexCorrelatedHistoryBucket>;
  modelAgg: CodexCorrelatedHistoryModelUsage[];
}

export function defaultCodexSessionsPath(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export async function readCodexCorrelatedTodayBucket(
  sessionsRoot?: string,
  targetDate?: Date
): Promise<CodexCorrelatedDayBucket> {
  const history = await readCodexCorrelatedHistory(sessionsRoot, 1, targetDate);
  const day = history.days.length > 0 ? history.days[0] : undefined;
  if (day) {
    return {
      ...day,
      filesFound: history.filesFound,
      filesInspected: history.filesInspected,
      recordsRead: history.recordsRead,
      recordsMatched: history.recordsMatched,
      fileReadErrors: history.fileReadErrors,
      skippedMissingTokenData: history.skippedMissingTokenData,
      skippedMissingModel: history.skippedMissingModel,
      skippedMissingBaseline: history.skippedMissingBaseline,
      skippedNegativeDelta: history.skippedNegativeDelta,
      ...(history.error ? { error: history.error } : {})
    };
  }

  return {
    available: false,
    dateKey: '',
    dateLabel: '',
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    models: [],
    correlatedTurns: 0,
    filesFound: history.filesFound,
    filesInspected: history.filesInspected,
    recordsRead: history.recordsRead,
    recordsMatched: history.recordsMatched,
    fileReadErrors: history.fileReadErrors,
    skippedMissingTokenData: history.skippedMissingTokenData,
    skippedMissingModel: history.skippedMissingModel,
    skippedMissingBaseline: history.skippedMissingBaseline,
    skippedNegativeDelta: history.skippedNegativeDelta,
    ...(history.error ? { error: history.error } : {})
  };
}

export async function readCodexCorrelatedHistory(
  sessionsRoot: string = defaultCodexSessionsPath(),
  days: number = 30,
  targetDate: Date = new Date()
): Promise<CodexCorrelatedHistory> {
  const range = getRecentLocalDayRange(days, targetDate);
  const acc: HistoryAccumulator = {
    totalDays: range.totalDays,
    rangeLabel: range.rangeLabel,
    rangeStartDateKey: formatLocalDateKey(new Date(range.startMs)),
    rangeEndDateKey: formatLocalDateKey(new Date(range.endMs - 1)),
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0,
    skippedTokenCountOutsideTurn: 0,
    skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0,
    buckets: new Map(),
    modelAgg: []
  };

  try {
    const files = await findJsonlFiles(sessionsRoot);
    acc.filesFound = files.length;

    if (files.length === 0) {
      return buildHistoryResult(acc, 'No Codex JSONL session files found.');
    }

    for (const candidate of files) {
      if (candidate.mtimeMs < range.startMs - 60_000) {
        continue;
      }

      try {
        await scanCodexSessionFile(candidate.file, range.startMs, range.endMs, acc);
        acc.filesInspected++;
      } catch {
        acc.fileReadErrors++;
      }
    }

    const history = buildHistoryResult(acc);
    history.available = history.recordsMatched > 0;
    if (!history.available) {
      history.error = history.filesInspected > 0
        ? 'No Codex correlated usage records found for the history range.'
        : 'Codex JSONL session files were found, but none appeared to be updated for the history range.';
    }

    return history;
  } catch {
    return buildHistoryResult(acc, 'Codex sessions path is unavailable or unreadable.');
  }
}

async function scanCodexSessionFile(
  file: string,
  rangeStartMs: number,
  rangeEndMs: number,
  acc: HistoryAccumulator
): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  const knownModels = new Map<string, string>();
  let latestModel = '';
  let latestTurnId = '';
  let currentTurn: TurnState | null = null;
  let lastSeenTotal: CodexTotalUsage | null = null;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    acc.recordsRead++;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = asString(record.type);
    const payload = asRecord(record.payload);
    if (!payload) {
      continue;
    }

    const payloadType = asString(payload.type);

    // --- turn_context: stash model + latest turn_id ---
    if (type === 'turn_context' && payload) {
      const tid = asString(payload.turn_id);
      if (tid) {
        latestTurnId = tid;
      }
      const resolved = resolveModel(payload);
      if (resolved) {
        latestModel = resolved;
        if (tid) {
          knownModels.set(tid, resolved);
        }
      }

      // Backfill currentTurn model if it was previously empty and we now have a model
      if (currentTurn && !currentTurn.model && resolved) {
        currentTurn.model = resolved;
      }
    }

    // --- task_started: open a turn boundary ---
    if (type === 'event_msg' && payloadType === 'task_started') {
      let turnId = asString(payload.turn_id);
      if (!turnId) {
        turnId = latestTurnId;
        if (!turnId) {
          acc.skippedTaskStartedWithoutTurnId++;
          currentTurn = null;
          continue;
        }
      }

      if (currentTurn) {
        acc.skippedMissingBaseline++;
      }

      // Resolve model: try knownModels by turn_id, then latestModel from latest turn_context
      const model = knownModels.get(turnId) || latestModel;
      if (knownModels.has(turnId)) {
        // model resolved by turn_id lookup
      } else if (model) {
        // model resolved from latestModel fallback
      }

      currentTurn = {
        firstTotal: null,
        lastTotal: null,
        baselineTotal: lastSeenTotal ? { ...lastSeenTotal } : null,
        model: model || '',
        hasTokenData: false
      };
      continue;
    }

    // --- token_count: record usage snapshots ---
    if (type === 'event_msg' && payloadType === 'token_count') {
      const totalUsage = asRecord(payload.info) as Record<string, unknown> | undefined;
      if (!totalUsage) {
        continue;
      }
      const total = totalUsage.total_token_usage as CodexTotalUsage | undefined;
      if (!total) {
        continue;
      }

      lastSeenTotal = total;

      if (!currentTurn) {
        acc.skippedTokenCountOutsideTurn++;
        continue;
      }

      currentTurn.hasTokenData = true;
      if (!currentTurn.firstTotal) {
        currentTurn.firstTotal = total;
      }
      currentTurn.lastTotal = total;
      continue;
    }

    // --- task_complete / turn_aborted: close a turn ---
    if (type === 'event_msg' && (payloadType === 'task_complete' || payloadType === 'turn_aborted')) {
      if (!currentTurn) {
        acc.skippedCloseWithoutTurn++;
        continue;
      }

      // Resolve completion timestamp from payload or record timestamp
      const completedAtEpochMs = resolveCompletedAt(record);
      if (completedAtEpochMs === 0 || completedAtEpochMs < rangeStartMs || completedAtEpochMs >= rangeEndMs) {
        if (completedAtEpochMs === 0) {
          acc.skippedCompletionTimestampMissing++;
        }
        currentTurn = null;
        continue;
      }

      if (!currentTurn.hasTokenData) {
        acc.skippedMissingTokenData++;
        currentTurn = null;
        continue;
      }

      if (!currentTurn.model) {
        // Last resort: try latestModel from a turn_context seen later in the file
        currentTurn.model = latestModel;
      }

      if (!currentTurn.model) {
        acc.skippedMissingModel++;
        currentTurn = null;
        continue;
      }

      // Choose best baseline: baselineTotal (pre-turn) if available, else firstTotal (first within turn)
      const baseline = currentTurn.baselineTotal ?? currentTurn.firstTotal;
      if (!baseline || !currentTurn.lastTotal) {
        acc.skippedMissingBaseline++;
        currentTurn = null;
        continue;
      }

      // Compute raw deltas first (do not clamp) so negative/reset detection is honest
      const rawInput = rawDelta(currentTurn.lastTotal.input_tokens, baseline.input_tokens);
      const rawOutput = rawDelta(currentTurn.lastTotal.output_tokens, baseline.output_tokens);
      const rawTotal = rawDelta(currentTurn.lastTotal.total_tokens, baseline.total_tokens);

      if (rawTotal < 0 || rawInput < 0 || rawOutput < 0) {
        acc.skippedNegativeDelta++;
        currentTurn = null;
        continue;
      }

      // Only after negative check, clamp missing optional fields to 0
      const deltaInput = rawInput;
      const deltaOutput = rawOutput;
      const deltaCached = clampOptional(currentTurn.lastTotal.cached_input_tokens, baseline.cached_input_tokens);
      const deltaReasoning = clampOptional(currentTurn.lastTotal.reasoning_output_tokens, baseline.reasoning_output_tokens);
      const deltaTotal = rawTotal;

      const dateKey = formatLocalDateKey(new Date(completedAtEpochMs));
      const bucket = getOrCreateHistoryBucket(acc.buckets, dateKey);

      bucket.recordsMatched++;
      bucket.assistantMessages++;
      bucket.correlatedTurns++;
      bucket.inputTokens += deltaInput;
      bucket.outputTokens += deltaOutput;
      bucket.cacheCreationInputTokens += deltaCached;
      bucket.cacheReadInputTokens += 0;
      bucket.reasoningOutputTokens += deltaReasoning;
      bucket.totalTokens += deltaTotal;

      addCodexModelUsage(bucket.modelUsage, currentTurn.model, deltaInput, deltaOutput, deltaCached, deltaReasoning, deltaTotal);
      addCodexModelUsage(acc.modelAgg, currentTurn.model, deltaInput, deltaOutput, deltaCached, deltaReasoning, deltaTotal);

      acc.recordsMatched++;
      currentTurn = null;
    }
  }
}

function resolveModel(payload: Record<string, unknown>): string | undefined {
  const model = asString(payload.model);
  if (model) {
    return model;
  }
  const collab = asRecord(payload.collaboration_mode);
  if (collab) {
    const settings = asRecord(collab.settings);
    if (settings) {
      const m = asString(settings.model);
      if (m) {
        return m;
      }
    }
  }
  return undefined;
}

function resolveCompletedAt(record: Record<string, unknown>): number {
  const payload = asRecord(record.payload);
  if (payload) {
    const completedAt = payload.completed_at;
    if (typeof completedAt === 'number' && Number.isFinite(completedAt)) {
      if (completedAt > 1_000_000_000_000) {
        return completedAt;
      }
      if (completedAt > 1_000_000_000) {
        return completedAt * 1000;
      }
    }
  }

  // Fall back to top-level record.timestamp
  const ts = record.timestamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    if (ts > 1_000_000_000_000) {
      return ts;
    }
    if (ts > 1_000_000_000) {
      return ts * 1000;
    }
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function rawDelta(last: number | undefined, first: number | undefined): number {
  if (typeof last !== 'number' || typeof first !== 'number') {
    return 0;
  }
  return last - first;
}

function clampOptional(last: number | undefined, first: number | undefined): number {
  if (typeof last !== 'number' || typeof first !== 'number') {
    return 0;
  }
  return Math.max(0, last - first);
}

function addCodexModelUsage(
  list: CodexCorrelatedHistoryModelUsage[],
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  reasoningOutputTokens: number,
  totalTokens: number
): void {
  let entry = list.find(e => e.model === model);
  if (!entry) {
    entry = {
      model,
      assistantMessages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0
    };
    list.push(entry);
  }
  entry.assistantMessages++;
  entry.inputTokens += inputTokens;
  entry.outputTokens += outputTokens;
  entry.cacheCreationInputTokens += cachedInputTokens;
  entry.reasoningOutputTokens += reasoningOutputTokens;
  entry.totalTokens += totalTokens;
}

function getOrCreateHistoryBucket(
  buckets: Map<string, CodexCorrelatedHistoryBucket>,
  dateKey: string
): CodexCorrelatedHistoryBucket {
  const existing = buckets.get(dateKey);
  if (existing) {
    return existing;
  }

  const bucket: CodexCorrelatedHistoryBucket = {
    available: false,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    models: [],
    correlatedTurns: 0,
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    modelUsage: []
  };
  buckets.set(dateKey, bucket);
  return bucket;
}

function buildHistoryResult(
  acc: HistoryAccumulator,
  error?: string
): CodexCorrelatedHistory {
  const rawDays = new Map(acc.buckets);
  const days: CodexCorrelatedHistoryBucket[] = [];
  let activeDays = 0;

  // Fill every calendar day in the range, zero for missing days
  const cursor = parseDateKey(acc.rangeStartDateKey);
  const endDate = parseDateKey(acc.rangeEndDateKey);
  while (cursor <= endDate) {
    const key = formatLocalDateKey(cursor);
    const existing = rawDays.get(key);
    if (existing) {
      existing.modelUsage.sort((a, b) => b.totalTokens - a.totalTokens);
      existing.models = existing.modelUsage.map(m => m.model);
      existing.available = existing.recordsMatched > 0;
      if (existing.recordsMatched > 0) {
        activeDays++;
      }
      days.push(existing);
    } else {
      days.push(createZeroBucket(key));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const modelUsage = acc.modelAgg.slice().sort((a, b) => b.totalTokens - a.totalTokens);

  let assistantMessages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let reasoningOutputTokens = 0;
  let totalTokens = 0;

  for (const day of days) {
    assistantMessages += day.assistantMessages;
    inputTokens += day.inputTokens;
    outputTokens += day.outputTokens;
    cacheCreationInputTokens += day.cacheCreationInputTokens;
    cacheReadInputTokens += day.cacheReadInputTokens;
    reasoningOutputTokens += day.reasoningOutputTokens;
    totalTokens += day.totalTokens;
  }

  return {
    available: false,
    rangeLabel: acc.rangeLabel,
    totalDays: acc.totalDays,
    activeDays,
    days,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningOutputTokens,
    totalTokens,
    modelUsage,
    filesFound: acc.filesFound,
    filesInspected: acc.filesInspected,
    recordsRead: acc.recordsRead,
    recordsMatched: acc.recordsMatched,
    fileReadErrors: acc.fileReadErrors,
    skippedMissingTokenData: acc.skippedMissingTokenData,
    skippedMissingModel: acc.skippedMissingModel,
    skippedMissingBaseline: acc.skippedMissingBaseline,
    skippedNegativeDelta: acc.skippedNegativeDelta,
    skippedTaskStartedWithoutTurnId: acc.skippedTaskStartedWithoutTurnId,
    skippedTokenCountOutsideTurn: acc.skippedTokenCountOutsideTurn,
    skippedCloseWithoutTurn: acc.skippedCloseWithoutTurn,
    skippedCompletionTimestampMissing: acc.skippedCompletionTimestampMissing,
    ...(error ? { error } : {})
  };
}

async function findJsonlFiles(root: string): Promise<JsonlFileCandidate[]> {
  const found: JsonlFileCandidate[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      try {
        const stat = await fsp.stat(full);
        found.push({ file: full, mtimeMs: stat.mtimeMs });
      } catch {
        // Skip files that disappear or become unreadable.
      }
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function getRecentLocalDayRange(days: number, targetDate: Date): {
  startMs: number;
  endMs: number;
  rangeLabel: string;
  totalDays: number;
} {
  const totalDays = Math.max(1, Math.floor(days));
  const targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const start = new Date(targetStart.getFullYear(), targetStart.getMonth(), targetStart.getDate() - (totalDays - 1));
  const end = new Date(targetStart.getFullYear(), targetStart.getMonth(), targetStart.getDate() + 1);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    rangeLabel: `${formatLocalDateKey(start)} to ${formatLocalDateKey(new Date(end.getTime() - 1))}`,
    totalDays
  };
}

function createZeroBucket(dateKey: string): CodexCorrelatedHistoryBucket {
  return {
    available: false,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    models: [],
    correlatedTurns: 0,
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    modelUsage: []
  };
}

function parseDateKey(key: string): Date {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Incremental per-file scan API (used by historyCache.ts)
// ---------------------------------------------------------------------------

export interface CodexJsonlFileInfo {
  file: string;
  mtimeMs: number;
  size: number;
}

export interface CodexDayModelContribution {
  correlatedTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexDayContribution {
  correlatedTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  modelBreakdown: Map<string, CodexDayModelContribution>;
}

export interface CodexFileContribution {
  days: Map<string, CodexDayContribution>;
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
}

export async function listCodexJsonlFiles(root: string): Promise<CodexJsonlFileInfo[]> {
  const found: CodexJsonlFileInfo[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) { return; }
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) { continue; }
      try {
        const stat = await fsp.stat(full);
        found.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // ignore
      }
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function scanCodexFileContribution(
  file: string,
  startMs: number,
  endMs: number
): Promise<CodexFileContribution> {
  const contribution: CodexFileContribution = {
    days: new Map(),
    recordsRead: 0,
    recordsMatched: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    skippedTaskStartedWithoutTurnId: 0,
    skippedTokenCountOutsideTurn: 0,
    skippedCloseWithoutTurn: 0,
    skippedCompletionTimestampMissing: 0
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  const knownModels = new Map<string, string>();
  let latestModel = '';
  let latestTurnId = '';
  let currentTurn: TurnState | null = null;
  let lastSeenTotal: CodexTotalUsage | null = null;

  for await (const line of rl) {
    if (!line.trim()) { continue; }

    contribution.recordsRead++;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = asString(record.type);
    const payload = asRecord(record.payload);
    if (!payload) { continue; }

    const payloadType = asString(payload.type);

    if (type === 'turn_context') {
      const tid = asString(payload.turn_id);
      if (tid) { latestTurnId = tid; }
      const resolved = resolveModel(payload);
      if (resolved) {
        latestModel = resolved;
        if (tid) { knownModels.set(tid, resolved); }
      }
      if (currentTurn && !currentTurn.model && resolved) { currentTurn.model = resolved; }
    }

    if (type === 'event_msg' && payloadType === 'task_started') {
      let turnId = asString(payload.turn_id);
      if (!turnId) {
        turnId = latestTurnId;
        if (!turnId) {
          contribution.skippedTaskStartedWithoutTurnId++;
          currentTurn = null;
          continue;
        }
      }
      if (currentTurn) { contribution.skippedMissingBaseline++; }
      const model = knownModels.get(turnId) || latestModel;
      currentTurn = {
        firstTotal: null,
        lastTotal: null,
        baselineTotal: lastSeenTotal ? { ...lastSeenTotal } : null,
        model: model || '',
        hasTokenData: false
      };
      continue;
    }

    if (type === 'event_msg' && payloadType === 'token_count') {
      const totalUsage = asRecord(payload.info) as Record<string, unknown> | undefined;
      if (!totalUsage) { continue; }
      const total = totalUsage.total_token_usage as CodexTotalUsage | undefined;
      if (!total) { continue; }
      lastSeenTotal = total;
      if (!currentTurn) { contribution.skippedTokenCountOutsideTurn++; continue; }
      currentTurn.hasTokenData = true;
      if (!currentTurn.firstTotal) { currentTurn.firstTotal = total; }
      currentTurn.lastTotal = total;
      continue;
    }

    if (type === 'event_msg' && (payloadType === 'task_complete' || payloadType === 'turn_aborted')) {
      if (!currentTurn) { contribution.skippedCloseWithoutTurn++; continue; }

      const completedAtMs = resolveCompletedAt(record);
      if (completedAtMs === 0 || completedAtMs < startMs || completedAtMs >= endMs) {
        if (completedAtMs === 0) { contribution.skippedCompletionTimestampMissing++; }
        currentTurn = null;
        continue;
      }

      if (!currentTurn.hasTokenData) { contribution.skippedMissingTokenData++; currentTurn = null; continue; }

      if (!currentTurn.model) { currentTurn.model = latestModel; }
      if (!currentTurn.model) { contribution.skippedMissingModel++; currentTurn = null; continue; }

      const baseline = currentTurn.baselineTotal ?? currentTurn.firstTotal;
      if (!baseline || !currentTurn.lastTotal) { contribution.skippedMissingBaseline++; currentTurn = null; continue; }

      const rawInput = rawDelta(currentTurn.lastTotal.input_tokens, baseline.input_tokens);
      const rawOutput = rawDelta(currentTurn.lastTotal.output_tokens, baseline.output_tokens);
      const rawTotal = rawDelta(currentTurn.lastTotal.total_tokens, baseline.total_tokens);

      if (rawTotal < 0 || rawInput < 0 || rawOutput < 0) {
        contribution.skippedNegativeDelta++;
        currentTurn = null;
        continue;
      }

      const deltaCached = clampOptional(currentTurn.lastTotal.cached_input_tokens, baseline.cached_input_tokens);
      const deltaReasoning = clampOptional(currentTurn.lastTotal.reasoning_output_tokens, baseline.reasoning_output_tokens);

      const dateKey = formatLocalDateKey(new Date(completedAtMs));
      let day = contribution.days.get(dateKey);
      if (!day) {
        day = {
          correlatedTurns: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          modelBreakdown: new Map()
        };
        contribution.days.set(dateKey, day);
      }

      day.correlatedTurns++;
      day.inputTokens += rawInput;
      day.outputTokens += rawOutput;
      day.cacheCreationInputTokens += deltaCached;
      day.reasoningOutputTokens += deltaReasoning;
      day.totalTokens += rawTotal;

      let modelDay = day.modelBreakdown.get(currentTurn.model);
      if (!modelDay) {
        modelDay = { correlatedTurns: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
        day.modelBreakdown.set(currentTurn.model, modelDay);
      }
      modelDay.correlatedTurns++;
      modelDay.inputTokens += rawInput;
      modelDay.outputTokens += rawOutput;
      modelDay.cacheCreationInputTokens += deltaCached;
      modelDay.reasoningOutputTokens += deltaReasoning;
      modelDay.totalTokens += rawTotal;

      contribution.recordsMatched++;
      currentTurn = null;
    }
  }

  return contribution;
}
