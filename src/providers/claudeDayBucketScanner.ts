import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface ClaudeTodayUsageBucket {
  available: boolean;
  dateKey: string;
  dateLabel: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  models: string[];
  modelUsage?: ClaudeHistoryModelUsage[];
  filesFound: number;
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  fileReadErrors: number;
  error?: string;
}

interface JsonlFileCandidate {
  file: string;
  mtimeMs: number;
}

interface LocalDayWindow {
  startMs: number;
  endMs: number;
  dateKey: string;
  dateLabel: string;
}

interface ClaudeJsonlRecord {
  type?: unknown;
  timestamp?: unknown;
  message?: unknown;
}

interface ClaudeUsageSample {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ClaudeHistoryModelUsage {
  model: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

export interface ClaudeHistoryUsageBucket extends ClaudeTodayUsageBucket {
  modelUsage: ClaudeHistoryModelUsage[];
}

export interface ClaudeUsageHistory {
  available: boolean;
  rangeLabel: string;
  totalDays: number;
  activeDays: number;
  days: ClaudeHistoryUsageBucket[];
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  modelUsage: ClaudeHistoryModelUsage[];
  filesFound: number;
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  fileReadErrors: number;
  error?: string;
}

interface ClaudeHistoryUsageSample extends ClaudeUsageSample {
  timestampMs: number;
}

export function defaultClaudeProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export async function readClaudeTodayUsageBucket(
  projectsRoot: string = defaultClaudeProjectsPath(),
  targetDate: Date = new Date()
): Promise<ClaudeTodayUsageBucket> {
  const day = getLocalDayWindow(targetDate);
  const bucket = createEmptyBucket(day);
  const models = new Set<string>();

  try {
    const files = await findJsonlFiles(projectsRoot);
    bucket.filesFound = files.length;

    if (files.length === 0) {
      bucket.error = 'No Claude JSONL project files found.';
      return bucket;
    }

    for (const candidate of files) {
      if (!couldContainLocalDay(candidate, day)) {
        continue;
      }

      try {
        await parseClaudeJsonlFile(candidate.file, day, bucket, models);
      } catch {
        bucket.fileReadErrors += 1;
      }
    }

    bucket.models = Array.from(models).sort();
    bucket.available = bucket.recordsMatched > 0;
    if (!bucket.available) {
      bucket.error = bucket.filesInspected > 0
        ? 'No Claude assistant-message usage records found for the local day.'
        : 'Claude JSONL project files were found, but none appeared to be updated for the local day.';
    }

    return bucket;
  } catch {
    bucket.error = 'Claude projects path is unavailable or unreadable.';
    return bucket;
  }
}


export async function readClaudeRecentUsageHistory(
  projectsRoot: string = defaultClaudeProjectsPath(),
  days: number = 30,
  targetDate: Date = new Date()
): Promise<ClaudeUsageHistory> {
  const range = getRecentLocalDayRange(days, targetDate);
  const history = createEmptyHistory(range.rangeLabel, range.totalDays);
  const buckets = new Map<string, ClaudeHistoryUsageBucket>();

  try {
    const files = await findJsonlFiles(projectsRoot);
    history.filesFound = files.length;

    if (files.length === 0) {
      history.error = 'No Claude JSONL project files found.';
      return history;
    }

    for (const candidate of files) {
      if (candidate.mtimeMs < range.startMs - 60_000) {
        continue;
      }

      try {
        await parseClaudeJsonlFileForHistory(candidate.file, range.startMs, range.endMs, history, buckets);
      } catch {
        history.fileReadErrors += 1;
      }
    }

    history.days = Array.from(buckets.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    history.activeDays = history.days.filter(day => day.recordsMatched > 0).length;
    history.modelUsage.sort((a, b) => b.totalTokens - a.totalTokens);
    for (const bucket of history.days) {
      bucket.modelUsage.sort((a, b) => b.totalTokens - a.totalTokens);
      bucket.models = bucket.modelUsage.map(model => model.model);
      bucket.available = bucket.recordsMatched > 0;
    }

    history.available = history.recordsMatched > 0;
    if (!history.available) {
      history.error = history.filesInspected > 0
        ? 'No Claude assistant-message usage records found for the history range.'
        : 'Claude JSONL project files were found, but none appeared to be updated for the history range.';
    }

    return history;
  } catch {
    history.error = 'Claude projects path is unavailable or unreadable.';
    return history;
  }
}

async function parseClaudeJsonlFileForHistory(
  file: string,
  startMs: number,
  endMs: number,
  history: ClaudeUsageHistory,
  buckets: Map<string, ClaudeHistoryUsageBucket>
): Promise<void> {
  history.filesInspected += 1;

  const reader = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    history.recordsRead += 1;

    let record: ClaudeJsonlRecord;
    try {
      record = JSON.parse(line) as ClaudeJsonlRecord;
    } catch {
      continue;
    }

    const sample = readClaudeHistoryUsageSample(record, startMs, endMs);
    if (!sample) {
      continue;
    }

    const dateKey = formatLocalDateKey(new Date(sample.timestampMs));
    const bucket = getOrCreateHistoryBucket(buckets, dateKey);
    addHistorySample(history, sample);
    addHistoryBucketSample(bucket, sample);
  }
}

function readClaudeHistoryUsageSample(
  record: ClaudeJsonlRecord,
  startMs: number,
  endMs: number
): ClaudeHistoryUsageSample | undefined {
  if (record.type !== 'assistant') {
    return undefined;
  }

  const timestampMs = parseTimestampMs(record.timestamp);
  if (timestampMs === undefined || timestampMs < startMs || timestampMs >= endMs) {
    return undefined;
  }

  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }

