import { PromptFuelStatus } from '../core/statusModel';
import { ProviderQuotaState } from '../core/quotaTypes';
import { KNOWN_PROVIDERS, PROVIDER_LABELS, isKnownProvider, type ProviderId } from '../core/providers';
import type { LiveQuotaFreshness } from '../core/liveQuotaTypes';
import { CONFIG_DEFAULTS, type DashboardUsageSource } from '../core/configDefaults';
import {
  sanitizeSnapshotSourceLabel,
  uniqueSnapshotSourceLabels,
} from '../core/snapshotTypes';
import {
  DEFAULT_LOCAL_HISTORY_WINDOW_ID,
  LOCAL_HISTORY_WINDOW_IDS,
  LOCAL_HISTORY_WINDOW_LABELS,
  type AggregateUsage,
  LocalHistoryWindowAggregateMap,
  LocalHistoryWindowId,
  createEmptyAggregate,
} from '../core/usageAggregate';
import {
  cloneModelUsageAggregates,
  createEmptyModelUsageWindowAggregateMap,
  mergeModelUsageAggregate,
  sortModelUsageAggregates,
  type ModelUsageAggregate,
  type ModelUsageWindowAggregateMap,
} from '../core/modelUsage';
import type { PromptFuelSnapshotProviderAggregate } from '../core/snapshotTypes';

export type DashboardSourceMode = DashboardUsageSource;

export const DASHBOARD_SOURCE_MODES: ReadonlyArray<DashboardSourceMode> = [
  'local',
  'snapshots',
  'combined',
];

export const DASHBOARD_SOURCE_MODE_LABELS: Record<DashboardSourceMode, string> = {
  local: 'Local only',
  snapshots: 'Snapshots only',
  combined: 'Combined',
};

export interface DashboardLocalHistoryWindow {
  windowId: LocalHistoryWindowId;
  label: string;
  totalTokens: number;
  totalAssistantMessages: number;
  totalCacheCreationInputTokens?: number;
  totalCacheReadInputTokens?: number;
}

export interface DashboardHistoryProviderSegment {
  providerId: ProviderId;
  label: string;
  totalTokens: number;
  totalAssistantMessages: number;
}

export interface DashboardHistoryPoint {
  dateKey: string;
  label: string;
  totalTokens: number;
  totalAssistantMessages: number;
  totalCacheTokens?: number;
  providerSegments: DashboardHistoryProviderSegment[];
  modelAggregates: DashboardModelUsageAggregate[];
}

export interface DashboardModelUsageAggregate {
  providerId: ProviderId;
  providerLabel: string;
  modelLabel: string;
  totalTokens: number;
  totalAssistantMessages: number;
  sourceMode: DashboardSourceMode;
  sourceLabels: string[];
  windowId: LocalHistoryWindowId;
}

export type DashboardModelUsageWindowMap = Record<LocalHistoryWindowId, DashboardModelUsageAggregate[]>;

export interface DashboardSourceModeOption {
  sourceMode: DashboardSourceMode;
  label: string;
  available: boolean;
}

export interface DashboardSourceModeProviderCard {
  providerId: ProviderId;
  label: string;
  status: string;
  totalTokens: number;
  totalAssistantMessages: number;
  parseErrors: number;
  sourceLabels: string[];
  windows: DashboardLocalHistoryWindow[];
  historyPoints: DashboardHistoryPoint[];
  modelWindows: DashboardModelUsageWindowMap;
}

export interface DashboardSourceModeTotals {
  sourceMode: DashboardSourceMode;
  label: string;
  totalTokens: number;
  totalAssistantMessages: number;
  providers: DashboardSourceModeProviderCard[];
  windows: DashboardLocalHistoryWindow[];
  modelWindows: DashboardModelUsageWindowMap;
  historyPoints: DashboardHistoryPoint[];
  sourceLabels: string[];
  missingSnapshotWindowIds: LocalHistoryWindowId[];
}

export interface DashboardProviderCard {
  providerId: string;
  label: string;
  status: string;
  totalTokens: number;
  totalAssistantMessages: number;
  parseErrors: number;
  localHistoryWindows: DashboardLocalHistoryWindow[];
  historyPoints: DashboardHistoryPoint[];
  modelAggregates: ModelUsageAggregate[];
  localHistoryModelWindows: ModelUsageWindowAggregateMap;
}

