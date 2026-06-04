import { displayTotalTokens } from '../snapshot/tokenMath';

export type UsageHistoryRangeKey = '1D' | '1W' | '1M' | '1Y' | 'ALL';
export type UsageHistoryBinGranularity = 'day' | 'week' | 'month';

export interface UsageHistoryModelUsage {
  label: string;
  model: string;
  pricingModel?: string;
  provider?: 'claude' | 'codex';
  providerLabel?: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningOutputTokens?: number;
  apiEquivalentCostUsd?: number;
  apiEquivalentCostUnavailableReason?: string;
  pricingMatchedModel?: string;
  pricingCurrency?: string;
  inputRatePerMillionUsd?: number;
  outputRatePerMillionUsd?: number;
  cacheReadRatePerMillionUsd?: number;
  cacheWriteRatePerMillionUsd?: number;
  assistantMessages: number;
}

export interface UsageHistoryProviderSegment {
  provider: 'claude' | 'codex';
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  assistantMessages: number;
  sourceConfidence?: string;
}

export interface UsageHistoryPoint {
  dateKey: string;
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  assistantMessages: number;
  models: UsageHistoryModelUsage[];
  providerSegments?: UsageHistoryProviderSegment[];
  binStartDateKey?: string;
  binEndDateKey?: string;
  sourcePointCount?: number;
  isEmpty?: boolean;
}

export interface UsageHistoryRangeView {
  key: UsageHistoryRangeKey;
  rangeLabel: string;
  granularity: UsageHistoryBinGranularity;
  granularityLabel: string;
  axisLabel: string;
  ariaLabel: string;
  points: UsageHistoryPoint[];
  maxTotalTokens: number;
  activeBinCount: number;
  activeUnitLabel: string;
  unavailableReason?: string;
  limitation?: string;
}

export type UsageHistoryRangeViews = Record<UsageHistoryRangeKey, UsageHistoryRangeView>;

interface RangeConfig {
  key: UsageHistoryRangeKey;
  granularity: UsageHistoryBinGranularity;
  dayCount?: number;
  monthCount?: number;
  rangeLabel: string;
  granularityLabel: string;
  axisLabel: string;
  ariaLabel: string;
  activeUnitLabel: string;
  emptyReason: string;
  limitation?: string;
}

interface DateBin {
  start: Date;
  end: Date;
}

const RANGE_ORDER: UsageHistoryRangeKey[] = ['1D', '1W', '1M', '1Y', 'ALL'];

export function buildUsageHistoryRangeViews(
  points: UsageHistoryPoint[],
  anchorDateKey: string = formatLocalDateKey(new Date())
): UsageHistoryRangeViews {
  const sourcePoints = normalizeSourcePoints(points);
  const anchorDate = parseDateKey(anchorDateKey) ?? new Date();

  return RANGE_ORDER.reduce((views, key) => {
    views[key] = buildUsageHistoryRangeView(sourcePoints, key, anchorDate);
    return views;
  }, {} as UsageHistoryRangeViews);
}

export function buildUsageHistoryRangeView(
  points: UsageHistoryPoint[],
  rangeKey: UsageHistoryRangeKey,
  anchorDate: Date = new Date()
): UsageHistoryRangeView {
  const config = rangeConfig(rangeKey);
  const bins = buildDateBins(config, anchorDate);
  const sourceByDate = new Map<string, UsageHistoryPoint[]>();

  for (const point of normalizeSourcePoints(points)) {
    const existing = sourceByDate.get(point.dateKey) ?? [];
    existing.push(point);
    sourceByDate.set(point.dateKey, existing);
  }

  const binnedPoints = bins.map(bin => aggregateBin(bin, config, sourceByDate));
  const maxTotalTokens = binnedPoints.reduce((max, point) => Math.max(max, point.totalTokens), 0);
  const activeBinCount = binnedPoints.filter(point => !point.isEmpty).length;

  return {
    key: config.key,
    rangeLabel: config.rangeLabel,
    granularity: config.granularity,
    granularityLabel: config.granularityLabel,
    axisLabel: config.axisLabel,
    ariaLabel: config.ariaLabel,
    points: binnedPoints,
    maxTotalTokens,
    activeBinCount,
    activeUnitLabel: config.activeUnitLabel,
    unavailableReason: activeBinCount > 0 ? undefined : config.emptyReason,
    limitation: config.limitation
  };
}

