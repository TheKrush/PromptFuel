import * as fs from 'node:fs/promises';
import * as fsp from 'node:fs';
import * as path from 'node:path';
import {
  AggregateUsage,
  LocalHistoryWindowAggregateMap,
  createEmptyAggregate,
  createEmptyLocalHistoryWindowAggregateMap,
  mergeTokenUsage,
} from '../core/usageAggregate';
import {
  ModelUsageAggregate,
  ModelUsageWindowAggregateMap,
  createEmptyModelUsageWindowAggregateMap,
  mergeModelTokenUsage,
  mergeModelTokenUsageIntoLocalHistoryWindows,
} from '../core/modelUsage';
import type { LocalHistoryBucket } from '../core/quotaTypes';

const MAX_DEPTH = 8;

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

interface CompletedTurn {
  completedAtMs: number;
  deltaInput: number;
  deltaOutput: number;
  deltaCached: number;
  deltaTotal: number;
  model: string;
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
  historyBuckets: LocalHistoryBucket[];
  stats: CodexParseStats;
}> {
  const nowMs = options.nowMs ?? Date.now();
  const stats: CodexParseStats = { filesInspected: 0, recordsRead: 0, recordsMatched: 0, parseErrors: 0, fileReadErrors: 0 };
  const completedTurns: CompletedTurn[] = [];

  const files = await findJsonlFiles(sessionsRoot);

  for (const candidate of files) {
    try {
      await scanSessionFile(candidate.file, completedTurns, stats);
    } catch {
      stats.fileReadErrors += 1;
    }
  }

  const result = buildResult(completedTurns, nowMs, stats);
  return { ...result, stats };
}

async function scanSessionFile(
  file: string,
  completedTurns: CompletedTurn[],
  stats: CodexParseStats,
): Promise<void> {
  stats.filesInspected += 1;

  const content = await fs.readFile(file, 'utf8');
  const lines = content.trim().split(/\r?\n/);

  const knownModels = new Map<string, string>();
  let latestModel = '';
  let latestTurnId = '';
  let currentTurn: TurnState | null = null;
  let lastSeenTotal: CodexTotalUsage | null = null;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    stats.recordsRead += 1;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      stats.parseErrors += 1;
      continue;
    }

    const type = asString(record.type);
    const payload = asRecord(record.payload);
    if (!payload) {
      continue;
    }

    const payloadType = asString(payload.type);

    if (type === 'turn_context') {
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
      if (currentTurn && !currentTurn.model && resolved) {
        currentTurn.model = resolved;
      }
    }

    if (type === 'event_msg' && payloadType === 'task_started') {
      let turnId = asString(payload.turn_id);
      if (!turnId) {
        turnId = latestTurnId;
        if (!turnId) {
          currentTurn = null;
          continue;
        }
      }
      const model = knownModels.get(turnId) || latestModel;
      currentTurn = {
        firstTotal: null,
        lastTotal: null,
        baselineTotal: lastSeenTotal ? { ...lastSeenTotal } : null,
        model: model || '',
        hasTokenData: false,
      };
      continue;
    }

    if (type === 'event_msg' && payloadType === 'token_count') {
      const infoRecord = asRecord(payload.info);
      if (!infoRecord) {
        continue;
      }
      const total = infoRecord.total_token_usage as CodexTotalUsage | undefined;
      if (!total || typeof total !== 'object') {
        continue;
      }

      lastSeenTotal = total;

      if (!currentTurn) {
        continue;
      }

      currentTurn.hasTokenData = true;
      if (!currentTurn.firstTotal) {
        currentTurn.firstTotal = total;
      }
      currentTurn.lastTotal = total;
      continue;
    }

    if (type === 'event_msg' && (payloadType === 'task_complete' || payloadType === 'turn_aborted')) {
      if (!currentTurn) {
        continue;
      }

      const completedAtMs = resolveCompletedAt(record);
      if (completedAtMs === 0) {
        currentTurn = null;
        continue;
      }

      if (!currentTurn.hasTokenData || !currentTurn.lastTotal) {
        currentTurn = null;
        continue;
      }

      if (!currentTurn.model) {
        currentTurn.model = latestModel;
      }

      if (!currentTurn.model) {
        currentTurn = null;
        continue;
      }

      const baseline = currentTurn.baselineTotal ?? currentTurn.firstTotal;
      if (!baseline) {
        currentTurn = null;
        continue;
      }

      const rawInput = rawDelta(currentTurn.lastTotal.input_tokens, baseline.input_tokens);
      const rawOutput = rawDelta(currentTurn.lastTotal.output_tokens, baseline.output_tokens);
      const rawTotal = rawDelta(currentTurn.lastTotal.total_tokens, baseline.total_tokens);

      if (rawTotal < 0 || rawInput < 0 || rawOutput < 0) {
        currentTurn = null;
        continue;
      }

      const deltaCached = clampOptional(currentTurn.lastTotal.cached_input_tokens, baseline.cached_input_tokens);

      completedTurns.push({
        completedAtMs,
        deltaInput: rawInput,
        deltaOutput: rawOutput,
        deltaCached,
        deltaTotal: rawTotal,
        model: currentTurn.model,
      });

      stats.recordsMatched += 1;
      currentTurn = null;
    }
  }
}

