import type { ClaudeUsageHistory } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory } from '../../providers/codexCorrelatedDayBucketScanner';
import { displayTotalTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardHistoryChart, UsageDashboardHistoryChartRange, UsageDashboardHistoryChartPoint, UsageDashboardMetricCard, UsageDashboardSourceInfo } from '../usageDashboardModel';
import type { UsageHistoryPoint, UsageHistoryRangeKey, UsageHistoryRangeView, UsageHistoryRangeViews } from '../usageHistoryBinning';
import { buildUsageHistoryRangeViews } from '../usageHistoryBinning';
import { sourceInfo, shortenClaudeModel, shortenCodexModel, mapModelUsageToHistory, normalizeRemoteHistoryPointModels } from './format';
import { buildApiEquivalentEstimateResult, type ApiEquivalentEstimateContribution } from './apiEstimate';

function buildHistoryRanges(hasData: boolean): UsageDashboardHistoryChartRange[] {
  return [
    { key: '1D', label: '1D', available: hasData, active: false },
    { key: '1W', label: '1W', available: hasData, active: false },
    { key: '1M', label: '1M', available: hasData, active: true },
    { key: '1Y', label: '1Y', available: hasData, active: false },
    { key: 'ALL', label: 'ALL', available: hasData, active: false }
  ];
}

function remoteSourceDisplayLabel(remoteMachineLabels?: string[], aliasMap?: Record<string, string>): string {
  const aliases = Array.from(new Set(remoteMachineLabels ?? []))
    .map(machineLabel => aliasMap?.[machineLabel]?.trim())
    .filter((alias): alias is string => Boolean(alias));
  if (aliases.length === 1) {
    return aliases[0];
  }
  if (aliases.length > 1) {
    return aliases.slice(0, 2).join(', ');
  }
  return 'Snapshot';
}

type HistoryEstimateProvider = 'claude' | 'codex';

interface HistoryProviderRangeSummary {
  contribution: ApiEquivalentEstimateContribution;
}