export interface DashboardLiveQuotaWindow {
  windowId: string;
  usedPercentage?: number;
  remainingPercentage?: number;
  resetsAtEpochMs?: number;
}

export interface DashboardLiveQuotaCard {
  providerId: string;
  label: string;
  freshness: LiveQuotaFreshness;
  windows: DashboardLiveQuotaWindow[];
  lastUpdatedMs: number | undefined;
}

export interface DashboardSnapshotProviderCard {
  providerId: string;
  label: string;
  generatedAtMs: number;
  totalTokens: number;
  totalAssistantMessages: number;
  sourceLabel?: string;
  windows: DashboardLocalHistoryWindow[];
  providedWindowIds: LocalHistoryWindowId[];
  historyPoints: DashboardHistoryPoint[];
  modelAggregates: ModelUsageAggregate[];
  modelWindows: DashboardModelUsageWindowMap;
}

export interface DashboardSnapshotAggregate {
  totalTokens: number;
  totalAssistantMessages: number;
  providers: DashboardSnapshotProviderCard[];
  sourceLabels: string[];
  snapshotCount: number;
  lastReadMs: number | undefined;
}

export interface DashboardModel {
  totalTokens: number;
  totalAssistantMessages: number;
  providers: DashboardProviderCard[];
  localHistoryWindows: DashboardLocalHistoryWindow[];
  defaultLocalHistoryWindowId: LocalHistoryWindowId;
  liveQuotaCards: DashboardLiveQuotaCard[];
  liveQuotaEnabled: boolean;
  lastRefreshedMs: number | undefined;
  localHistoryLastRefreshedMs: number | undefined;
  liveQuotaLastRefreshedMs: number | undefined;
  snapshotAggregate: DashboardSnapshotAggregate;
  sourceModes: DashboardSourceModeOption[];
  sourceModeTotals: DashboardSourceModeTotals[];
  defaultSourceMode: DashboardSourceMode;
}

export function buildDashboardModel(
  status: PromptFuelStatus,
  dashboardUsageSource: DashboardSourceMode = CONFIG_DEFAULTS.dashboardUsageSource,
): DashboardModel {
  let totalTokens = 0;
  let totalAssistantMessages = 0;
  const combinedWindows = createEmptyLocalHistoryWindowTotals();

  const cards: DashboardProviderCard[] = status.providerStates.map((state: ProviderQuotaState) => {
    const tokens = state.totalTokens ?? 0;
    const messages = state.totalAssistantMessages ?? 0;
    const errors = state.parseErrors ?? 0;
    const providerWindows = buildLocalHistoryWindowCards(
      state.localHistoryWindows,
      tokens,
      messages,
    );
    const localHistoryModelWindows = cloneFullModelWindowMap(state.localHistoryModelWindows, state.modelAggregates);

    if (state.status === 'loaded') {
      totalTokens += tokens;
      totalAssistantMessages += messages;
      mergeDashboardWindowTotals(combinedWindows, providerWindows);
    }

    return {
      providerId: state.providerId,
      label: PROVIDER_LABELS[state.providerId as keyof typeof PROVIDER_LABELS] ?? state.providerId,
      status: state.status,
      totalTokens: tokens,
      totalAssistantMessages: messages,
      parseErrors: errors,
      localHistoryWindows: providerWindows,
      historyPoints: isKnownProvider(state.providerId)
        ? buildLocalHistoryPoints(
          state.providerId,
          PROVIDER_LABELS[state.providerId],
          providerWindows,
          toDashboardModelWindows('local', localHistoryModelWindows),
        )
        : [],
      modelAggregates: cloneModelUsageAggregates(state.modelAggregates) ?? [],
      localHistoryModelWindows,
    };
  });

  const snapshotAggregate = buildDashboardSnapshotAggregate(status.snapshotState.providers, status.snapshotState.snapshotCount, status.snapshotLastReadMs);
  const snapshotsAvailable = snapshotAggregate.snapshotCount > 0 && snapshotAggregate.providers.length > 0;
  const sourceModes = buildSourceModeOptions(snapshotsAvailable);
  const defaultSourceMode = normalizeDashboardSourceMode(dashboardUsageSource);
  const sourceModeTotals = buildSourceModeTotals(cards, snapshotAggregate, combinedWindows);

  const liveQuotaCards: DashboardLiveQuotaCard[] = status.liveQuotaStates.map(s => ({
    providerId: s.providerId,
    label: PROVIDER_LABELS[s.providerId as keyof typeof PROVIDER_LABELS] ?? s.providerId,
    freshness: s.freshness,
    windows: s.windows.map(w => ({
      windowId: w.windowId,
      usedPercentage: w.usedPercentage,
      remainingPercentage: w.remainingPercentage,
      resetsAtEpochMs: w.resetsAtEpochMs,
    })),
    lastUpdatedMs: s.lastUpdatedEpochMs,
  }));

  return {
    totalTokens,
    totalAssistantMessages,
    providers: cards,
    localHistoryWindows: buildLocalHistoryWindowCards(combinedWindows, totalTokens, totalAssistantMessages),
    defaultLocalHistoryWindowId: DEFAULT_LOCAL_HISTORY_WINDOW_ID,
    liveQuotaCards,
    liveQuotaEnabled: status.liveQuotaEnabled,
    lastRefreshedMs: status.lastRefreshedMs,
    localHistoryLastRefreshedMs: status.localHistoryLastRefreshedMs,
    liveQuotaLastRefreshedMs: status.liveQuotaLastRefreshedMs,
    snapshotAggregate,
    sourceModes,
    sourceModeTotals,
    defaultSourceMode,
  };
}