function buildResult(
  completedTurns: CompletedTurn[],
  nowMs: number,
  stats: CodexParseStats,
): {
  aggregate: AggregateUsage;
  localHistoryWindows: LocalHistoryWindowAggregateMap;
  modelAggregates: ModelUsageAggregate[];
  localHistoryModelWindows: ModelUsageWindowAggregateMap;
  historyBuckets: LocalHistoryBucket[];
} {
  const aggregate = createEmptyAggregate();
  const localHistoryWindows = createEmptyLocalHistoryWindowAggregateMap();
  const modelAggregates: ModelUsageAggregate[] = [];
  const localHistoryModelWindows: ModelUsageWindowAggregateMap = createEmptyModelUsageWindowAggregateMap();

  const dayBuckets = new Map<string, { aggregate: AggregateUsage; models: Map<string, { totalTokens: number; totalAssistantMessages: number }> }>();

  const todayStartMs = startOfLocalDayMs(nowMs);
  const last5hStartMs = nowMs - 5 * 60 * 60 * 1000;
  const last7dStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  for (const turn of completedTurns) {
    const usage = {
      inputTokens: turn.deltaInput,
      outputTokens: turn.deltaOutput,
      cacheCreationInputTokens: turn.deltaCached,
      cacheReadInputTokens: 0,
    };

    mergeTokenUsage(aggregate, usage);
    mergeModelTokenUsage(modelAggregates, 'codex', turn.model, usage);

    const ts = turn.completedAtMs;
    if (ts >= todayStartMs) {
      mergeTokenUsage(localHistoryWindows.today, usage);
    }
    if (ts >= last5hStartMs) {
      mergeTokenUsage(localHistoryWindows.last5h, usage);
    }
    if (ts >= last7dStartMs) {
      mergeTokenUsage(localHistoryWindows.last7d, usage);
    }
    mergeTokenUsage(localHistoryWindows.all, usage);

    mergeModelTokenUsageIntoLocalHistoryWindows(
      localHistoryModelWindows,
      'codex',
      turn.model,
      usage,
      ts,
      nowMs,
    );

    const dateKey = localDateKeyFromMs(ts);
    let bucket = dayBuckets.get(dateKey);
    if (!bucket) {
      bucket = { aggregate: createEmptyAggregate(), models: new Map() };
      dayBuckets.set(dateKey, bucket);
    }
    mergeTokenUsage(bucket.aggregate, usage);
    const modelEntry = bucket.models.get(turn.model);
    const tokenTotal = turn.deltaInput + turn.deltaOutput + turn.deltaCached;
    if (modelEntry) {
      modelEntry.totalTokens += tokenTotal;
      modelEntry.totalAssistantMessages += 1;
    } else {
      bucket.models.set(turn.model, { totalTokens: tokenTotal, totalAssistantMessages: 1 });
    }
  }

  const historyBuckets: LocalHistoryBucket[] = Array.from(dayBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, bucket]) => ({
      dateKey,
      aggregate: bucket.aggregate,
      modelAggregates: Array.from(bucket.models.entries()).map(([label, counts]) => ({
        providerId: 'codex' as const,
        modelLabel: label,
        totalTokens: counts.totalTokens,
        totalAssistantMessages: counts.totalAssistantMessages,
        source: 'local' as const,
      })),
    }));

  return { aggregate, localHistoryWindows, modelAggregates, localHistoryModelWindows, historyBuckets };
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
      return asString(settings.model);
    }
  }
  return undefined;
}

function resolveCompletedAt(record: Record<string, unknown>): number {
  const payload = asRecord(record.payload);
  if (payload) {
    const completedAt = payload.completed_at;
    if (typeof completedAt === 'number' && Number.isFinite(completedAt)) {
      if (completedAt > 1_000_000_000_000) return completedAt;
      if (completedAt > 1_000_000_000) return completedAt * 1000;
    }
  }

  const ts = record.timestamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    if (ts > 1_000_000_000_000) return ts;
    if (ts > 1_000_000_000) return ts * 1000;
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
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

function localDateKeyFromMs(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfLocalDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function findJsonlFiles(root: string): Promise<JsonlFileCandidate[]> {
  const found: JsonlFileCandidate[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      return;
    }
    let entries: fsp.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
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
        const stat = await fs.stat(full);
        found.push({ file: full, mtimeMs: stat.mtimeMs });
      } catch {
        // skip
      }
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
