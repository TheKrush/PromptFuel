import {
  type ClaudeFileContribution,
  type ClaudeJsonlFileInfo,
  type ClaudeDayModelContribution,
  type ClaudeHistoryUsageBucket,
  type ClaudeHistoryModelUsage,
  type ClaudeUsageHistory,
  listClaudeJsonlFiles,
  scanClaudeFileContribution
} from './claudeDayBucketScanner';
import {
  type CodexFileContribution,
  type CodexJsonlFileInfo,
  type CodexDayModelContribution,
  type CodexCorrelatedHistoryBucket,
  type CodexCorrelatedHistoryModelUsage,
  type CodexCorrelatedHistory,
  listCodexJsonlFiles,
  scanCodexFileContribution
} from './codexCorrelatedDayBucketScanner';

// ---------------------------------------------------------------------------
// Cache types
// ---------------------------------------------------------------------------

interface ClaudeFileCacheEntry {
  mtimeMs: number;
  size: number;
  contribution: ClaudeFileContribution;
}

export interface ClaudeHistoryCache {
  dirPath: string;
  dateKey: string;
  entries: Map<string, ClaudeFileCacheEntry>;
}

export function makeClaudeHistoryCache(): ClaudeHistoryCache {
  return { dirPath: '', dateKey: '', entries: new Map() };
}

interface CodexFileCacheEntry {
  mtimeMs: number;
  size: number;
  contribution: CodexFileContribution;
}

export interface CodexHistoryCache {
  dirPath: string;
  dateKey: string;
  entries: Map<string, CodexFileCacheEntry>;
}