function buildLocalHistoryWindowCards(
  windows: LocalHistoryWindowAggregateMap | undefined,
  totalTokens: number,
  totalAssistantMessages: number,
): DashboardLocalHistoryWindow[] {
  return LOCAL_HISTORY_WINDOW_IDS.map(windowId => {
    const aggregate = windows?.[windowId];
    if (aggregate) {
      return {
        windowId,
        label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
        totalTokens: aggregate.totalTokens,
        totalAssistantMessages: aggregate.totalAssistantMessages,
        totalCacheCreationInputTokens: aggregate.totalCacheCreationInputTokens,
        totalCacheReadInputTokens: aggregate.totalCacheReadInputTokens,
      };
    }

    return {
      windowId,
      label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
      totalTokens: windowId === 'all' ? totalTokens : 0,
      totalAssistantMessages: windowId === 'all' ? totalAssistantMessages : 0,
    };
  });
}

function createEmptyLocalHistoryWindowTotals(): LocalHistoryWindowAggregateMap {
  return {
    today: createEmptyAggregate(),
    last5h: createEmptyAggregate(),
    last7d: createEmptyAggregate(),
    all: createEmptyAggregate(),
  };
}

function mergeDashboardWindowTotals(
  totals: LocalHistoryWindowAggregateMap,
  windows: DashboardLocalHistoryWindow[],
): void {
  for (const window of windows) {
    totals[window.windowId].totalTokens += window.totalTokens;
    totals[window.windowId].totalAssistantMessages += window.totalAssistantMessages;
    totals[window.windowId].totalCacheCreationInputTokens += window.totalCacheCreationInputTokens ?? 0;
    totals[window.windowId].totalCacheReadInputTokens += window.totalCacheReadInputTokens ?? 0;
  }
}

function buildDashboardSnapshotAggregate(
  providers: PromptFuelSnapshotProviderAggregate[],
  snapshotCount: number,
  lastReadMs: number | undefined,
): DashboardSnapshotAggregate {
  let totalTokens = 0;
  let totalAssistantMessages = 0;

  const cards = providers.map(provider => {
    totalTokens += provider.aggregate.totalTokens;
    totalAssistantMessages += provider.aggregate.totalAssistantMessages;
    return buildDashboardSnapshotProviderCard(provider);
  });

  return {
    totalTokens,
    totalAssistantMessages,
    providers: cards,
    sourceLabels: uniqueSnapshotSourceLabels(cards.map(card => card.sourceLabel)),
    snapshotCount,
    lastReadMs,
  };
}

