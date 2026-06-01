import type { ModelBreakdownData, ModelBreakdownEntry } from './format';
import type { ProviderName } from '../types';
import { displayTotalTokens } from '../snapshot/tokenMath';
import { sumCostIfComplete } from './apiEquivalentCost';

export const STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS = 7;

export interface HistoryModelUsage {
  model: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

export interface HistoryModelUsageBucket<TModel extends HistoryModelUsage> {
  dateKey: string;
  modelUsage: TModel[];
}

export interface HistoryModelUsageSource<TModel extends HistoryModelUsage> {
  available: boolean;
  days: Array<HistoryModelUsageBucket<TModel>>;
}

export interface StatusHoverRemoteModelContribution {
  model: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  assistantMessages?: number;
}

export interface StatusHoverModelBreakdownProvider<TModel extends HistoryModelUsage> {
  provider: ProviderName;
  history: HistoryModelUsageSource<TModel> | undefined;
  shortenModel: (model: string) => string;
  estimateCostUsd: (model: TModel) => number;
  isFallbackPricing?: (model: TModel) => boolean;
  remoteModelEntries?: StatusHoverRemoteModelContribution[];
}

export function buildStatusHoverModelBreakdown(
  providers: Array<StatusHoverModelBreakdownProvider<HistoryModelUsage>>,
  targetDate = new Date()
): ModelBreakdownData | undefined {
  const data: ModelBreakdownData = {};

  for (const provider of providers) {
    const aggregate = aggregateRecentHistoryModelUsage(
      provider.history,
      STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS,
      targetDate
    );
    const remoteEntries = provider.remoteModelEntries?.filter(entry => entry.tokens > 0) ?? [];
    if (aggregate.length === 0 && remoteEntries.length === 0) {
      continue;
    }

    const byNormalizedModel = new Map<string, ModelBreakdownEntry>();

    for (const model of aggregate) {
      const label = provider.shortenModel(model.model);
      const key = normalizeModelKey(label);
      const existing = byNormalizedModel.get(key);
      if (existing) {
        existing.totalTokens += model.totalTokens;
        existing.assistantMessages = (existing.assistantMessages ?? 0) + model.assistantMessages;
        existing.costUsd = sumCostIfComplete([
          { costUsd: existing.costUsd },
          { costUsd: provider.estimateCostUsd(model) }
        ]);
        existing.isFallback = Boolean(existing.isFallback || provider.isFallbackPricing?.(model));
      } else {
        byNormalizedModel.set(key, {
          label,
          totalTokens: model.totalTokens,
          assistantMessages: model.assistantMessages,
          costUsd: provider.estimateCostUsd(model),
          isFallback: provider.isFallbackPricing ? provider.isFallbackPricing(model) : undefined
        });
      }
    }

    for (const remote of remoteEntries) {
      const label = provider.shortenModel(remote.model);
      const key = normalizeModelKey(label);
      const remoteCostRow = remoteContributionToHistoryUsage(remote);
      const remoteCostUsd = remoteCostRow ? provider.estimateCostUsd(remoteCostRow) : undefined;
      const existing = byNormalizedModel.get(key);
      if (existing) {
        existing.totalTokens += remote.tokens;
        existing.remoteTokens = (existing.remoteTokens ?? 0) + remote.tokens;
        if (remote.assistantMessages !== undefined) {
          existing.assistantMessages = (existing.assistantMessages ?? 0) + remote.assistantMessages;
        }
        existing.costUsd = sumCostIfComplete([
          { costUsd: existing.costUsd },
          { costUsd: remoteCostUsd }
        ]);
        existing.isFallback = Boolean(existing.isFallback || (remoteCostRow && provider.isFallbackPricing?.(remoteCostRow)));
      } else {
        byNormalizedModel.set(key, {
          label,
          totalTokens: remote.tokens,
          assistantMessages: remote.assistantMessages,
          remoteTokens: remote.tokens,
          costUsd: remoteCostUsd,
          isFallback: remoteCostRow && provider.isFallbackPricing ? provider.isFallbackPricing(remoteCostRow) : undefined
        });
      }
    }

    data[provider.provider] = Array.from(byNormalizedModel.values())
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 5);
  }

  return Object.keys(data).length > 0 ? data : undefined;
}

function normalizeModelKey(label: string): string {
  return label.trim().toLowerCase();
}

function remoteContributionToHistoryUsage(remote: StatusHoverRemoteModelContribution): HistoryModelUsage | undefined {
  const inputTokens = remote.inputTokens ?? 0;
  const outputTokens = remote.outputTokens ?? 0;
  const cacheCreationInputTokens = remote.cacheCreationTokens ?? 0;
  const cacheReadInputTokens = remote.cacheReadTokens ?? 0;
  const totalTokens = displayTotalTokens({
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens
  });
  if (!remote.model || totalTokens <= 0 || totalTokens !== remote.tokens) {
    return undefined;
  }
  return {
    model: remote.model,
    assistantMessages: remote.assistantMessages ?? 0,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens
  };
}

export function aggregateRecentHistoryModelUsage<TModel extends HistoryModelUsage>(
  history: HistoryModelUsageSource<TModel> | undefined,
  windowDays: number,
  targetDate = new Date()
): TModel[] {
  if (!history?.available || windowDays <= 0) {
    return [];
  }

  const endKey = formatLocalDateKey(targetDate);
  const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - (windowDays - 1));
  const startKey = formatLocalDateKey(start);
  const byModel = new Map<string, TModel>();

  for (const day of history.days) {
    if (day.dateKey < startKey || day.dateKey > endKey) {
      continue;
    }

    for (const sample of day.modelUsage || []) {
      const sampleTotalTokens = displayTotalTokens(sample);
      const existing = byModel.get(sample.model);
      if (existing) {
        existing.assistantMessages += sample.assistantMessages;
        existing.inputTokens += sample.inputTokens;
        existing.outputTokens += sample.outputTokens;
        existing.cacheCreationInputTokens += sample.cacheCreationInputTokens;
        existing.cacheReadInputTokens += sample.cacheReadInputTokens;
        existing.totalTokens += sampleTotalTokens;
      } else {
        byModel.set(sample.model, { ...sample, totalTokens: sampleTotalTokens });
      }
    }
  }

  return Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