function rangeConfig(key: UsageHistoryRangeKey): RangeConfig {
  switch (key) {
    case '1D':
      return {
        key,
        granularity: 'day',
        dayCount: 1,
        rangeLabel: '1D / today (day-level)',
        granularityLabel: 'Daily fallback',
        axisLabel: 'Day-level source',
        ariaLabel: 'Token trend chart, one day-level bin. Hourly bins are unavailable because source history is day-level.',
        activeUnitLabel: 'days',
        emptyReason: 'No usage records for today.',
        limitation: 'Hourly bins are unavailable because Claude/Codex history points are day-level only.'
      };
    case '1W':
      return {
        key,
        granularity: 'day',
        dayCount: 7,
        rangeLabel: '1W / daily bins',
        granularityLabel: 'Daily bins',
        axisLabel: 'Daily bins',
        ariaLabel: 'Token trend chart, seven daily bins.',
        activeUnitLabel: 'days',
        emptyReason: 'No usage records in this 7-day range.'
      };
    case '1M':
      return {
        key,
        granularity: 'day',
        dayCount: 30,
        rangeLabel: '1M / daily bins',
        granularityLabel: 'Daily bins',
        axisLabel: 'Daily bins',
        ariaLabel: 'Token trend chart, thirty daily bins.',
        activeUnitLabel: 'days',
        emptyReason: 'No usage records in this 30-day range.'
      };
    case '1Y':
      return {
        key,
        granularity: 'week',
        dayCount: 365,
        rangeLabel: '1Y / weekly bins',
        granularityLabel: 'Weekly bins',
        axisLabel: 'Weekly bins',
        ariaLabel: 'Token trend chart, weekly bins across the last year.',
        activeUnitLabel: 'weeks',
        emptyReason: 'No usage records in this yearly range.'
      };
    case 'ALL':
    default:
      return {
        key: 'ALL',
        granularity: 'month',
        monthCount: 12,
        rangeLabel: 'ALL / monthly bins (12M loaded)',
        granularityLabel: 'Monthly bins',
        axisLabel: 'Monthly bins',
        ariaLabel: 'Token trend chart, monthly bins across the loaded 12-month history window.',
        activeUnitLabel: 'months',
        emptyReason: 'No usage records in the loaded history range.',
        limitation: 'ALL is bounded to the loaded 12-month history window to keep the chart readable.'
      };
  }
}

function buildDateBins(config: RangeConfig, anchorDate: Date): DateBin[] {
  const anchorStart = startOfLocalDay(anchorDate);

  if (config.granularity === 'month') {
    const monthCount = Math.max(1, config.monthCount ?? 12);
    const firstMonth = new Date(anchorStart.getFullYear(), anchorStart.getMonth() - (monthCount - 1), 1);
    const bins: DateBin[] = [];
    for (let i = 0; i < monthCount; i++) {
      const start = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      bins.push({ start, end: end > anchorStart ? anchorStart : end });
    }
    return bins;
  }

  const dayCount = Math.max(1, config.dayCount ?? 30);
  const start = addDays(anchorStart, -(dayCount - 1));

  if (config.granularity === 'week') {
    const bins: DateBin[] = [];
    let cursor = start;
    while (cursor <= anchorStart) {
      const end = minDate(addDays(cursor, 6), anchorStart);
      bins.push({ start: cursor, end });
      cursor = addDays(end, 1);
    }
    return bins;
  }

  const bins: DateBin[] = [];
  for (let i = 0; i < dayCount; i++) {
    const day = addDays(start, i);
    bins.push({ start: day, end: day });
  }
  return bins;
}

