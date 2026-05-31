export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface AggregateUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCacheReadInputTokens: number;
  totalTokens: number;
  totalAssistantMessages: number;
}

export type LocalHistoryWindowId = 'today' | 'last5h' | 'last7d' | 'all';

export type LocalHistoryWindowAggregateMap = Record<LocalHistoryWindowId, AggregateUsage>;

export const LOCAL_HISTORY_WINDOW_IDS: ReadonlyArray<LocalHistoryWindowId> = [
  'today',
  'last5h',
  'last7d',
  'all',
];

export const LOCAL_HISTORY_WINDOW_LABELS: Record<LocalHistoryWindowId, string> = {
  today: 'Today',
  last5h: 'Last 5h',
  last7d: 'Last 7d',
  all: 'All local history',
};

export const DEFAULT_LOCAL_HISTORY_WINDOW_ID: LocalHistoryWindowId = 'today';

export function createEmptyAggregate(): AggregateUsage {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalTokens: 0,
    totalAssistantMessages: 0,
  };
}

export function cloneAggregate(aggregate: AggregateUsage): AggregateUsage {
  return {
    totalInputTokens: aggregate.totalInputTokens,
    totalOutputTokens: aggregate.totalOutputTokens,
    totalCacheCreationInputTokens: aggregate.totalCacheCreationInputTokens,
    totalCacheReadInputTokens: aggregate.totalCacheReadInputTokens,
    totalTokens: aggregate.totalTokens,
    totalAssistantMessages: aggregate.totalAssistantMessages,
  };
}

export function createEmptyLocalHistoryWindowAggregateMap(): LocalHistoryWindowAggregateMap {
  return {
    today: createEmptyAggregate(),
    last5h: createEmptyAggregate(),
    last7d: createEmptyAggregate(),
    all: createEmptyAggregate(),
  };
}

export function tokenUsageTotal(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

export function mergeTokenUsage(
  aggregate: AggregateUsage,
  usage: TokenUsage,
): void {
  aggregate.totalAssistantMessages += 1;
  aggregate.totalInputTokens += usage.inputTokens;
  aggregate.totalOutputTokens += usage.outputTokens;
  aggregate.totalCacheCreationInputTokens += usage.cacheCreationInputTokens;
  aggregate.totalCacheReadInputTokens += usage.cacheReadInputTokens;
  aggregate.totalTokens += tokenUsageTotal(usage);
}

export function parseTimestampEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return undefined;
    }
    return Math.floor(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

export function mergeTokenUsageIntoLocalHistoryWindows(
  windows: LocalHistoryWindowAggregateMap,
  usage: TokenUsage,
  timestampEpochMs: number | undefined,
  nowMs = Date.now(),
): void {
  mergeTokenUsage(windows.all, usage);

  if (timestampEpochMs === undefined || timestampEpochMs > nowMs) {
    return;
  }

  const todayStartMs = startOfLocalDayMs(nowMs);
  if (timestampEpochMs >= todayStartMs) {
    mergeTokenUsage(windows.today, usage);
  }

  if (timestampEpochMs >= nowMs - (5 * 60 * 60 * 1000)) {
    mergeTokenUsage(windows.last5h, usage);
  }

  if (timestampEpochMs >= nowMs - (7 * 24 * 60 * 60 * 1000)) {
    mergeTokenUsage(windows.last7d, usage);
  }
}

function startOfLocalDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