function buildDashboardSnapshotProviderCard(
  provider: PromptFuelSnapshotProviderAggregate,
): DashboardSnapshotProviderCard {
  const sourceLabel = safeSnapshotSourceLabel(provider.sourceLabel);
  return {
    providerId: provider.providerId,
    label: PROVIDER_LABELS[provider.providerId],
    generatedAtMs: provider.generatedAtEpochMs,
    totalTokens: provider.aggregate.totalTokens,
    totalAssistantMessages: provider.aggregate.totalAssistantMessages,
    ...(sourceLabel ? { sourceLabel } : {}),
    windows: buildSnapshotWindowCards(provider.windowTotals, provider.aggregate),
    providedWindowIds: getProvidedSnapshotWindowIds(provider.windowTotals),
    historyPoints: buildSnapshotHistoryPoints(provider),
    modelAggregates: cloneModelUsageAggregates(provider.modelAggregates) ?? [],
    modelWindows: buildSnapshotModelWindowCards(provider),
  };
}

function normalizeDashboardSourceMode(value: DashboardSourceMode): DashboardSourceMode {
  return DASHBOARD_SOURCE_MODES.includes(value) ? value : CONFIG_DEFAULTS.dashboardUsageSource;
}

function safeSnapshotSourceLabel(value: string | undefined): string | undefined {
  return sanitizeSnapshotSourceLabel(value);
}

function buildSnapshotWindowCards(
  windows: Partial<LocalHistoryWindowAggregateMap> | undefined,
  aggregate: AggregateUsage,
): DashboardLocalHistoryWindow[] {
  return LOCAL_HISTORY_WINDOW_IDS.map(windowId => {
    const windowAggregate = windows?.[windowId];
    return {
      windowId,
      label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
      totalTokens: windowAggregate?.totalTokens ?? (windowId === 'all' ? aggregate.totalTokens : 0),
      totalAssistantMessages: windowAggregate?.totalAssistantMessages ?? (windowId === 'all' ? aggregate.totalAssistantMessages : 0),
    };
  });
}

function buildLocalHistoryPoints(
  providerId: ProviderId,
  label: string,
  windows: DashboardLocalHistoryWindow[],
  modelWindows: DashboardModelUsageWindowMap,
): DashboardHistoryPoint[] {
  const today = windows.find(window => window.windowId === 'today');
  if (!today || (today.totalTokens <= 0 && today.totalAssistantMessages <= 0)) {
    return [];
  }
  const dateKey = localDateKey(Date.now());
  const cacheTokens = (today.totalCacheCreationInputTokens ?? 0) + (today.totalCacheReadInputTokens ?? 0);
  return [buildHistoryPoint(
    dateKey,
    providerId,
    label,
    today.totalTokens,
    today.totalAssistantMessages,
    modelWindows.today,
    cacheTokens > 0 ? cacheTokens : undefined,
  )];
}

function buildSnapshotHistoryPoints(
  provider: PromptFuelSnapshotProviderAggregate,
): DashboardHistoryPoint[] {
  const label = PROVIDER_LABELS[provider.providerId];
  const sourceLabel = safeSnapshotSourceLabel(provider.sourceLabel);
  const laneLabel = sourceLabel ? `${label} (${sourceLabel})` : label;
  if (provider.historyBuckets && provider.historyBuckets.length > 0) {
    return provider.historyBuckets.map(bucket => {
      const bucketCache = (bucket.aggregate.totalCacheCreationInputTokens ?? 0) + (bucket.aggregate.totalCacheReadInputTokens ?? 0);
      return buildHistoryPoint(
        bucket.dateKey,
        provider.providerId,
        laneLabel,
        bucket.aggregate.totalTokens,
        bucket.aggregate.totalAssistantMessages,
        toDashboardModelRows('snapshots', 'all', bucket.modelAggregates),
        bucketCache > 0 ? bucketCache : undefined,
      );
    });
  }

  const today = provider.windowTotals?.today;
  if (today && (today.totalTokens > 0 || today.totalAssistantMessages > 0)) {
    const todayCache = (today.totalCacheCreationInputTokens ?? 0) + (today.totalCacheReadInputTokens ?? 0);
    return [buildHistoryPoint(
      localDateKey(provider.generatedAtEpochMs),
      provider.providerId,
      laneLabel,
      today.totalTokens,
      today.totalAssistantMessages,
      toDashboardModelRows('snapshots', 'today', provider.modelWindowTotals?.today),
      todayCache > 0 ? todayCache : undefined,
    )];
  }

  return [];
}

