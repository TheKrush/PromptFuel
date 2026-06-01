import type { ProviderId } from './providers';
import {
  LOCAL_HISTORY_WINDOW_IDS,
  type LocalHistoryWindowId,
  type TokenUsage,
  tokenUsageTotal,
} from './usageAggregate';

export type ModelUsageSource = 'local' | 'snapshot' | 'combined';

export const UNKNOWN_MODEL_LABEL = 'Unknown model';

export interface ModelUsageAggregate {
  providerId: ProviderId;
  modelLabel: string;
  totalTokens: number;
  totalAssistantMessages: number;
  source?: ModelUsageSource;
  windowId?: LocalHistoryWindowId;
}

export type ModelUsageWindowAggregateMap = Record<LocalHistoryWindowId, ModelUsageAggregate[]>;

const MAX_MODEL_LABEL_LENGTH = 80;
const UNSAFE_MODEL_LABEL_PARTS = [
  'secret',
  'token',
  'password',
  'apikey',
  'api_key',
  'credential',
];

export function createEmptyModelUsageWindowAggregateMap(): ModelUsageWindowAggregateMap {
  return {
    today: [],
    last5h: [],
    last7d: [],
    all: [],
  };
}

export function cloneModelUsageAggregates(
  models: ReadonlyArray<ModelUsageAggregate> | undefined,
): ModelUsageAggregate[] | undefined {
  if (!models) {
    return undefined;
  }
  return models.map(cloneModelUsageAggregate);
}

export function cloneModelUsageWindowAggregates(
  windows: Partial<ModelUsageWindowAggregateMap> | undefined,
): Partial<ModelUsageWindowAggregateMap> | undefined {
  if (!windows) {
    return undefined;
  }

  const cloned: Partial<ModelUsageWindowAggregateMap> = {};
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    if (windows[windowId]) {
      cloned[windowId] = cloneModelUsageAggregates(windows[windowId]) ?? [];
    }
  }
  return cloned;
}

export function cloneModelUsageAggregate(model: ModelUsageAggregate): ModelUsageAggregate {
  return {
    providerId: model.providerId,
    modelLabel: model.modelLabel,
    totalTokens: model.totalTokens,
    totalAssistantMessages: model.totalAssistantMessages,
    ...(model.source ? { source: model.source } : {}),
    ...(model.windowId ? { windowId: model.windowId } : {}),
  };
}

export function sanitizeModelLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_MODEL_LABEL_LENGTH) {
    return undefined;
  }
  if (/[\u0000-\u001f\u007f<>|\\/]/.test(trimmed)) {
    return undefined;
  }
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('.') || trimmed.includes('..')) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (UNSAFE_MODEL_LABEL_PARTS.some(part => lower.includes(part))) {
    return undefined;
  }

  return trimmed;
}

export function safeModelLabel(value: unknown): string {
  return sanitizeModelLabel(value) ?? UNKNOWN_MODEL_LABEL;
}

export function mergeModelTokenUsage(
  target: ModelUsageAggregate[],
  providerId: ProviderId,
  modelValue: unknown,
  usage: TokenUsage,
): void {
  mergeModelUsageAggregate(target, {
    providerId,
    modelLabel: safeModelLabel(modelValue),
    totalTokens: tokenUsageTotal(usage),
    totalAssistantMessages: 1,
  });
}

export function mergeModelTokenUsageIntoLocalHistoryWindows(
  windows: ModelUsageWindowAggregateMap,
  providerId: ProviderId,
  modelValue: unknown,
  usage: TokenUsage,
  timestampEpochMs: number | undefined,
  nowMs = Date.now(),
): void {
  mergeModelTokenUsage(windows.all, providerId, modelValue, usage);

  if (timestampEpochMs === undefined || timestampEpochMs > nowMs) {
    return;
  }

  const todayStartMs = startOfLocalDayMs(nowMs);
  if (timestampEpochMs >= todayStartMs) {
    mergeModelTokenUsage(windows.today, providerId, modelValue, usage);
  }

  if (timestampEpochMs >= nowMs - (5 * 60 * 60 * 1000)) {
    mergeModelTokenUsage(windows.last5h, providerId, modelValue, usage);
  }

  if (timestampEpochMs >= nowMs - (7 * 24 * 60 * 60 * 1000)) {
    mergeModelTokenUsage(windows.last7d, providerId, modelValue, usage);
  }
}

export function mergeModelUsageAggregate(
  target: ModelUsageAggregate[],
  model: ModelUsageAggregate,
): void {
  const existing = target.find(entry =>
    entry.providerId === model.providerId &&
    entry.modelLabel.toLowerCase() === model.modelLabel.toLowerCase()
  );

  if (existing) {
    existing.totalTokens += model.totalTokens;
    existing.totalAssistantMessages += model.totalAssistantMessages;
    return;
  }

  target.push(cloneModelUsageAggregate(model));
}

export function mergeModelUsageAggregates(
  left: ReadonlyArray<ModelUsageAggregate> | undefined,
  right: ReadonlyArray<ModelUsageAggregate> | undefined,
  source?: ModelUsageSource,
  windowId?: LocalHistoryWindowId,
): ModelUsageAggregate[] {
  const merged: ModelUsageAggregate[] = [];
  for (const model of [...(left ?? []), ...(right ?? [])]) {
    mergeModelUsageAggregate(merged, {
      ...model,
      ...(source ? { source } : {}),
      ...(windowId ? { windowId } : {}),
    });
  }
  return sortModelUsageAggregates(merged);
}

export function sortModelUsageAggregates(
  models: ReadonlyArray<ModelUsageAggregate>,
): ModelUsageAggregate[] {
  return models.slice().sort((a, b) => {
    const tokenDelta = b.totalTokens - a.totalTokens;
    if (tokenDelta !== 0) {
      return tokenDelta;
    }
    const providerDelta = a.providerId.localeCompare(b.providerId);
    if (providerDelta !== 0) {
      return providerDelta;
    }
    return a.modelLabel.localeCompare(b.modelLabel);
  });
}

function startOfLocalDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