function aggregateBin(
  bin: DateBin,
  config: RangeConfig,
  sourceByDate: Map<string, UsageHistoryPoint[]>
): UsageHistoryPoint {
  const modelTotals = new Map<string, UsageHistoryModelUsage>();
  const providerTotals = new Map<string, UsageHistoryProviderSegment>();
  const totals = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    assistantMessages: 0,
    sourcePointCount: 0
  };

  forEachDateInBin(bin, date => {
    const dateKey = formatLocalDateKey(date);
    const points = sourceByDate.get(dateKey) ?? [];
    for (const point of points) {
      totals.totalTokens += displayTotalTokens(point);
      totals.inputTokens += Number(point.inputTokens || 0);
      totals.outputTokens += Number(point.outputTokens || 0);
      totals.cacheTokens += Number(point.cacheTokens || 0);
      totals.cacheCreationTokens += Number(point.cacheCreationTokens || 0);
      totals.cacheReadTokens += Number(point.cacheReadTokens || 0);
      totals.assistantMessages += Number(point.assistantMessages || 0);
      totals.sourcePointCount += 1;

      for (const model of point.models || []) {
        const rawModel = model.model || model.label || 'unknown';
        const key = model.provider ? `${model.provider}\0${rawModel}` : rawModel;
        const existing = modelTotals.get(key) ?? {
          label: model.label || rawModel,
          model: rawModel,
          pricingModel: model.pricingModel || model.model || model.label || rawModel,
          provider: model.provider,
          providerLabel: model.providerLabel,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          apiEquivalentCostUsd: 0,
          apiEquivalentCostUnavailableReason: undefined,
          pricingMatchedModel: model.pricingMatchedModel,
          pricingCurrency: model.pricingCurrency,
          inputRatePerMillionUsd: model.inputRatePerMillionUsd,
          outputRatePerMillionUsd: model.outputRatePerMillionUsd,
          cacheReadRatePerMillionUsd: model.cacheReadRatePerMillionUsd,
          cacheWriteRatePerMillionUsd: model.cacheWriteRatePerMillionUsd,
          assistantMessages: 0
        };
        existing.totalTokens += displayTotalTokens(model);
        existing.inputTokens = Number(existing.inputTokens || 0) + Number(model.inputTokens || 0);
        existing.outputTokens = Number(existing.outputTokens || 0) + Number(model.outputTokens || 0);
        existing.cacheCreationInputTokens = Number(existing.cacheCreationInputTokens || 0) + Number(model.cacheCreationInputTokens || 0);
        existing.cacheReadInputTokens = Number(existing.cacheReadInputTokens || 0) + Number(model.cacheReadInputTokens || 0);
        existing.reasoningOutputTokens = Number(existing.reasoningOutputTokens || 0) + Number(model.reasoningOutputTokens || 0);
        if (typeof model.apiEquivalentCostUsd === 'number' && Number.isFinite(model.apiEquivalentCostUsd) && !existing.apiEquivalentCostUnavailableReason) {
          existing.apiEquivalentCostUsd = Number(existing.apiEquivalentCostUsd || 0) + model.apiEquivalentCostUsd;
        } else {
          existing.apiEquivalentCostUsd = undefined;
          existing.apiEquivalentCostUnavailableReason = model.apiEquivalentCostUnavailableReason || 'Pricing unavailable';
        }
        existing.assistantMessages += Number(model.assistantMessages || 0);
        modelTotals.set(key, existing);
      }

      for (const segment of point.providerSegments || []) {
        const key = segment.provider;
        const existing = providerTotals.get(key) ?? {
          provider: segment.provider,
          label: segment.label || segment.provider,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          assistantMessages: 0,
          sourceConfidence: segment.sourceConfidence
        };
        existing.totalTokens += displayTotalTokens(segment);
        existing.inputTokens += Number(segment.inputTokens || 0);
        existing.outputTokens += Number(segment.outputTokens || 0);
        existing.cacheTokens += Number(segment.cacheTokens || 0);
        existing.cacheCreationTokens += Number(segment.cacheCreationTokens || 0);
        existing.cacheReadTokens += Number(segment.cacheReadTokens || 0);
        existing.assistantMessages += Number(segment.assistantMessages || 0);
        providerTotals.set(key, existing);
      }
    }
  });

  const startKey = formatLocalDateKey(bin.start);
  const endKey = formatLocalDateKey(bin.end);

  return {
    dateKey: startKey,
    label: formatBinLabel(bin, config.granularity),
    totalTokens: totals.totalTokens,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheTokens: totals.cacheTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    assistantMessages: totals.assistantMessages,
    models: Array.from(modelTotals.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    providerSegments: Array.from(providerTotals.values()).sort((a, b) => a.provider.localeCompare(b.provider)),
    binStartDateKey: startKey,
    binEndDateKey: endKey,
    sourcePointCount: totals.sourcePointCount,
    isEmpty: totals.totalTokens <= 0 && totals.assistantMessages <= 0
  };
}

function normalizeSourcePoints(points: UsageHistoryPoint[]): UsageHistoryPoint[] {
  return (points || [])
    .filter(point => point && parseDateKey(point.dateKey))
    .map(point => ({
      ...point,
      models: point.models || []
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function forEachDateInBin(bin: DateBin, fn: (date: Date) => void): void {
  let cursor = bin.start;
  while (cursor <= bin.end) {
    fn(cursor);
    cursor = addDays(cursor, 1);
  }
}

function formatBinLabel(bin: DateBin, granularity: UsageHistoryBinGranularity): string {
  if (granularity === 'month') {
    return `${bin.start.getFullYear()}-${String(bin.start.getMonth() + 1).padStart(2, '0')}`;
  }

  if (granularity === 'week') {
    return `${formatShortDate(bin.start)}-${formatShortDate(bin.end)}`;
  }

  return formatShortDate(bin.start);
}

function formatShortDate(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateKey: string | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