function isFiniteNonNegative(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safeHistorySourceDescription(sourceKinds: Set<'local' | 'snapshot'>): string {
  if (sourceKinds.has('local') && sourceKinds.has('snapshot')) {
    return 'local and snapshot history';
  }
  if (sourceKinds.has('snapshot')) {
    return 'snapshot history';
  }
  if (sourceKinds.has('local')) {
    return 'local history';
  }
  return 'history';
}

function historyProviderRangeSummary(
  points: UsageHistoryPoint[],
  provider: HistoryEstimateProvider,
  label: 'Claude' | 'Codex',
  assumeProvider: boolean
): HistoryProviderRangeSummary {
  let totalTokens = 0;
  let assistantMessages = 0;
  let malformedTotals = false;
  const models: UsageHistoryPoint['models'] = [];
  const sourceKinds = new Set<'local' | 'snapshot'>();

  for (const point of points) {
    const segment = assumeProvider
      ? undefined
      : point.providerSegments?.find(candidate => candidate.provider === provider);
    if (!assumeProvider && !segment) {
      continue;
    }

    const pointTotalTokens = assumeProvider ? point.totalTokens : segment!.totalTokens;
    const pointMessages = assumeProvider ? point.assistantMessages : segment!.assistantMessages;
    if (!isFiniteNonNegative(pointTotalTokens) || !isFiniteNonNegative(pointMessages)) {
      malformedTotals = true;
    } else {
      totalTokens += pointTotalTokens;
      assistantMessages += pointMessages;
    }

    for (const sourceKind of point.sourceKinds ?? []) {
      sourceKinds.add(sourceKind);
    }

    models.push(...(point.models ?? []).filter(model => assumeProvider || model.provider === provider));
  }

  const active = totalTokens > 0 || assistantMessages > 0;
  if (!active) {
    return { contribution: { label, active: false } };
  }

  const sourceDescription = safeHistorySourceDescription(sourceKinds);
  const relevantModels = models.filter(model => isFiniteNonNegative(model.totalTokens) && model.totalTokens > 0);
  const modelTokenTotal = relevantModels.reduce((sum, model) => sum + model.totalTokens, 0);
  const modelRowsValid = relevantModels.length > 0 && relevantModels.every(model =>
    isFiniteNonNegative(model.apiEquivalentCostUsd) && !model.apiEquivalentCostUnavailableReason
  );

  if (malformedTotals || modelTokenTotal < totalTokens || !modelRowsValid) {
    return {
      contribution: {
        label,
        active: true,
        unavailableReason: `${sourceDescription} model/token data unavailable`
      }
    };
  }

  const costUsd = relevantModels.reduce((sum, model) => sum + model.apiEquivalentCostUsd!, 0);
  if (!Number.isFinite(costUsd)) {
    return {
      contribution: {
        label,
        active: true,
        unavailableReason: `${sourceDescription} model/token data unavailable`
      }
    };
  }

  return {
    contribution: {
      label,
      active: true,
      costUsd,
      fallbackPricingUsed: relevantModels.some(model => !model.pricingMatchedModel)
    }
  };
}
function historyApiEstimateSource(label: string, detail: string): UsageDashboardSourceInfo {
  return sourceInfo('apiEquivalentEstimate', label, detail);
}

function rangeApiEquivalentLabel(rangeKey: UsageHistoryRangeKey): string {
  return `${rangeKey} API-equivalent`;
}

function buildProviderRangeApiEquivalentCard(
  view: UsageHistoryRangeView,
  provider: HistoryEstimateProvider,
  providerLabel: 'Claude' | 'Codex',
  key: string
): UsageDashboardMetricCard {
  const estimate = buildApiEquivalentEstimateResult(
    [historyProviderRangeSummary(view.points, provider, providerLabel, true).contribution],
    {
      label: `${providerLabel} ${rangeApiEquivalentLabel(view.key)}`,
      unavailableDetail: 'No token data to estimate API-equivalent cost',
      unavailableReason: 'selected-range model token totals must cover all tokens',
      includeContributionDetailLines: true
    }
  );
  return {
    key,
    label: rangeApiEquivalentLabel(view.key),
    value: estimate.value,
    ...(estimate.costUsd !== undefined ? { apiEquivalentCostUsd: estimate.costUsd } : {}),
    ...(estimate.available ? { apiEquivalentFallbackPricingUsed: estimate.fallbackPricingUsed } : {}),
    detail: estimate.detail,
    ...(estimate.detailLines ? { detailLines: estimate.detailLines } : {}),
    detailTooltip: estimate.detailTooltip,
    available: estimate.available,
    source: historyApiEstimateSource(
      `${providerLabel} history API-equivalent estimate`,
      'Estimate from selected-range per-model token counts and published model pricing; not actual billing.'
    )
  };
}
function buildCombinedRangeApiEquivalentCard(view: UsageHistoryRangeView): UsageDashboardMetricCard {
  const estimate = buildApiEquivalentEstimateResult(
    [
      historyProviderRangeSummary(view.points, 'claude', 'Claude', false).contribution,
      historyProviderRangeSummary(view.points, 'codex', 'Codex', false).contribution
    ],
    {
      label: rangeApiEquivalentLabel(view.key),
      unavailableDetail: view.activeBinCount > 0 ? 'Provider estimates unavailable' : 'Range estimate unavailable',
      unavailableReason: 'no token data is available',
      includeContributionDetailLines: true
    }
  );
  return {
    key: 'combinedHistoryApiEquivalent',
    label: rangeApiEquivalentLabel(view.key),
    value: estimate.value,
    ...(estimate.costUsd !== undefined ? { apiEquivalentCostUsd: estimate.costUsd } : {}),
    ...(estimate.available ? { apiEquivalentFallbackPricingUsed: estimate.fallbackPricingUsed } : {}),
    detail: estimate.detail,
    ...(estimate.detailLines ? { detailLines: estimate.detailLines } : {}),
    detailTooltip: estimate.detailTooltip,
    available: estimate.available,
    source: historyApiEstimateSource(
      'Combined API-equivalent estimate',
      'Combined from selected-range provider API-equivalent estimates when available.'
    )
  };
}

function buildHistoryRangeViewsWithApiEquivalent(
  points: UsageHistoryPoint[],
  kind: 'claude' | 'codex' | 'combined'
): UsageHistoryRangeViews {
  const views = buildUsageHistoryRangeViews(points);
  for (const key of ['1D', '1W', '1M', '1Y', 'ALL'] as UsageHistoryRangeKey[]) {
    const view = views[key];
    view.apiEquivalentCard = kind === 'combined'
      ? buildCombinedRangeApiEquivalentCard(view)
      : buildProviderRangeApiEquivalentCard(
        view,
        kind,
        kind === 'claude' ? 'Claude' : 'Codex',
        kind === 'claude' ? 'historyApiEquivalent' : 'codexHistoryApiEquivalent'
      );
  }
  return views;
}

export function buildClaudeHistoryChart(
  claudeUsageHistory: ClaudeUsageHistory | undefined,
  remoteHistoryPoints?: UsageHistoryPoint[],
  aliasMap?: Record<string, string>,
  remoteMachineLabels?: string[],
  providerLabel = 'Claude'
): UsageDashboardHistoryChart {
  const hasRemote = Boolean(remoteHistoryPoints?.length);
  const localAvailable = Boolean(claudeUsageHistory?.available);

  const source = localAvailable && hasRemote
    ? sourceInfo('mixedDayBucket', 'Claude history buckets — merged', 'Local day-buckets merged with snapshot history.')
    : localAvailable
      ? sourceInfo('trustedCompletedTurnUsage', 'Claude assistant-message JSONL history buckets', 'Completed Claude assistant records with message.usage only')
      : hasRemote
        ? sourceInfo('snapshotOnly', 'Snapshot history buckets', 'Aggregated from selected imported snapshots only.')
        : sourceInfo('unavailable', 'Claude assistant-message history unavailable', undefined, claudeUsageHistory?.error ?? 'No trusted completed-turn history is available yet.');

  const ranges = buildHistoryRanges(localAvailable || hasRemote);

  if (!localAvailable && !hasRemote) {
    return {
      available: false,
      title: 'Token trend',
      rangeLabel: '1M / 30d',
      unavailableReason: source.unavailableReason,
      ranges,
      points: [],
      maxTotalTokens: 0,
      source
    };
  }

  const localPoints: UsageDashboardHistoryChartPoint[] = localAvailable
    ? claudeUsageHistory!.days.map(day => ({
      dateKey: day.dateKey,
      label: day.dateKey.slice(5),
      totalTokens: displayTotalTokens(day),
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheTokens: day.cacheCreationInputTokens + day.cacheReadInputTokens,
      cacheCreationTokens: day.cacheCreationInputTokens,
      cacheReadTokens: day.cacheReadInputTokens,
      assistantMessages: day.assistantMessages,
      models: mapModelUsageToHistory(day.modelUsage, shortenClaudeModel, 'claude', providerLabel),
      source: 'local' as const,
      sourceLabel: 'Local'
    }))
    : [];

  const remotePoints = hasRemote
    ? normalizeRemoteHistoryPointModels(remoteHistoryPoints!, shortenClaudeModel, 'claude', providerLabel).map(p => ({
      ...p,
      source: 'remote' as const,
      sourceLabel: remoteSourceDisplayLabel(remoteMachineLabels, aliasMap)
    }))
    : [];
  const points: UsageDashboardHistoryChartPoint[] = hasRemote
    ? [...localPoints, ...remotePoints]
    : localPoints;

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    providerLabel,
    unavailableReason: points.length > 0 ? undefined : 'No Claude history buckets are available for the selected range.',
    ranges,
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildHistoryRangeViewsWithApiEquivalent(points, 'claude'),

    source
  };
}
export function buildCodexHistoryChart(
  codexCorrelatedHistory: CodexCorrelatedHistory | undefined,
  remoteHistoryPoints?: UsageHistoryPoint[],
  aliasMap?: Record<string, string>,
  remoteMachineLabels?: string[],
  providerLabel = 'Codex'
): UsageDashboardHistoryChart {
  const hasRemote = Boolean(remoteHistoryPoints?.length);
  const localAvailable = Boolean(codexCorrelatedHistory?.available);

  const source = localAvailable && hasRemote
    ? sourceInfo('mixedDayBucket', 'Codex history buckets — merged', 'Local correlated day-buckets merged with snapshot history.')
    : localAvailable
      ? sourceInfo('correlatedDayBucket', 'Codex correlated day-bucket history', 'Correlated from ordered Codex JSONL event logs; not Claude-equivalent completed-turn records.')
      : hasRemote
        ? sourceInfo('snapshotOnly', 'Codex snapshot history buckets', 'Aggregated from selected imported Codex snapshots only.')
        : sourceInfo('unavailable', 'Codex correlated day-bucket history unavailable', undefined, codexCorrelatedHistory?.error ?? 'No Codex correlated usage data is available yet.');

  const ranges = buildHistoryRanges(localAvailable || hasRemote);

  if (!localAvailable && !hasRemote) {
    return {
      available: false,
      title: 'Token trend',
      rangeLabel: '1M / 30d',
      unavailableReason: source.unavailableReason,
      ranges,
      points: [],
      maxTotalTokens: 0,
      source
    };
  }

  const localPoints: UsageDashboardHistoryChartPoint[] = localAvailable
    ? codexCorrelatedHistory!.days.map(day => ({
      dateKey: day.dateKey,
      label: day.dateKey.slice(5),
      totalTokens: displayTotalTokens(day),
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheTokens: day.cacheCreationInputTokens + day.cacheReadInputTokens,
      cacheCreationTokens: day.cacheCreationInputTokens,
      cacheReadTokens: day.cacheReadInputTokens,
      assistantMessages: day.correlatedTurns,
      models: mapModelUsageToHistory(day.modelUsage, shortenCodexModel, 'codex', providerLabel),
      source: 'local' as const,
      sourceLabel: 'Local'
    }))
    : [];

  const remotePoints = hasRemote
    ? normalizeRemoteHistoryPointModels(remoteHistoryPoints!, shortenCodexModel, 'codex', providerLabel).map(p => ({
      ...p,
      source: 'remote' as const,
      sourceLabel: remoteSourceDisplayLabel(remoteMachineLabels, aliasMap)
    }))
    : [];
  const points: UsageDashboardHistoryChartPoint[] = hasRemote
    ? [...localPoints, ...remotePoints]
    : localPoints;

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    providerLabel,
    unavailableReason: points.length > 0 ? undefined : 'No Codex correlated usage records for the selected range.',
    ranges,
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildHistoryRangeViewsWithApiEquivalent(points, 'codex'),

    source
  };
}

