import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProviderDiagnostics, ProviderUsageState, LimitWindow, UsageTracing } from '../types';
import { isStale } from '../usageTime';

interface FileSearchResult {
  files: string[];
  filesFound: number;
}

interface ParsedCodexState {
  state: ProviderUsageState;
  diagnostics: ProviderDiagnostics;
}

interface CodexRecord {
  type?: unknown;
  timestamp?: unknown;
  payload?: Record<string, unknown>;
}

interface CodexSessionMeta {
  id?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
}

interface CodexRateLimit {
  primary?: unknown;
  secondary?: unknown;
}

interface CodexRateLimitWindow {
  used_percent?: unknown;
  usedPercentage?: unknown;
  resets_at?: unknown;
  resetsAtEpochSeconds?: unknown;
  window_minutes?: unknown;
}

interface CodexTokenUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cached_input_tokens?: unknown;
  reasoning_output_tokens?: unknown;
  total_tokens?: unknown;
}

interface MutableCodexState {
  provider: 'codex';
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  model?: string;
  sessionId?: string;
  workspace?: string;
  source?: string;
  lastUpdatedEpochMs?: number;
  lastUsageTimestamp?: string;
  lastEntrypoint?: string;
  tracing?: UsageTracing;
}

export async function readCodexUsageState(sessionsRoot: string): Promise<ProviderUsageState> {
  const diagnostics: ProviderDiagnostics = {
    sessionsPath: sessionsRoot,
    sessionFilesFound: 0,
    sessionFilesInspected: 0,
    recordsRead: 0,
    usageFieldsFound: false,
    quotaFieldsFound: false
  };

  try {
    const search = await findRecentJsonlFiles(sessionsRoot, 32);
    diagnostics.sessionFilesFound = search.filesFound;
    diagnostics.sessionFilesInspected = search.files.length;

    if (search.files.length === 0) {
      return {
        provider: 'codex',
        source: sessionsRoot,
        stale: true,
        error: 'No Codex JSONL session files found yet.',
        diagnosticSeverity: 'info',
        diagnostics
      };
    }

    let best: ParsedCodexState | undefined;
    for (const file of search.files) {
      const parsed = await parseCodexFile(file, diagnostics);
      if (parsed && isBetterCandidate(parsed.state, best?.state)) {
        best = parsed;
      }
    }

    if (!best) {
      return {
        provider: 'codex',
        source: search.files[0],
        stale: true,
        error: diagnostics.usageFieldsFound
          ? 'Codex sessions found local token usage, but no recognizable 5h/7d quota windows were detected.'
          : 'Codex sessions found, but no recognizable local usage or quota fields were detected.',
        diagnosticSeverity: 'info',
        diagnostics
      };
    }

    const state = best.state;
    state.stale = isStale(state.lastUpdatedEpochMs);
    state.diagnostics = diagnostics;
    return state;
  } catch (error) {
    return {
      provider: 'codex',
      source: sessionsRoot,
      stale: true,
      error: error instanceof Error ? error.message : String(error),
      diagnosticSeverity: 'warning',
      diagnostics
    };
  }
}

async function findRecentJsonlFiles(root: string, maxFiles: number): Promise<FileSearchResult> {
  const found: { file: string; mtimeMs: number }[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = await fs.stat(full);
        found.push({ file: full, mtimeMs: stat.mtimeMs });
      }
    }
  }

  await walk(root, 0);
  const files = found
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map(f => f.file);

  return { files, filesFound: found.length };
}

async function parseCodexFile(file: string, diagnostics: ProviderDiagnostics): Promise<ParsedCodexState | undefined> {
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.trim().split(/\r?\n/).slice(-800);
  const state: MutableCodexState = { provider: 'codex', source: file };
  let latestRelevantMs = 0;
  let usageOrQuotaFound = false;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    diagnostics.recordsRead = (diagnostics.recordsRead ?? 0) + 1;

    let record: CodexRecord;
    try {
      record = JSON.parse(line) as CodexRecord;
    } catch {
      continue;
    }

    const timestampMs = parseTimestampMs(record.timestamp);
    if (timestampMs !== undefined) {
      const iso = new Date(timestampMs).toISOString();
      if (!diagnostics.newestSessionTimestamp || timestampMs > Date.parse(diagnostics.newestSessionTimestamp)) {
        diagnostics.newestSessionTimestamp = iso;
      }
    }

    const payload = asRecord(record.payload);
    if (!payload) {
      continue;
    }

    const sessionMeta = record.type === 'session_meta' ? asRecord(payload) as CodexSessionMeta : undefined;
    if (sessionMeta) {
      const sessionId = asString(sessionMeta.id);
      const workspace = asString(sessionMeta.cwd);
      if (sessionId) state.sessionId = sessionId;
      if (workspace) state.workspace = workspace;
      const sessionTimestampMs = parseTimestampMs(sessionMeta.timestamp) ?? timestampMs;
      if (sessionTimestampMs !== undefined) {
        updateLatest(state, sessionTimestampMs);
      }
    }

    const model = asString(payload.model);
    if (model) {
      state.model = model;
    }
    const workspace = asString(payload.cwd);
    if (workspace) {
      state.workspace = workspace;
    }
    const entrypoint = asString(payload.type);
    if (entrypoint) {
      state.lastEntrypoint = entrypoint;
    }

    const tokenInfo = asRecord(payload.info);
    if (tokenInfo) {
      const lastUsage = asRecord(tokenInfo.last_token_usage) as CodexTokenUsage | undefined;
      const totalUsage = asRecord(tokenInfo.total_token_usage) as CodexTokenUsage | undefined;
      if (lastUsage || totalUsage) {
        diagnostics.usageFieldsFound = true;
        usageOrQuotaFound = true;
        mergeTokenUsage(state, lastUsage, totalUsage);
        if (timestampMs !== undefined) {
          latestRelevantMs = Math.max(latestRelevantMs, timestampMs);
          updateLatest(state, timestampMs);
          state.lastUsageTimestamp = new Date(timestampMs).toISOString();
        }
      }
    }

    const rateLimits = asRecord(payload.rate_limits) as CodexRateLimit | undefined;
    if (rateLimits) {
      const beforeFive = state.fiveHour;
      const beforeSeven = state.sevenDay;
      mergeRateLimits(state, rateLimits);
      if (state.fiveHour !== beforeFive || state.sevenDay !== beforeSeven) {
        diagnostics.quotaFieldsFound = true;
        usageOrQuotaFound = true;
        if (timestampMs !== undefined) {
          latestRelevantMs = Math.max(latestRelevantMs, timestampMs);
          updateLatest(state, timestampMs);
        }
      }
    }
  }

  if (!usageOrQuotaFound) {
    return undefined;
  }

  if (latestRelevantMs > 0) {
    state.lastUpdatedEpochMs = latestRelevantMs;
  }
  state.source = 'local Codex session snapshot';

  return {
    state: state as ProviderUsageState,
    diagnostics
  };
}