function buildHistoryPoint(
  dateKey: string,
  providerId: ProviderId,
  label: string,
  totalTokens: number,
  totalAssistantMessages: number,
  modelAggregates?: DashboardModelUsageAggregate[],
  totalCacheTokens?: number,
): DashboardHistoryPoint {
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    totalAssistantMessages,
    ...(totalCacheTokens !== undefined ? { totalCacheTokens } : {}),
    providerSegments: [{
      providerId,
      label,
      totalTokens,
      totalAssistantMessages,
    }],
    modelAggregates: cloneDashboardModelUsageAggregates(modelAggregates),
  };
}

function combineHistoryPoints(points: DashboardHistoryPoint[]): DashboardHistoryPoint[] {
  const byDate = new Map<string, DashboardHistoryPoint>();
  for (const point of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.dateKey)) {
      continue;
    }
    const existing = byDate.get(point.dateKey);
    if (!existing) {
      byDate.set(point.dateKey, {
        dateKey: point.dateKey,
        label: point.label || point.dateKey.slice(5),
        totalTokens: point.totalTokens,
        totalAssistantMessages: point.totalAssistantMessages,
        providerSegments: point.providerSegments.map(segment => ({ ...segment })),
        modelAggregates: cloneDashboardModelUsageAggregates(point.modelAggregates),
      });
      continue;
    }
    existing.totalTokens += point.totalTokens;
    existing.totalAssistantMessages += point.totalAssistantMessages;
    existing.totalCacheTokens = (existing.totalCacheTokens ?? 0) + (point.totalCacheTokens ?? 0);
    mergeHistorySegments(existing.providerSegments, point.providerSegments);
    mergeDashboardModelRows(existing.modelAggregates, point.modelAggregates);
  }
  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function mergeHistorySegments(
  target: DashboardHistoryProviderSegment[],
  source: DashboardHistoryProviderSegment[],
): void {
  for (const segment of source) {
    const existing = target.find(candidate =>
      candidate.providerId === segment.providerId &&
      candidate.label === segment.label
    );
    if (existing) {
      existing.totalTokens += segment.totalTokens;
      existing.totalAssistantMessages += segment.totalAssistantMessages;
    } else {
      target.push({ ...segment });
    }
  }
}

function cloneDashboardModelUsageAggregates(
  rows: ReadonlyArray<DashboardModelUsageAggregate> | undefined,
): DashboardModelUsageAggregate[] {
  return (rows ?? []).map(row => ({ ...row, sourceLabels: row.sourceLabels.slice() }));
}

function mergeDashboardModelRows(
  target: DashboardModelUsageAggregate[],
  source: ReadonlyArray<DashboardModelUsageAggregate> | undefined,
): void {
  for (const row of source ?? []) {
    const existing = target.find(candidate =>
      candidate.providerId === row.providerId &&
      candidate.modelLabel.toLowerCase() === row.modelLabel.toLowerCase()
    );
    if (existing) {
      existing.totalTokens += row.totalTokens;
      existing.totalAssistantMessages += row.totalAssistantMessages;
      existing.sourceLabels = uniqueSnapshotSourceLabels([
        ...existing.sourceLabels,
        ...row.sourceLabels,
      ]);
      continue;
    }
    target.push({ ...row, sourceLabels: row.sourceLabels.slice() });
  }
}

function cloneFullModelWindowMap(
  windows: Partial<ModelUsageWindowAggregateMap> | undefined,
  allModels: ReadonlyArray<ModelUsageAggregate> | undefined,
): ModelUsageWindowAggregateMap {
  const cloned = createEmptyModelUsageWindowAggregateMap();
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    cloned[windowId] = sortModelUsageAggregates(cloneModelUsageAggregates(windows?.[windowId]) ?? []);
  }
  if (cloned.all.length === 0 && allModels && allModels.length > 0) {
    cloned.all = sortModelUsageAggregates(cloneModelUsageAggregates(allModels) ?? []);
  }
  return cloned;
}

function buildSnapshotModelWindowCards(
  provider: PromptFuelSnapshotProviderAggregate,
): DashboardModelUsageWindowMap {
  const modelWindows = cloneFullModelWindowMap(provider.modelWindowTotals, provider.modelAggregates);
  return toDashboardModelWindows('snapshots', modelWindows);
}