export function makeCodexHistoryCache(): CodexHistoryCache {
  return { dirPath: '', dateKey: '', entries: new Map() };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getLocalDateKey(targetDate: Date = new Date()): string {
  return `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
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
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    rangeLabel: `${fmt(start)} to ${fmt(new Date(end.getTime() - 1))}`,
    totalDays
  };
}

// ---------------------------------------------------------------------------
// Claude incremental history
// ---------------------------------------------------------------------------

function mergeClaudeContributions(
  cache: ClaudeHistoryCache,
  relevantPaths: Set<string>,
  filesFound: number,
  fileReadErrors: number,
  range: { startMs: number; endMs: number; rangeLabel: string; totalDays: number }
): ClaudeUsageHistory {
  const mergedDays = new Map<string, {
    assistantMessages: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    modelBreakdown: Map<string, ClaudeDayModelContribution>;
  }>();

  const globalModels = new Map<string, ClaudeHistoryModelUsage>();
  let totalRecordsRead = 0;
  let totalRecordsMatched = 0;
  let filesInspected = 0;

  for (const [filePath, entry] of cache.entries) {
    if (!relevantPaths.has(filePath)) { continue; }
    filesInspected++;
    totalRecordsRead += entry.contribution.recordsRead;
    totalRecordsMatched += entry.contribution.recordsMatched;

    for (const [dateKey, dayContrib] of entry.contribution.days) {
      let mergedDay = mergedDays.get(dateKey);
      if (!mergedDay) {
        mergedDay = { assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, modelBreakdown: new Map() };
        mergedDays.set(dateKey, mergedDay);
      }
      mergedDay.assistantMessages += dayContrib.assistantMessages;
      mergedDay.inputTokens += dayContrib.inputTokens;
      mergedDay.outputTokens += dayContrib.outputTokens;
      mergedDay.cacheCreationInputTokens += dayContrib.cacheCreationInputTokens;
      mergedDay.cacheReadInputTokens += dayContrib.cacheReadInputTokens;

      for (const [model, mc] of dayContrib.modelBreakdown) {
        let dayModel = mergedDay.modelBreakdown.get(model);
        if (!dayModel) {
          dayModel = { assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
          mergedDay.modelBreakdown.set(model, dayModel);
        }
        dayModel.assistantMessages += mc.assistantMessages;
        dayModel.inputTokens += mc.inputTokens;
        dayModel.outputTokens += mc.outputTokens;
        dayModel.cacheCreationInputTokens += mc.cacheCreationInputTokens;
        dayModel.cacheReadInputTokens += mc.cacheReadInputTokens;

        let gm = globalModels.get(model);
        if (!gm) {
          gm = { model, assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 0 };
          globalModels.set(model, gm);
        }
        gm.assistantMessages += mc.assistantMessages;
        gm.inputTokens += mc.inputTokens;
        gm.outputTokens += mc.outputTokens;
        gm.cacheCreationInputTokens += mc.cacheCreationInputTokens;
        gm.cacheReadInputTokens += mc.cacheReadInputTokens;
        gm.totalTokens += mc.inputTokens + mc.outputTokens + mc.cacheCreationInputTokens + mc.cacheReadInputTokens;
      }
    }
  }

  const days: ClaudeHistoryUsageBucket[] = Array.from(mergedDays.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, day]) => {
      const modelUsage: ClaudeHistoryModelUsage[] = Array.from(day.modelBreakdown.entries())
        .map(([model, m]) => ({
          model,
          assistantMessages: m.assistantMessages,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreationInputTokens: m.cacheCreationInputTokens,
          cacheReadInputTokens: m.cacheReadInputTokens,
          totalTokens: m.inputTokens + m.outputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens);
      const totalTokens = day.inputTokens + day.outputTokens + day.cacheCreationInputTokens + day.cacheReadInputTokens;
      return {
        available: day.assistantMessages > 0,
        dateKey,
        dateLabel: dateKey,
        assistantMessages: day.assistantMessages,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        cacheCreationInputTokens: day.cacheCreationInputTokens,
        cacheReadInputTokens: day.cacheReadInputTokens,
        totalTokens,
        models: modelUsage.map(m => m.model),
        modelUsage,
        filesFound: 0,
        filesInspected: 0,
        recordsRead: 0,
        recordsMatched: day.assistantMessages,
        fileReadErrors: 0
      };
    });

  const modelUsage = Array.from(globalModels.values()).sort((a, b) => b.totalTokens - a.totalTokens);

  let assistantMessages = 0, inputTokens = 0, outputTokens = 0, cacheCreationInputTokens = 0, cacheReadInputTokens = 0, totalTokens = 0;
  for (const d of days) {
    assistantMessages += d.assistantMessages;
    inputTokens += d.inputTokens;
    outputTokens += d.outputTokens;
    cacheCreationInputTokens += d.cacheCreationInputTokens;
    cacheReadInputTokens += d.cacheReadInputTokens;
    totalTokens += d.totalTokens;
  }

  const activeDays = days.filter(d => d.recordsMatched > 0).length;
  const history: ClaudeUsageHistory = {
    available: totalRecordsMatched > 0,
    rangeLabel: range.rangeLabel,
    totalDays: range.totalDays,
    activeDays,
    days,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
    modelUsage,
    filesFound,
    filesInspected,
    recordsRead: totalRecordsRead,
    recordsMatched: totalRecordsMatched,
    fileReadErrors
  };

  if (!history.available) {
    history.error = filesInspected > 0
      ? 'No Claude assistant-message usage records found for the history range.'
      : 'Claude JSONL project files were found, but none appeared to be updated for the history range.';
  }

  return history;
}

export async function readClaudeHistoryIncremental(
  dirPath: string,
  days: number,
  cache: ClaudeHistoryCache,
  targetDate: Date = new Date()
): Promise<ClaudeUsageHistory> {
  const dateKey = getLocalDateKey(targetDate);
  const range = getRecentLocalDayRange(days, targetDate);

  if (cache.dirPath !== dirPath || cache.dateKey !== dateKey) {
    cache.entries.clear();
    cache.dirPath = dirPath;
    cache.dateKey = dateKey;
  }

  let files: ClaudeJsonlFileInfo[];
  try {
    files = await listClaudeJsonlFiles(dirPath);
  } catch {
    return {
      available: false, rangeLabel: range.rangeLabel, totalDays: range.totalDays, activeDays: 0, days: [],
      assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      totalTokens: 0, modelUsage: [], filesFound: 0, filesInspected: 0, recordsRead: 0, recordsMatched: 0,
      fileReadErrors: 0, error: 'Claude projects path is unavailable or unreadable.'
    };
  }

  if (files.length === 0) {
    return {
      available: false, rangeLabel: range.rangeLabel, totalDays: range.totalDays, activeDays: 0, days: [],
      assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      totalTokens: 0, modelUsage: [], filesFound: 0, filesInspected: 0, recordsRead: 0, recordsMatched: 0,
      fileReadErrors: 0, error: 'No Claude JSONL project files found.'
    };
  }

  const currentPaths = new Set(files.map(f => f.file));
  for (const cachedPath of cache.entries.keys()) {
    if (!currentPaths.has(cachedPath)) { cache.entries.delete(cachedPath); }
  }

  let fileReadErrors = 0;
  const relevantPaths = new Set<string>();

  for (const candidate of files) {
    if (candidate.mtimeMs < range.startMs - 60_000) { continue; }
    relevantPaths.add(candidate.file);

    const existing = cache.entries.get(candidate.file);
    if (existing && existing.mtimeMs === candidate.mtimeMs && existing.size === candidate.size) { continue; }

    try {
      const contribution = await scanClaudeFileContribution(candidate.file, range.startMs, range.endMs);
      cache.entries.set(candidate.file, { mtimeMs: candidate.mtimeMs, size: candidate.size, contribution });
    } catch {
      fileReadErrors++;
    }
  }

  return mergeClaudeContributions(cache, relevantPaths, files.length, fileReadErrors, range);
}

// ---------------------------------------------------------------------------
// Codex incremental history
// ---------------------------------------------------------------------------

function parseDateKey(key: string): Date {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mergeCodexContributions(
  cache: CodexHistoryCache,
  relevantPaths: Set<string>,
  filesFound: number,
  fileReadErrors: number,
  range: { startMs: number; endMs: number; rangeLabel: string; totalDays: number }
): CodexCorrelatedHistory {
  const mergedDays = new Map<string, {
    correlatedTurns: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    modelBreakdown: Map<string, CodexDayModelContribution>;
  }>();

  const globalModels = new Map<string, CodexCorrelatedHistoryModelUsage>();
  let totalRecordsRead = 0;
  let totalRecordsMatched = 0;
  let filesInspected = 0;
  let skippedMissingTokenData = 0, skippedMissingModel = 0, skippedMissingBaseline = 0, skippedNegativeDelta = 0;
  let skippedTaskStartedWithoutTurnId = 0, skippedTokenCountOutsideTurn = 0, skippedCloseWithoutTurn = 0, skippedCompletionTimestampMissing = 0;

  for (const [filePath, entry] of cache.entries) {
    if (!relevantPaths.has(filePath)) { continue; }
    filesInspected++;
    totalRecordsRead += entry.contribution.recordsRead;
    totalRecordsMatched += entry.contribution.recordsMatched;
    skippedMissingTokenData += entry.contribution.skippedMissingTokenData;
    skippedMissingModel += entry.contribution.skippedMissingModel;
    skippedMissingBaseline += entry.contribution.skippedMissingBaseline;
    skippedNegativeDelta += entry.contribution.skippedNegativeDelta;
    skippedTaskStartedWithoutTurnId += entry.contribution.skippedTaskStartedWithoutTurnId;
    skippedTokenCountOutsideTurn += entry.contribution.skippedTokenCountOutsideTurn;
    skippedCloseWithoutTurn += entry.contribution.skippedCloseWithoutTurn;
    skippedCompletionTimestampMissing += entry.contribution.skippedCompletionTimestampMissing;

    for (const [dateKey, dayContrib] of entry.contribution.days) {
      let mergedDay = mergedDays.get(dateKey);
      if (!mergedDay) {
        mergedDay = { correlatedTurns: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, modelBreakdown: new Map() };
        mergedDays.set(dateKey, mergedDay);
      }
      mergedDay.correlatedTurns += dayContrib.correlatedTurns;
      mergedDay.inputTokens += dayContrib.inputTokens;
      mergedDay.outputTokens += dayContrib.outputTokens;
      mergedDay.cacheCreationInputTokens += dayContrib.cacheCreationInputTokens;
      mergedDay.reasoningOutputTokens += dayContrib.reasoningOutputTokens;
      mergedDay.totalTokens += dayContrib.totalTokens;

      for (const [model, mc] of dayContrib.modelBreakdown) {
        let dayModel = mergedDay.modelBreakdown.get(model);
        if (!dayModel) {
          dayModel = { correlatedTurns: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
          mergedDay.modelBreakdown.set(model, dayModel);
        }
        dayModel.correlatedTurns += mc.correlatedTurns;
        dayModel.inputTokens += mc.inputTokens;
        dayModel.outputTokens += mc.outputTokens;
        dayModel.cacheCreationInputTokens += mc.cacheCreationInputTokens;
        dayModel.reasoningOutputTokens += mc.reasoningOutputTokens;
        dayModel.totalTokens += mc.totalTokens;

        let gm = globalModels.get(model);
        if (!gm) {
          gm = { model, assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
          globalModels.set(model, gm);
        }
        gm.assistantMessages += mc.correlatedTurns;
        gm.inputTokens += mc.inputTokens;
        gm.outputTokens += mc.outputTokens;
        gm.cacheCreationInputTokens += mc.cacheCreationInputTokens;
        gm.reasoningOutputTokens += mc.reasoningOutputTokens;
        gm.totalTokens += mc.totalTokens;
      }
    }
  }

  // Build day array filling zeros for all calendar days in range
  const startKey = formatLocalDateKey(new Date(range.startMs));
  const endKey = formatLocalDateKey(new Date(range.endMs - 1));
  const days: CodexCorrelatedHistoryBucket[] = [];
  let activeDays = 0;

  const cursor = parseDateKey(startKey);
  const endDate = parseDateKey(endKey);
  while (cursor <= endDate) {
    const key = formatLocalDateKey(cursor);
    const md = mergedDays.get(key);
    if (md) {
      const modelUsage: CodexCorrelatedHistoryModelUsage[] = Array.from(md.modelBreakdown.entries())
        .map(([model, m]) => ({
          model,
          assistantMessages: m.correlatedTurns,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreationInputTokens: m.cacheCreationInputTokens,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: m.reasoningOutputTokens,
          totalTokens: m.totalTokens
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens);
      if (md.correlatedTurns > 0) { activeDays++; }
      days.push({
        available: md.correlatedTurns > 0,
        dateKey: key,
        dateLabel: key,
        assistantMessages: md.correlatedTurns,
        inputTokens: md.inputTokens,
        outputTokens: md.outputTokens,
        cacheCreationInputTokens: md.cacheCreationInputTokens,
        cacheReadInputTokens: 0,
        reasoningOutputTokens: md.reasoningOutputTokens,
        totalTokens: md.totalTokens,
        models: modelUsage.map(m => m.model),
        modelUsage,
        correlatedTurns: md.correlatedTurns,
        filesFound: 0,
        filesInspected: 0,
        recordsRead: 0,
        recordsMatched: md.correlatedTurns,
        fileReadErrors: 0,
        skippedMissingTokenData: 0,
        skippedMissingModel: 0,
        skippedMissingBaseline: 0,
        skippedNegativeDelta: 0
      });
    } else {
      days.push({
        available: false, dateKey: key, dateLabel: key,
        assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, models: [], modelUsage: [],
        correlatedTurns: 0, filesFound: 0, filesInspected: 0, recordsRead: 0, recordsMatched: 0,
        fileReadErrors: 0, skippedMissingTokenData: 0, skippedMissingModel: 0, skippedMissingBaseline: 0, skippedNegativeDelta: 0
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const modelUsage = Array.from(globalModels.values()).sort((a, b) => b.totalTokens - a.totalTokens);

  let assistantMessages = 0, inputTokens = 0, outputTokens = 0, cacheCreationInputTokens = 0, reasoningOutputTokens = 0, totalTokens = 0;
  for (const d of days) {
    assistantMessages += d.assistantMessages;
    inputTokens += d.inputTokens;
    outputTokens += d.outputTokens;
    cacheCreationInputTokens += d.cacheCreationInputTokens;
    reasoningOutputTokens += d.reasoningOutputTokens;
    totalTokens += d.totalTokens;
  }

  const history: CodexCorrelatedHistory = {
    available: totalRecordsMatched > 0,
    rangeLabel: range.rangeLabel,
    totalDays: range.totalDays,
    activeDays,
    days,
    assistantMessages,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens: 0,
    reasoningOutputTokens,
    totalTokens,
    modelUsage,
    filesFound,
    filesInspected,
    recordsRead: totalRecordsRead,
    recordsMatched: totalRecordsMatched,
    fileReadErrors,
    skippedMissingTokenData,
    skippedMissingModel,
    skippedMissingBaseline,
    skippedNegativeDelta,
    skippedTaskStartedWithoutTurnId,
    skippedTokenCountOutsideTurn,
    skippedCloseWithoutTurn,
    skippedCompletionTimestampMissing
  };

  if (!history.available) {
    history.error = filesInspected > 0
      ? 'No Codex correlated usage records found for the history range.'
      : 'Codex JSONL session files were found, but none appeared to be updated for the history range.';
  }

  return history;
}

export async function readCodexHistoryIncremental(
  dirPath: string,
  days: number,
  cache: CodexHistoryCache,
  targetDate: Date = new Date()
): Promise<CodexCorrelatedHistory> {
  const dateKey = getLocalDateKey(targetDate);
  const range = getRecentLocalDayRange(days, targetDate);

  if (cache.dirPath !== dirPath || cache.dateKey !== dateKey) {
    cache.entries.clear();
    cache.dirPath = dirPath;
    cache.dateKey = dateKey;
  }

  let files: CodexJsonlFileInfo[];
  try {
    files = await listCodexJsonlFiles(dirPath);
  } catch {
    return {
      available: false, rangeLabel: range.rangeLabel, totalDays: range.totalDays, activeDays: 0, days: [],
      assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      reasoningOutputTokens: 0, totalTokens: 0, modelUsage: [], filesFound: 0, filesInspected: 0,
      recordsRead: 0, recordsMatched: 0, fileReadErrors: 0,
      skippedMissingTokenData: 0, skippedMissingModel: 0, skippedMissingBaseline: 0, skippedNegativeDelta: 0,
      skippedTaskStartedWithoutTurnId: 0, skippedTokenCountOutsideTurn: 0, skippedCloseWithoutTurn: 0, skippedCompletionTimestampMissing: 0,
      error: 'Codex sessions path is unavailable or unreadable.'
    };
  }

  if (files.length === 0) {
    return {
      available: false, rangeLabel: range.rangeLabel, totalDays: range.totalDays, activeDays: 0, days: [],
      assistantMessages: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      reasoningOutputTokens: 0, totalTokens: 0, modelUsage: [], filesFound: 0, filesInspected: 0,
      recordsRead: 0, recordsMatched: 0, fileReadErrors: 0,
      skippedMissingTokenData: 0, skippedMissingModel: 0, skippedMissingBaseline: 0, skippedNegativeDelta: 0,
      skippedTaskStartedWithoutTurnId: 0, skippedTokenCountOutsideTurn: 0, skippedCloseWithoutTurn: 0, skippedCompletionTimestampMissing: 0,
      error: 'No Codex JSONL session files found.'
    };
  }

  const currentPaths = new Set(files.map(f => f.file));
  for (const cachedPath of cache.entries.keys()) {
    if (!currentPaths.has(cachedPath)) { cache.entries.delete(cachedPath); }
  }

  let fileReadErrors = 0;
  const relevantPaths = new Set<string>();

  for (const candidate of files) {
    if (candidate.mtimeMs < range.startMs - 60_000) { continue; }
    relevantPaths.add(candidate.file);

    const existing = cache.entries.get(candidate.file);
    if (existing && existing.mtimeMs === candidate.mtimeMs && existing.size === candidate.size) { continue; }

    try {
      const contribution = await scanCodexFileContribution(candidate.file, range.startMs, range.endMs);
      cache.entries.set(candidate.file, { mtimeMs: candidate.mtimeMs, size: candidate.size, contribution });
    } catch {
      fileReadErrors++;
    }
  }

  return mergeCodexContributions(cache, relevantPaths, files.length, fileReadErrors, range);
}