function mergeTokenUsage(state: MutableCodexState, lastUsage: CodexTokenUsage | undefined, totalUsage: CodexTokenUsage | undefined): void {
  const tracing = state.tracing ?? {};
  if (lastUsage) {
    tracing.currentInputTokens = toNumber(lastUsage.input_tokens) ?? tracing.currentInputTokens;
    tracing.currentOutputTokens = toNumber(lastUsage.output_tokens) ?? tracing.currentOutputTokens;
    tracing.currentCachedInputTokens = toNumber(lastUsage.cached_input_tokens) ?? tracing.currentCachedInputTokens;
    tracing.currentReasoningOutputTokens = toNumber(lastUsage.reasoning_output_tokens) ?? tracing.currentReasoningOutputTokens;
    tracing.currentTotalTokens = toNumber(lastUsage.total_tokens) ?? tracing.currentTotalTokens;
  }
  if (totalUsage) {
    tracing.totalInputTokens = toNumber(totalUsage.input_tokens) ?? tracing.totalInputTokens;
    tracing.totalOutputTokens = toNumber(totalUsage.output_tokens) ?? tracing.totalOutputTokens;
    tracing.totalCachedInputTokens = toNumber(totalUsage.cached_input_tokens) ?? tracing.totalCachedInputTokens;
    tracing.totalReasoningOutputTokens = toNumber(totalUsage.reasoning_output_tokens) ?? tracing.totalReasoningOutputTokens;
    tracing.totalTokens = toNumber(totalUsage.total_tokens) ?? tracing.totalTokens;
  }
  state.tracing = tracing;
}

function mergeRateLimits(state: MutableCodexState, rateLimits: CodexRateLimit): void {
  const windows = [rateLimits.primary, rateLimits.secondary]
    .map(asRecord)
    .filter((window): window is Record<string, unknown> => Boolean(window));

  for (const rawWindow of windows) {
    const window = rawWindow as CodexRateLimitWindow;
    const parsed = parseRateLimitWindow(window);
    if (!parsed.limit) {
      continue;
    }

    const minutes = toNumber(window.window_minutes);
    if (minutes === 300) {
      state.fiveHour = parsed.limit;
    } else if (minutes === 10080) {
      state.sevenDay = parsed.limit;
    }
  }
}

function parseRateLimitWindow(window: CodexRateLimitWindow): { limit?: LimitWindow } {
  // used_percent and usedPercentage are 0–100 values, not fractions
  const rawPercent = toNumber(window.used_percent) ?? toNumber(window.usedPercentage);
  const usedPercentage = rawPercent !== undefined ? Math.max(0, Math.min(100, rawPercent)) : undefined;
  const reset = parseResetEpochSeconds(window.resets_at) ?? parseResetEpochSeconds(window.resetsAtEpochSeconds);

  if (usedPercentage === undefined && reset === undefined) {
    return {};
  }

  return {
    limit: {
      usedPercentage,
      resetsAtEpochSeconds: reset
    }
  };
}

function isBetterCandidate(candidate: ProviderUsageState, current: ProviderUsageState | undefined): boolean {
  if (!current) {
    return true;
  }
  const candidateUpdated = candidate.lastUpdatedEpochMs ?? 0;
  const currentUpdated = current.lastUpdatedEpochMs ?? 0;
  if (candidateUpdated !== currentUpdated) {
    return candidateUpdated > currentUpdated;
  }
  const candidateHasQuota = Boolean(candidate.fiveHour || candidate.sevenDay);
  const currentHasQuota = Boolean(current.fiveHour || current.sevenDay);
  if (candidateHasQuota !== currentHasQuota) {
    return candidateHasQuota;
  }
  return false;
}

function updateLatest(state: MutableCodexState, timestampMs: number): void {
  if (!state.lastUpdatedEpochMs || timestampMs > state.lastUpdatedEpochMs) {
    state.lastUpdatedEpochMs = timestampMs;
  }
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

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return value;
    if (value > 1_000_000_000) return value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function parseResetEpochSeconds(value: unknown): number | undefined {
  const numeric = toNumber(value);
  if (numeric !== undefined) {
    if (numeric > 1_000_000_000_000) return Math.floor(numeric / 1000);
    if (numeric > 1_000_000_000) return Math.floor(numeric);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value >= 0 && value <= 1) return value * 100;
  return Math.max(0, Math.min(100, value));
}
