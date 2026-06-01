import { AuthenticatedQuotaStatus } from '../../types';
import type { UsageDashboardSourceInfo, UsageDashboardSourceConfidence, UsageDashboardHistoryChartPoint, UsageDashboardMetricCard } from '../usageDashboardModel';
import type { RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import type { UsageHistoryPoint } from '../usageHistoryBinning';
import { addThousandsSeparators } from '../../display/format';
import { displayTotalTokens } from '../../snapshot/tokenMath';

interface LocalHistoryModelUsageRow {
  model: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  reasoningOutputTokens?: number;
}

export const AUTH_DISABLED_STATUSES = new Set<AuthenticatedQuotaStatus>(['disabled', 'not_configured', 'skipped']);

export function sourceInfo(
  confidence: UsageDashboardSourceConfidence,
  label: string,
  detail?: string,
  unavailableReason?: string
): UsageDashboardSourceInfo {
  return {
    confidence,
    label,
    ...(detail ? { detail } : {}),
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

export function shortenClaudeModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace('-20251001', '')
    .replace('-20250514', '');
}

export function shortenCodexModel(model: string): string {
  if (model.startsWith('<synthetic>') || model.includes('<synthetic>')) {
    return '<synthetic>';
  }
  return model
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${addThousandsSeparators((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${addThousandsSeparators((value / 1_000).toFixed(1))}K`;
  }
  return Math.round(value).toLocaleString();
}

export function formatUsd(value: number): string {
  return `$${addThousandsSeparators(value.toFixed(value >= 100 ? 0 : 2))}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  const clamped = clamp(value, 0, 1);
  if (clamped > 0 && clamped < 0.01) {
    return '<1%';
  }

  return `${Math.round(clamped * 100)}%`;
}

export function formatPercentSuffix(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return '';
  }

  return ` (${formatPercent(value / total)})`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePositiveNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

export function normalizePercent(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return clamp(value, 0, 100);
}

export function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    const normalized = normalizePositiveNumber(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

export function addNumbers(...values: Array<number | undefined>): number | undefined {
  const normalizedValues = values
    .map(normalizePositiveNumber)
    .filter((value): value is number => value !== undefined);

  if (normalizedValues.length === 0) {
    return undefined;
  }

  return normalizedValues.reduce((sum, value) => sum + value, 0);
}

export function formatProviderStatus(status: AuthenticatedQuotaStatus | undefined): string | undefined {
  switch (status) {
    case undefined:
      return undefined;
    case 'disabled':
      return 'authenticated quota provider: disabled';
    case 'not_configured':
      return 'authenticated quota provider: not configured';
    case 'skipped':
      return 'authenticated quota provider: skipped (local usage data)';
    case 'backoff':
      return 'authenticated quota provider: in backoff';
    case 'success':
      return 'authenticated quota provider: active';
    case 'http_error':
      return 'authenticated quota provider: HTTP error';
    case 'network_error':
      return 'authenticated quota provider: network error';
    case 'auth_expired':
      return 'authenticated quota provider: auth expired';
    case 'parse_error':
      return 'authenticated quota provider: response parse error';
    default:
      return status;
  }
}

export function mapModelUsageToHistory(
  modelUsage: ReadonlyArray<{
    model: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    reasoningOutputTokens?: number;
    assistantMessages: number;
  }>,
  shortenModel: (model: string) => string
): {
  label: string; model: string; pricingModel: string; totalTokens: number;
  inputTokens: number; outputTokens: number; cacheCreationInputTokens: number;
  cacheReadInputTokens: number; reasoningOutputTokens?: number; assistantMessages: number
}[] {
  return modelUsage.map(m => ({
    label: shortenModel(m.model),
    model: m.model,
    pricingModel: m.model,
    totalTokens: displayTotalTokens(m),
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreationInputTokens: m.cacheCreationInputTokens,
    cacheReadInputTokens: m.cacheReadInputTokens,
    reasoningOutputTokens: m.reasoningOutputTokens,
    assistantMessages: m.assistantMessages
  }));
}

export function buildHistoryUnavailableCard(
  key: string,
  label: string,
  source: UsageDashboardSourceInfo
): UsageDashboardMetricCard {
  return {
    key,
    label,
    value: 'Unavailable',
    detail: source.unavailableReason ?? 'No safe Claude history buckets are available yet.',
    available: false,
    source
  };
}

export function buildCodexHistoryUnavailableCard(
  key: string,
  label: string,
  source: UsageDashboardSourceInfo
): UsageDashboardMetricCard {
  return {
    key,
    label,
    value: 'Unavailable',
    detail: source.unavailableReason ?? 'No Codex correlated day-bucket data is available yet.',
    available: false,
    source
  };
}

export function buildUnavailableBreakdownCard(
  key: string,
  label: string,
  reason: string
): UsageDashboardMetricCard {
  return {
    key,
    label,
    value: 'Unavailable',
    detail: reason,
    available: false,
    source: sourceInfo(
      'unavailable',
      `${label} unavailable`,
      undefined,
      reason
    )
  };
}

export function buildUnavailableMetricCard(key: string, label: string, detail: string): UsageDashboardMetricCard {
  return {
    key,
    label,
    value: 'Unavailable',
    detail,
    available: false
  };
}

export function normalizeRemoteHistoryPointModels(
  points: UsageHistoryPoint[],
  shortenModel: (model: string) => string
): UsageDashboardHistoryChartPoint[] {
  return points.map(point => ({
    ...(point as UsageDashboardHistoryChartPoint),
    models: (point.models ?? []).map(model => ({
      ...model,
      label: shortenModel(model.model || model.label)
    }))
  }));
}

export function accumulateLocalHistoryModelRows(
  modelTotals: Map<string, { totalTokens: number; assistantMessages: number }>,
  days: ReadonlyArray<{ modelUsage: ReadonlyArray<LocalHistoryModelUsageRow> }>
): void {
  for (const day of days) {
    for (const model of day.modelUsage) {
      const totalTokens = displayTotalTokens(model);
      if (!model.model || totalTokens <= 0) {
        continue;
      }
      const existing = modelTotals.get(model.model);
      if (existing) {
        existing.totalTokens += totalTokens;
        existing.assistantMessages += model.assistantMessages;
      } else {
        modelTotals.set(model.model, {
          totalTokens,
          assistantMessages: model.assistantMessages
        });
      }
    }
  }
}

export function remoteModelEntriesToCostRows(entries: RemoteModelEntry[] | undefined): Array<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}> | undefined {
  if (!entries?.length) {
    return undefined;
  }
  const rows = entries
    .filter(entry => entry.model && displayTotalTokens({
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      cacheReadTokens: entry.cacheReadTokens
    }) > 0)
    .map(entry => ({
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationInputTokens: entry.cacheCreationTokens,
      cacheReadInputTokens: entry.cacheReadTokens
    }));
  return rows.length === entries.length ? rows : undefined;
}
