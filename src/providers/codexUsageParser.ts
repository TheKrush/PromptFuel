import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as readline from 'node:readline';
import {
  AggregateUsage,
  LocalHistoryWindowAggregateMap,
  createEmptyAggregate,
  createEmptyLocalHistoryWindowAggregateMap,
  mergeTokenUsage,
  mergeTokenUsageIntoLocalHistoryWindows,
  parseTimestampEpochMs,
} from '../core/usageAggregate';
import {
  ModelUsageAggregate,
  ModelUsageWindowAggregateMap,
  createEmptyModelUsageWindowAggregateMap,
  mergeModelTokenUsage,
  mergeModelTokenUsageIntoLocalHistoryWindows,
} from '../core/modelUsage';
import { fileEndsWithLineBreak, normalizeJsonlLine } from './jsonlLine';

const MAX_DEPTH = 3;
const MAX_LINES_PER_FILE = 5000;

interface CodexRecord {
  type?: unknown;
  timestamp?: unknown;
  payload?: Record<string, unknown>;
}

interface CodexTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface CodexParseStats {
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  parseErrors: number;
  fileReadErrors: number;
}

export interface CodexUsageParseOptions {
  nowMs?: number;
}

export async function parseCodexUsage(
  sessionsRoot: string,
  options: CodexUsageParseOptions = {},
): Promise<{
  aggregate: AggregateUsage;
  localHistoryWindows: LocalHistoryWindowAggregateMap;
  modelAggregates: ModelUsageAggregate[];
  localHistoryModelWindows: ModelUsageWindowAggregateMap;
  stats: CodexParseStats;
}> {
  const result = {
    aggregate: createEmptyAggregate(),
    localHistoryWindows: createEmptyLocalHistoryWindowAggregateMap(),
    modelAggregates: [] as ModelUsageAggregate[],
    localHistoryModelWindows: createEmptyModelUsageWindowAggregateMap(),
    stats: createEmptyStats(),
    nowMs: options.nowMs ?? Date.now(),
  };

  const files = await findJsonlFiles(sessionsRoot);

  for (const file of files) {
    try {
      await parseSingleFile(file, result);
    } catch {
      result.stats.fileReadErrors += 1;
    }
  }

  return result;
}

async function parseSingleFile(
  file: string,
  result: {
    aggregate: AggregateUsage;
    localHistoryWindows: LocalHistoryWindowAggregateMap;
    modelAggregates: ModelUsageAggregate[];
    localHistoryModelWindows: ModelUsageWindowAggregateMap;
    stats: CodexParseStats;
    nowMs: number;
  },
): Promise<void> {
  result.stats.filesInspected += 1;
  const endsWithLineBreak = await fileEndsWithLineBreak(file);

  const reader = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;
  let pendingMalformedTail = false;

  for await (const line of reader) {
    lineCount++;

    if (lineCount > MAX_LINES_PER_FILE) {
      if (pendingMalformedTail) {
        result.stats.parseErrors += 1;
        pendingMalformedTail = false;
      }
      break;
    }

    if (pendingMalformedTail) {
      result.stats.parseErrors += 1;
      pendingMalformedTail = false;
    }

    const normalizedLine = normalizeJsonlLine(line);
    if (!normalizedLine) {
      continue;
    }

    result.stats.recordsRead += 1;

    let record: CodexRecord;
    try {
      record = JSON.parse(normalizedLine) as CodexRecord;
    } catch {
      pendingMalformedTail = true;
      continue;
    }

    const usage = extractCodexUsage(record);
    if (!usage) {
      continue;
    }

    result.stats.recordsMatched += 1;
    const timestampEpochMs = parseTimestampEpochMs(record.timestamp);
    const modelLabel = extractCodexModel(record);
    mergeTokenUsage(result.aggregate, usage);
    mergeModelTokenUsage(result.modelAggregates, 'codex', modelLabel, usage);
    mergeTokenUsageIntoLocalHistoryWindows(
      result.localHistoryWindows,
      usage,
      timestampEpochMs,
      result.nowMs,
    );
    mergeModelTokenUsageIntoLocalHistoryWindows(
      result.localHistoryModelWindows,
      'codex',
      modelLabel,
      usage,
      timestampEpochMs,
      result.nowMs,
    );
  }

  if (pendingMalformedTail) {
    if (endsWithLineBreak) {
      result.stats.parseErrors += 1;
    } else {
      result.stats.recordsRead = Math.max(0, result.stats.recordsRead - 1);
    }
  }
}

function extractCodexUsage(record: CodexRecord): CodexTokenUsage | undefined {
  const payload = asRecord(record.payload);
  if (!payload) {
    return undefined;
  }

  const info = asRecord(payload.info);
  if (!info) {
    return undefined;
  }

  const lastUsage = asRecord(info.last_token_usage);
  const totalUsage = asRecord(info.total_token_usage);

  if (!lastUsage && !totalUsage) {
    return undefined;
  }

  const source = lastUsage ?? totalUsage;
  if (!source) {
    return undefined;
  }

  return {
    inputTokens: readTokenCount(source.input_tokens),
    outputTokens: readTokenCount(source.output_tokens),
    cacheCreationInputTokens: readTokenCount(source.cached_input_tokens),
    cacheReadInputTokens: 0,
  };
}

function extractCodexModel(record: CodexRecord): unknown {
  const payload = asRecord(record.payload);
  if (!payload) {
    return undefined;
  }

  const payloadModel = asString(payload.model);
  if (payloadModel) {
    return payloadModel;
  }

  const info = asRecord(payload.info);
  const infoModel = asString(info?.model);
  if (infoModel) {
    return infoModel;
  }

  const settings = asRecord(payload.settings);
  return asString(settings?.model);
}

async function findJsonlFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      return;
    }

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = joinPath(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push(full);
      }
    }
  }

  await walk(root, 0);
  return found;
}

function createEmptyStats(): CodexParseStats {
  return {
    filesInspected: 0,
    recordsRead: 0,
    recordsMatched: 0,
    parseErrors: 0,
    fileReadErrors: 0,
  };
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
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function joinPath(a: string, b: string): string {
  if (a.endsWith('/') || a.endsWith('\\')) {
    return a + b;
  }
  return a + '/' + b;
}
