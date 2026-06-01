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
import type { LocalHistoryBucket } from '../core/quotaTypes';
import { fileEndsWithLineBreak, normalizeJsonlLine } from './jsonlLine';

const MAX_DEPTH = 4;
const MAX_LINES_PER_FILE = 5000;

interface ClaudeJsonlRecord {
  type?: unknown;
  timestamp?: unknown;
  message?: unknown;
}

interface ClaudeUsageFields {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ClaudeParseStats {
  filesInspected: number;
  recordsRead: number;
  recordsMatched: number;
  parseErrors: number;
  fileReadErrors: number;
}

export interface ClaudeUsageParseOptions {
  nowMs?: number;
}

export async function parseClaudeUsage(
  projectsRoot: string,
  options: ClaudeUsageParseOptions = {},
): Promise<{
  aggregate: AggregateUsage;
  localHistoryWindows: LocalHistoryWindowAggregateMap;
  modelAggregates: ModelUsageAggregate[];
  localHistoryModelWindows: ModelUsageWindowAggregateMap;
  historyBuckets: LocalHistoryBucket[];
  stats: ClaudeParseStats;
}> {
  const dayBuckets = new Map<string, { aggregate: AggregateUsage; models: Map<string, { totalTokens: number; totalAssistantMessages: number }> }>();
  const result = {
    aggregate: createEmptyAggregate(),
    localHistoryWindows: createEmptyLocalHistoryWindowAggregateMap(),
    modelAggregates: [] as ModelUsageAggregate[],
    localHistoryModelWindows: createEmptyModelUsageWindowAggregateMap(),
    dayBuckets,
    stats: createEmptyStats(),
    nowMs: options.nowMs ?? Date.now(),
  };

  const files = await findJsonlFiles(projectsRoot);

  for (const file of files) {
    try {
      await parseSingleFile(file, result);
    } catch {
      result.stats.fileReadErrors += 1;
    }
  }

  const historyBuckets = buildHistoryBuckets(dayBuckets);
  return { ...result, historyBuckets };
}

async function parseSingleFile(
  file: string,
  result: {
    aggregate: AggregateUsage;
    localHistoryWindows: LocalHistoryWindowAggregateMap;
    modelAggregates: ModelUsageAggregate[];
    localHistoryModelWindows: ModelUsageWindowAggregateMap;
    dayBuckets: Map<string, { aggregate: AggregateUsage; models: Map<string, { totalTokens: number; totalAssistantMessages: number }> }>;
    stats: ClaudeParseStats;
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

    let record: ClaudeJsonlRecord;
    try {
      record = JSON.parse(normalizedLine) as ClaudeJsonlRecord;
    } catch {
      pendingMalformedTail = true;
      continue;
    }

    const usage = extractClaudeUsage(record);
    if (!usage) {
      continue;
    }

    result.stats.recordsMatched += 1;
    const timestampEpochMs = parseTimestampEpochMs(record.timestamp);
    const modelLabel = extractClaudeModel(record);
    mergeTokenUsage(result.aggregate, usage);
    mergeModelTokenUsage(result.modelAggregates, 'claude', modelLabel, usage);
    mergeTokenUsageIntoLocalHistoryWindows(
      result.localHistoryWindows,
      usage,
      timestampEpochMs,
      result.nowMs,
    );
    mergeModelTokenUsageIntoLocalHistoryWindows(
      result.localHistoryModelWindows,
      'claude',
      modelLabel,
      usage,
      timestampEpochMs,
      result.nowMs,
    );
    if (timestampEpochMs !== undefined && timestampEpochMs <= result.nowMs) {
      mergeIntoDayBucket(result.dayBuckets, localDateKeyFromMs(timestampEpochMs), usage, modelLabel);
    }
  }

  if (pendingMalformedTail) {
    if (endsWithLineBreak) {
      result.stats.parseErrors += 1;
    } else {
      result.stats.recordsRead = Math.max(0, result.stats.recordsRead - 1);
    }
  }
}

function extractClaudeUsage(record: ClaudeJsonlRecord): ClaudeUsageFields | undefined {
  if (record.type !== 'assistant') {
    return undefined;
  }

  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }

  const usage = asRecord(message.usage);
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: readTokenCount(usage.input_tokens),
    outputTokens: readTokenCount(usage.output_tokens),
    cacheCreationInputTokens: readTokenCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: readTokenCount(usage.cache_read_input_tokens),
  };
}

function extractClaudeModel(record: ClaudeJsonlRecord): unknown {
  const message = asRecord(record.message);
  return message?.model;
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

function localDateKeyFromMs(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mergeIntoDayBucket(
  dayBuckets: Map<string, { aggregate: AggregateUsage; models: Map<string, { totalTokens: number; totalAssistantMessages: number }> }>,
  dateKey: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number },
  modelLabel: unknown,
): void {
  let bucket = dayBuckets.get(dateKey);
  if (!bucket) {
    bucket = { aggregate: createEmptyAggregate(), models: new Map() };
    dayBuckets.set(dateKey, bucket);
  }
  mergeTokenUsage(bucket.aggregate, usage);
  if (typeof modelLabel === 'string' && modelLabel) {
    const existing = bucket.models.get(modelLabel);
    const tokenTotal = usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
    if (existing) {
      existing.totalTokens += tokenTotal;
      existing.totalAssistantMessages += 1;
    } else {
      bucket.models.set(modelLabel, { totalTokens: tokenTotal, totalAssistantMessages: 1 });
    }
  }
}

function buildHistoryBuckets(
  dayBuckets: Map<string, { aggregate: AggregateUsage; models: Map<string, { totalTokens: number; totalAssistantMessages: number }> }>,
): LocalHistoryBucket[] {
  return Array.from(dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, bucket]) => {
      const modelAggregates: ModelUsageAggregate[] = Array.from(bucket.models.entries()).map(([label, counts]) => ({
        providerId: 'claude' as const,
        modelLabel: label,
        totalTokens: counts.totalTokens,
        totalAssistantMessages: counts.totalAssistantMessages,
        source: 'local',
      }));
      return {
        dateKey,
        aggregate: bucket.aggregate,
        ...(modelAggregates.length > 0 ? { modelAggregates } : {}),
      };
    });
}

function createEmptyStats(): ClaudeParseStats {
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