function hasAvailableHistoryChart(chart: UsageDashboardHistoryChart | undefined): boolean {
  return Boolean(chart?.available && chart.points?.length);
}

function historyProviderPoints(
  chart: UsageDashboardHistoryChart,
  provider: 'claude' | 'codex',
  label: string,
  sourceConfidence: string
): UsageDashboardHistoryChartPoint[] {
  return (chart.points || []).map(point => ({
    ...point,
    models: (point.models || []).map(model => ({
      ...model,
      label: model.label || model.model || 'model',
      model: model.model || model.label || 'model',
      pricingModel: model.pricingModel || model.model || model.label || 'model',
      provider,
      providerLabel: label
    })),
    providerSegments: [{
      provider,
      label,
      totalTokens: point.totalTokens,
      inputTokens: point.inputTokens,
      outputTokens: point.outputTokens,
      cacheTokens: point.cacheTokens,
      cacheCreationTokens: point.cacheCreationTokens,
      cacheReadTokens: point.cacheReadTokens,
      assistantMessages: point.assistantMessages,
      sourceConfidence: sourceConfidence as any
    }]
  }));
}

export function buildCombinedHistoryChart(
  claudeChart: UsageDashboardHistoryChart | undefined,
  codexChart: UsageDashboardHistoryChart | undefined
): UsageDashboardHistoryChart | undefined {
  if (!hasAvailableHistoryChart(claudeChart) || !hasAvailableHistoryChart(codexChart)) {
    return undefined;
  }

  const source = sourceInfo(
    'mixedDayBucket',
    'Mixed Claude trusted and Codex correlated history',
    'Claude uses trusted completed-turn buckets; Codex remains correlated day-bucket data and is not upgraded.'
  );
  const claudeLabel = claudeChart?.providerLabel || 'Claude';
  const codexLabel = codexChart?.providerLabel || 'Codex';
  const points = [
    ...historyProviderPoints(claudeChart!, 'claude', claudeLabel, 'trustedCompletedTurnUsage'),
    ...historyProviderPoints(codexChart!, 'codex', codexLabel, 'correlatedDayBucket')
  ];

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    unavailableReason: points.length > 0 ? undefined : 'Both Claude and Codex history are required for Combined view.',
    ranges: buildHistoryRanges(points.length > 0),
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildHistoryRangeViewsWithApiEquivalent(points, 'combined'),

    ariaLabel: 'Combined token trend chart. Claude segments are solid; Codex segments are hatched correlated data.',
    source
  };
}