function createEmptyDashboardModelWindowMap(): DashboardModelUsageWindowMap {
  return {
    today: [],
    last5h: [],
    last7d: [],
    all: [],
  };
}

function toDashboardModelWindows(
  sourceMode: DashboardSourceMode,
  windows: Partial<ModelUsageWindowAggregateMap> | undefined,
): DashboardModelUsageWindowMap {
  const dashboardWindows = createEmptyDashboardModelWindowMap();
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    dashboardWindows[windowId] = sortModelUsageAggregates(windows?.[windowId] ?? [])
      .map(model => toDashboardModelUsage(sourceMode, windowId, model));
  }
  return dashboardWindows;
}

function toDashboardModelUsage(
  sourceMode: DashboardSourceMode,
  windowId: LocalHistoryWindowId,
  model: ModelUsageAggregate,
): DashboardModelUsageAggregate {
  return {
    providerId: model.providerId,
    providerLabel: PROVIDER_LABELS[model.providerId],
    modelLabel: model.modelLabel,
    totalTokens: model.totalTokens,
    totalAssistantMessages: model.totalAssistantMessages,
    sourceMode,
    sourceLabels: uniqueSnapshotSourceLabels(model.sourceLabels ?? []),
    windowId,
  };
}

function toDashboardModelRows(
  sourceMode: DashboardSourceMode,
  windowId: LocalHistoryWindowId,
  models: ReadonlyArray<ModelUsageAggregate> | undefined,
): DashboardModelUsageAggregate[] {
  return sortModelUsageAggregates(models ?? [])
    .map(model => toDashboardModelUsage(sourceMode, windowId, model));
}

function getProvidedSnapshotWindowIds(
  windows: Partial<LocalHistoryWindowAggregateMap> | undefined,
): LocalHistoryWindowId[] {
  const ids = new Set<LocalHistoryWindowId>();
  ids.add('all');
  if (windows) {
    for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
      if (windows[windowId]) {
        ids.add(windowId);
      }
    }
  }
  return LOCAL_HISTORY_WINDOW_IDS.filter(windowId => ids.has(windowId));
}

function buildSourceModeOptions(snapshotsAvailable: boolean): DashboardSourceModeOption[] {
  return DASHBOARD_SOURCE_MODES.map(sourceMode => ({
    sourceMode,
    label: DASHBOARD_SOURCE_MODE_LABELS[sourceMode],
    available: sourceMode !== 'snapshots' || snapshotsAvailable,
  }));
}

function buildSourceModeTotals(
  localProviders: DashboardProviderCard[],
  snapshotAggregate: DashboardSnapshotAggregate,
  localWindows: LocalHistoryWindowAggregateMap,
): DashboardSourceModeTotals[] {
  const snapshotProviders = buildSnapshotSourceProviders(snapshotAggregate.providers);
  const localSourceProviders = buildLocalSourceProviders(localProviders);
  const snapshotWindows = buildCombinedSnapshotWindowTotals(snapshotAggregate.providers);
  const snapshotWindowIds = getSnapshotWindowIds(snapshotAggregate.providers);

  const localTotals = buildSourceTotals(
    'local',
    localSourceProviders,
    buildLocalHistoryWindowCards(localWindows, localWindows.all.totalTokens, localWindows.all.totalAssistantMessages),
    [],
  );

  const snapshotTotals = buildSourceTotals(
    'snapshots',
    snapshotProviders,
    buildLocalHistoryWindowCards(snapshotWindows, snapshotWindows.all.totalTokens, snapshotWindows.all.totalAssistantMessages),
    getMissingSnapshotWindowIds(snapshotWindowIds),
  );

  const combinedProviders = KNOWN_PROVIDERS.map(providerId => {
    const local = localSourceProviders.find(p => p.providerId === providerId);
    const snapshot = snapshotProviders.find(p => p.providerId === providerId);
    return combineSourceProviderCards(providerId, local, snapshot);
  });
  const combinedWindows = combineWindowCards(
    localTotals.windows,
    snapshotTotals.windows,
  );
  const combinedTotals = buildSourceTotals(
    'combined',
    combinedProviders,
    combinedWindows,
    getMissingSnapshotWindowIds(snapshotWindowIds),
  );

  return [localTotals, snapshotTotals, combinedTotals];
}

