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
): Promise<{ aggregate: AggregateUsage; localHistoryWindows: LocalHistoryWindowAggregateMap; stats: CodexParseStats }> {
  const result = {
    aggregate: createEmptyAggregate(),
    localHistoryWindows: createEmptyLocalHistoryWindowAggregateMap(),
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
    stats: CodexParseStats;
    nowMs: number;
  },
): Promise<void> {
  result.stats.filesInspected += 1;

  const reader = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;

  for await (const line of reader) {
    lineCount++;

    if (lineCount > MAX_LINES_PER_FILE) {
      break;
    }

    if (!line.trim()) {
      continue;
    }

    result.stats.recordsRead += 1;

    let record: CodexRecord;
    try {
      record = JSON.parse(line) as CodexRecord;
    } catch {
      result.stats.parseErrors += 1;
      continue;
    }

    const usage = extractCodexUsage(record);
    if (!usage) {
      continue;
    }

    result.stats.recordsMatched += 1;
    mergeTokenUsage(result.aggregate, usage);
    mergeTokenUsageIntoLocalHistoryWindows(
      result.localHistoryWindows,
      usage,
      parseTimestampEpochMs(record.timestamp),
      result.nowMs,
    );
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

function joinPath(a: string, b: string): string {
  if (a.endsWith('/') || a.endsWith('\\')) {
    return a + b;
  }
  return a + '/' + b;
}