  const model = asString(message.model);
  if (!model || !model.startsWith('claude-')) {
    return undefined;
  }

  const usage = asRecord(message.usage);
  if (!usage) {
    return undefined;
  }

  return {
    timestampMs,
    model,
    inputTokens: readTokenCount(usage.input_tokens),
    outputTokens: readTokenCount(usage.output_tokens),
    cacheCreationInputTokens: readTokenCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: readTokenCount(usage.cache_read_input_tokens)
  };
}

function getOrCreateHistoryBucket(
  buckets: Map<string, ClaudeHistoryUsageBucket>,
  dateKey: string
): ClaudeHistoryUsageBucket {
  const existing = buckets.get(dateKey);
  if (existing) {
    return existing;
  }

  const bucket: ClaudeHistoryUsageBucket = {
    available: false,
    dateKey,
    dateLabel: dateKey,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    models: [],
    modelUsage: [],
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0
  };
  buckets.set(dateKey, bucket);
  return bucket;
}

function addHistorySample(history: ClaudeUsageHistory, sample: ClaudeHistoryUsageSample): void {
  history.recordsMatched += 1;
  history.assistantMessages += 1;
  history.inputTokens += sample.inputTokens;
  history.outputTokens += sample.outputTokens;
  history.cacheCreationInputTokens += sample.cacheCreationInputTokens;
  history.cacheReadInputTokens += sample.cacheReadInputTokens;
  history.totalTokens += totalSampleTokens(sample);
  addModelUsage(history.modelUsage, sample);
}

function addHistoryBucketSample(bucket: ClaudeHistoryUsageBucket, sample: ClaudeHistoryUsageSample): void {
  bucket.recordsMatched += 1;
  bucket.assistantMessages += 1;
  bucket.inputTokens += sample.inputTokens;
  bucket.outputTokens += sample.outputTokens;
  bucket.cacheCreationInputTokens += sample.cacheCreationInputTokens;
  bucket.cacheReadInputTokens += sample.cacheReadInputTokens;
  bucket.totalTokens += totalSampleTokens(sample);
  addModelUsage(bucket.modelUsage, sample);
}

function addModelUsage(modelUsage: ClaudeHistoryModelUsage[], sample: ClaudeUsageSample): void {
  let model = modelUsage.find(entry => entry.model === sample.model);
  if (!model) {
    model = {
      model: sample.model,
      assistantMessages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0
    };
    modelUsage.push(model);
  }

  model.assistantMessages += 1;
  model.inputTokens += sample.inputTokens;
  model.outputTokens += sample.outputTokens;
  model.cacheCreationInputTokens += sample.cacheCreationInputTokens;
  model.cacheReadInputTokens += sample.cacheReadInputTokens;
  model.totalTokens += totalSampleTokens(sample);
}

function totalSampleTokens(sample: ClaudeUsageSample): number {
  return sample.inputTokens
    + sample.outputTokens
    + sample.cacheCreationInputTokens
    + sample.cacheReadInputTokens;
}

function createEmptyHistory(rangeLabel: string, totalDays: number): ClaudeUsageHistory {
  return {
    available: false,
    rangeLabel,
    totalDays,
    activeDays: 0,
    days: [],
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    modelUsage: [],
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0
  };
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
async function findJsonlFiles(root: string): Promise<JsonlFileCandidate[]> {
  const found: JsonlFileCandidate[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) {
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
        // Ignore files that disappear or become unreadable while scanning.
      }
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function couldContainLocalDay(candidate: JsonlFileCandidate, day: LocalDayWindow): boolean {
  return candidate.mtimeMs >= day.startMs - 60_000;
}

async function parseClaudeJsonlFile(
  file: string,
  day: LocalDayWindow,
  bucket: ClaudeTodayUsageBucket,
  models: Set<string>
): Promise<void> {
  bucket.filesInspected += 1;

  const reader = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    bucket.recordsRead += 1;

    let record: ClaudeJsonlRecord;
    try {
      record = JSON.parse(line) as ClaudeJsonlRecord;
    } catch {
      continue;
    }

    const sample = readClaudeUsageSample(record, day);
    if (!sample) {
      continue;
    }

    bucket.recordsMatched += 1;
    bucket.assistantMessages += 1;
    bucket.inputTokens += sample.inputTokens;
    bucket.outputTokens += sample.outputTokens;
    bucket.cacheCreationInputTokens += sample.cacheCreationInputTokens;
    bucket.cacheReadInputTokens += sample.cacheReadInputTokens;
    bucket.totalTokens += sample.inputTokens
      + sample.outputTokens
      + sample.cacheCreationInputTokens
      + sample.cacheReadInputTokens;
    addModelUsage(bucket.modelUsage ??= [], sample);
    models.add(sample.model);
  }
}

function readClaudeUsageSample(record: ClaudeJsonlRecord, day: LocalDayWindow): ClaudeUsageSample | undefined {
  if (record.type !== 'assistant') {
    return undefined;
  }

  const timestampMs = parseTimestampMs(record.timestamp);
  if (timestampMs === undefined || timestampMs < day.startMs || timestampMs >= day.endMs) {
    return undefined;
  }

  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }

  const model = asString(message.model);
  if (!model || !model.startsWith('claude-')) {
    return undefined;
  }

  const usage = asRecord(message.usage);
  if (!usage) {
    return undefined;
  }

  return {
    model,
    inputTokens: readTokenCount(usage.input_tokens),
    outputTokens: readTokenCount(usage.output_tokens),
    cacheCreationInputTokens: readTokenCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: readTokenCount(usage.cache_read_input_tokens)
  };
}

function createEmptyBucket(day: LocalDayWindow): ClaudeTodayUsageBucket {
  return {
    available: false,
    dateKey: day.dateKey,
    dateLabel: day.dateLabel,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    models: [],
    modelUsage: [],
    filesFound: 0,
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    fileReadErrors: 0
  };
}

function getLocalDayWindow(targetDate: Date): LocalDayWindow {
  const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const end = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
  const dateKey = formatLocalDateKey(start);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    dateKey,
    dateLabel: dateKey
  };
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return value;
    if (value > 1_000_000_000) return value * 1000;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function readTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
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