function buildSourceTotals(
  sourceMode: DashboardSourceMode,
  providers: DashboardSourceModeProviderCard[],
  windows: DashboardLocalHistoryWindow[],
  missingSnapshotWindowIds: LocalHistoryWindowId[],
): DashboardSourceModeTotals {
  return {
    sourceMode,
    label: DASHBOARD_SOURCE_MODE_LABELS[sourceMode],
    totalTokens: windows.find(w => w.windowId === 'all')?.totalTokens ?? 0,
    totalAssistantMessages: windows.find(w => w.windowId === 'all')?.totalAssistantMessages ?? 0,
    providers,
    windows,
    modelWindows: buildModelWindowTotalsForProviders(sourceMode, providers),
    historyPoints: combineHistoryPoints(providers.flatMap(provider => provider.historyPoints)),
    sourceLabels: uniqueSnapshotSourceLabels(providers.flatMap(provider => provider.sourceLabels)),
    missingSnapshotWindowIds,
  };
}

function buildLocalSourceProviders(
  providers: DashboardProviderCard[],
): DashboardSourceModeProviderCard[] {
  return providers
    .filter(provider => isKnownProvider(provider.providerId))
    .map(provider => ({
      providerId: provider.providerId as ProviderId,
      label: provider.label,
      status: provider.status,
      totalTokens: provider.totalTokens,
      totalAssistantMessages: provider.totalAssistantMessages,
      parseErrors: provider.parseErrors,
      sourceLabels: [],
      windows: provider.localHistoryWindows,
      historyPoints: provider.historyPoints,
      modelWindows: toDashboardModelWindows('local', provider.localHistoryModelWindows),
    }));
}

function buildSnapshotSourceProviders(
  providers: DashboardSnapshotProviderCard[],
): DashboardSourceModeProviderCard[] {
  return KNOWN_PROVIDERS.map(providerId => {
    const matching = providers.filter(provider => provider.providerId === providerId);
    const aggregateWindows = createEmptyLocalHistoryWindowTotals();
    let totalTokens = 0;
    let totalAssistantMessages = 0;

    for (const provider of matching) {
      totalTokens += provider.totalTokens;
      totalAssistantMessages += provider.totalAssistantMessages;
      mergeDashboardWindowTotals(aggregateWindows, provider.windows);
    }

    aggregateWindows.all.totalTokens = totalTokens;
    aggregateWindows.all.totalAssistantMessages = totalAssistantMessages;
    const sourceLabels = uniqueSnapshotSourceLabels(matching.map(provider => provider.sourceLabel));

    return {
      providerId,
      label: PROVIDER_LABELS[providerId],
      status: totalTokens > 0 || totalAssistantMessages > 0 ? 'loaded' : 'no-data',
      totalTokens,
      totalAssistantMessages,
      parseErrors: 0,
      sourceLabels,
      windows: buildLocalHistoryWindowCards(aggregateWindows, totalTokens, totalAssistantMessages),
      historyPoints: combineHistoryPoints(matching.flatMap(provider => provider.historyPoints)),
      modelWindows: combineProviderModelWindows('snapshots', matching.map(provider => provider.modelWindows)),
    };
  });
}

function buildCombinedSnapshotWindowTotals(
  providers: DashboardSnapshotProviderCard[],
): LocalHistoryWindowAggregateMap {
  const totals = createEmptyLocalHistoryWindowTotals();
  let allTokens = 0;
  let allMessages = 0;

  for (const provider of providers) {
    allTokens += provider.totalTokens;
    allMessages += provider.totalAssistantMessages;
    mergeDashboardWindowTotals(totals, provider.windows);
  }

  totals.all.totalTokens = allTokens;
  totals.all.totalAssistantMessages = allMessages;
  return totals;
}

function getSnapshotWindowIds(
  providers: DashboardSnapshotProviderCard[],
): Set<LocalHistoryWindowId> {
  const ids = new Set<LocalHistoryWindowId>();
  for (const provider of providers) {
    for (const windowId of provider.providedWindowIds) {
      ids.add(windowId);
    }
  }
  return ids;
}

function getMissingSnapshotWindowIds(
  snapshotWindowIds: Set<LocalHistoryWindowId>,
): LocalHistoryWindowId[] {
  return LOCAL_HISTORY_WINDOW_IDS.filter(windowId => windowId !== 'all' && !snapshotWindowIds.has(windowId));
}

function combineSourceProviderCards(
  providerId: ProviderId,
  local: DashboardSourceModeProviderCard | undefined,
  snapshot: DashboardSourceModeProviderCard | undefined,
): DashboardSourceModeProviderCard {
  const localWindows = local?.windows ?? buildLocalHistoryWindowCards(undefined, 0, 0);
  const snapshotWindows = snapshot?.windows ?? buildLocalHistoryWindowCards(undefined, 0, 0);
  const windows = combineWindowCards(localWindows, snapshotWindows);
  const modelWindows = combineProviderModelWindows('combined', [
    local?.modelWindows,
    snapshot?.modelWindows,
  ]);
  const totalTokens = (local?.totalTokens ?? 0) + (snapshot?.totalTokens ?? 0);
  const totalAssistantMessages = (local?.totalAssistantMessages ?? 0) + (snapshot?.totalAssistantMessages ?? 0);

  return {
    providerId,
    label: PROVIDER_LABELS[providerId],
    status: totalTokens > 0 || totalAssistantMessages > 0 ? 'loaded' : (local?.status ?? 'no-data'),
    totalTokens,
    totalAssistantMessages,
    parseErrors: local?.parseErrors ?? 0,
    sourceLabels: uniqueSnapshotSourceLabels(snapshot?.sourceLabels ?? []),
    windows,
    historyPoints: combineHistoryPoints([
      ...(local?.historyPoints ?? []),
      ...(snapshot?.historyPoints ?? []),
    ]),
    modelWindows,
  };
}

function combineWindowCards(
  left: DashboardLocalHistoryWindow[],
  right: DashboardLocalHistoryWindow[],
): DashboardLocalHistoryWindow[] {
  return LOCAL_HISTORY_WINDOW_IDS.map(windowId => {
    const leftWindow = left.find(w => w.windowId === windowId);
    const rightWindow = right.find(w => w.windowId === windowId);
    return {
      windowId,
      label: LOCAL_HISTORY_WINDOW_LABELS[windowId],
      totalTokens: (leftWindow?.totalTokens ?? 0) + (rightWindow?.totalTokens ?? 0),
      totalAssistantMessages: (leftWindow?.totalAssistantMessages ?? 0) + (rightWindow?.totalAssistantMessages ?? 0),
      totalCacheCreationInputTokens: (leftWindow?.totalCacheCreationInputTokens ?? 0) + (rightWindow?.totalCacheCreationInputTokens ?? 0),
      totalCacheReadInputTokens: (leftWindow?.totalCacheReadInputTokens ?? 0) + (rightWindow?.totalCacheReadInputTokens ?? 0),
    };
  });
}

function buildModelWindowTotalsForProviders(
  sourceMode: DashboardSourceMode,
  providers: DashboardSourceModeProviderCard[],
): DashboardModelUsageWindowMap {
  return combineProviderModelWindows(sourceMode, providers.map(provider => provider.modelWindows));
}

function combineProviderModelWindows(
  sourceMode: DashboardSourceMode,
  windowsList: Array<DashboardModelUsageWindowMap | undefined>,
): DashboardModelUsageWindowMap {
  const combined = createEmptyDashboardModelWindowMap();
  for (const windowId of LOCAL_HISTORY_WINDOW_IDS) {
    const merged: ModelUsageAggregate[] = [];
    for (const windows of windowsList) {
      for (const model of windows?.[windowId] ?? []) {
        mergeModelUsageAggregate(merged, {
          providerId: model.providerId,
          modelLabel: model.modelLabel,
          totalTokens: model.totalTokens,
          totalAssistantMessages: model.totalAssistantMessages,
          source: sourceMode === 'snapshots' ? 'snapshot' : sourceMode,
          sourceLabels: model.sourceLabels,
          windowId,
        });
      }
    }
    combined[windowId] = sortModelUsageAggregates(merged)
      .map(model => toDashboardModelUsage(sourceMode, windowId, model));
  }
  return combined;
}

function localDateKey(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
