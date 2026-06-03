import type { ClaudeUsageHistory } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory } from '../../providers/codexCorrelatedDayBucketScanner';
import { estimateAggregateCostUsd } from '../../providers/pricing';
import type { RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardHistoryChart, UsageDashboardHistoryChartRange, UsageDashboardHistoryChartPoint, UsageDashboardMetricCard } from '../usageDashboardModel';
import type { UsageHistoryPoint } from '../usageHistoryBinning';
import { buildUsageHistoryRangeViews } from '../usageHistoryBinning';
import { sourceInfo, formatCount, formatUsd, shortenClaudeModel, shortenCodexModel, mapModelUsageToHistory, normalizeRemoteHistoryPointModels, buildHistoryUnavailableCard, buildCodexHistoryUnavailableCard, remoteModelEntriesToCostRows } from './format';

function buildHistoryRanges(hasData: boolean): UsageDashboardHistoryChartRange[] {
  return [
    { key: '1D', label: '1D', available: false, active: false },
    { key: '1W', label: '1W', available: hasData, active: false },
    { key: '1M', label: '1M', available: hasData, active: true },
    { key: '1Y', label: '1Y', available: hasData, active: false },
    { key: 'ALL', label: 'ALL', available: hasData, active: false }
  ];
}

export function buildClaudeHistoryChart(claudeUsageHistory: ClaudeUsageHistory | undefined, remoteHistoryPoints?: UsageHistoryPoint[]): UsageDashboardHistoryChart {
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
      models: mapModelUsageToHistory(day.modelUsage, shortenClaudeModel)
    }))
    : [];

  const remotePoints = hasRemote
    ? normalizeRemoteHistoryPointModels(remoteHistoryPoints!, shortenClaudeModel)
    : [];
  const points: UsageDashboardHistoryChartPoint[] = hasRemote
    ? [...localPoints, ...remotePoints]
    : localPoints;

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    unavailableReason: points.length > 0 ? undefined : 'No Claude history buckets are available for the selected range.',
    ranges,
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildUsageHistoryRangeViews(points),
    source
  };
}

export function buildCodexHistoryChart(codexCorrelatedHistory: CodexCorrelatedHistory | undefined, remoteHistoryPoints?: UsageHistoryPoint[]): UsageDashboardHistoryChart {
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
      models: mapModelUsageToHistory(day.modelUsage, shortenCodexModel)
    }))
    : [];

  const remotePoints = hasRemote
    ? normalizeRemoteHistoryPointModels(remoteHistoryPoints!, shortenCodexModel)
    : [];
  const points: UsageDashboardHistoryChartPoint[] = hasRemote
    ? [...localPoints, ...remotePoints]
    : localPoints;

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    unavailableReason: points.length > 0 ? undefined : 'No Codex correlated usage records for the selected range.',
    ranges,
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildUsageHistoryRangeViews(points),
    source
  };
}

function hasUsableHistoryChart(chart: UsageDashboardHistoryChart | undefined): boolean {
  return Boolean(chart?.available && chart.points?.some(point => Number(point.totalTokens || 0) > 0 || Number(point.assistantMessages || 0) > 0));
}

function historyProviderPoints(
  chart: UsageDashboardHistoryChart,
  provider: 'claude' | 'codex',
  label: 'Claude' | 'Codex',
  sourceConfidence: string
): UsageDashboardHistoryChartPoint[] {
  return (chart.points || []).map(point => ({
    ...point,
    models: (point.models || []).map(model => ({
      ...model,
      label: `${label} · ${model.label || model.model || 'model'}`,
      model: `${label} · ${model.model || model.label || 'model'}`,
      pricingModel: model.pricingModel || model.model || model.label || 'model'
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
  if (!hasUsableHistoryChart(claudeChart) || !hasUsableHistoryChart(codexChart)) {
    return undefined;
  }

  const source = sourceInfo(
    'mixedDayBucket',
    'Mixed Claude trusted and Codex correlated history',
    'Claude uses trusted completed-turn buckets; Codex remains correlated day-bucket data and is not upgraded.'
  );
  const points = [
    ...historyProviderPoints(claudeChart!, 'claude', 'Claude', 'trustedCompletedTurnUsage'),
    ...historyProviderPoints(codexChart!, 'codex', 'Codex', 'correlatedDayBucket')
  ];

  return {
    available: points.length > 0,
    title: 'Token trend',
    rangeLabel: '1M / 30d',
    unavailableReason: points.length > 0 ? undefined : 'Both Claude and Codex history are required for Combined view.',
    ranges: buildHistoryRanges(points.length > 0),
    points,
    maxTotalTokens: points.reduce((max, point) => Math.max(max, point.totalTokens), 0),
    rangeViews: buildUsageHistoryRangeViews(points),
    ariaLabel: 'Combined token trend chart. Claude segments are solid; Codex segments are hatched correlated data.',
    source
  };
}

export function buildHistoryCards(claudeUsageHistory: ClaudeUsageHistory | undefined, remoteModelEntries?: RemoteModelEntry[]): UsageDashboardMetricCard[] {
  const source = claudeUsageHistory?.available
    ? sourceInfo(
      'trustedCompletedTurnUsage',
      'Claude assistant-message JSONL history buckets',
      'Completed Claude assistant records with message.usage only'
    )
    : sourceInfo(
      'unavailable',
      'Claude assistant-message history unavailable',
      undefined,
      claudeUsageHistory?.error ?? 'No trusted completed-turn history is available yet.'
    );

  if (!claudeUsageHistory?.available) {
    return [
      buildHistoryUnavailableCard('historyActivity', '30d Messages/Turns', source),
      buildHistoryUnavailableCard('historyTokens', '30d tokens', source),
      buildHistoryUnavailableCard('historyInputOutput', '30d Input / Output', source),
      buildHistoryUnavailableCard('historyCache', '30d cache', source),
      buildHistoryUnavailableCard('historyApiEquivalent', '30d API-equivalent', source),
      buildHistoryUnavailableCard('historyRange', '30d history', source)
    ];
  }

  const cacheTokens = claudeUsageHistory.cacheCreationInputTokens + claudeUsageHistory.cacheReadInputTokens;
  const claudeHistoryTotal = displayTotalTokens(claudeUsageHistory);

  const historyApiEstimate = estimateAggregateCostUsd(
    [
      ...claudeUsageHistory.modelUsage.map(m => ({
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheCreationInputTokens: m.cacheCreationInputTokens,
        cacheReadInputTokens: m.cacheReadInputTokens
      })),
      ...(remoteModelEntriesToCostRows(remoteModelEntries) ?? [])
    ],
    true
  );
  const historyApiAvailable = !remoteModelEntries?.length || remoteModelEntriesToCostRows(remoteModelEntries) !== undefined;

  return [
    {
      key: 'historyActivity',
      label: '30d Messages/Turns',
      value: formatCount(claudeUsageHistory.assistantMessages),
      detail: '',
      available: true,
      source
    },
    {
      key: 'historyTokens',
      label: '30d tokens',
      value: formatCount(claudeHistoryTotal),
      detail: '',
      available: true,
      source
    },
    {
      key: 'historyInputOutput',
      label: '30d Input / Output',
      value: `${formatCount(claudeUsageHistory.inputTokens)} / ${formatCount(claudeUsageHistory.outputTokens)}`,
      detail: '',
      available: true,
      source
    },
    {
      key: 'historyCache',
      label: '30d cache',
      value: formatCount(cacheTokens),
      detail: '',
      available: true,
      source
    },
    {
      key: 'historyApiEquivalent',
      label: '30d API-equivalent',
      value: historyApiAvailable ? formatUsd(historyApiEstimate.costUsd) : 'Unavailable',
      detail: !historyApiAvailable
        ? 'Estimate unavailable · some snapshot rows lack model/token components'
        : historyApiEstimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: !historyApiAvailable
        ? 'API-equivalent is hidden unless all snapshot rows carry model and token component data.'
        : historyApiEstimate.fallbackCount > 0
        ? `Estimated Claude API-equivalent cost from per-model history (${historyApiEstimate.fallbackCount}/${historyApiEstimate.totalCount} models used fallback pricing). Not actual billing.`
        : 'Estimated Claude API-equivalent cost from per-model history; not actual billing',
      available: historyApiAvailable,
      source
    },
    {
      key: 'historyRange',
      label: '30d history',
      value: `${claudeUsageHistory.activeDays} active days`,
      detail: claudeUsageHistory.rangeLabel,
      available: true,
      source
    }
  ];
}

export function buildCodexHistoryCards(codexCorrelatedHistory: CodexCorrelatedHistory | undefined, remoteModelEntries?: RemoteModelEntry[]): UsageDashboardMetricCard[] {
  const source = codexCorrelatedHistory?.available
    ? sourceInfo(
      'correlatedDayBucket',
      'Codex correlated day-bucket history',
      'Correlated from ordered Codex JSONL event logs; not Claude-equivalent completed-turn records.'
    )
    : sourceInfo(
      'unavailable',
      'Codex correlated day-bucket history unavailable',
      undefined,
      codexCorrelatedHistory?.error ?? 'No Codex correlated usage data is available yet.'
    );

  if (!codexCorrelatedHistory?.available) {
    return [
      buildCodexHistoryUnavailableCard('codexHistoryActivity', '1M Messages/Turns', source),
      buildCodexHistoryUnavailableCard('codexHistoryTokens', '1M tokens', source),
      buildCodexHistoryUnavailableCard('codexHistoryInputOutput', '1M Input / Output', source),
      buildCodexHistoryUnavailableCard('codexHistoryCache', '1M cache', source),
      buildCodexHistoryUnavailableCard('codexHistoryApiEquivalent', '1M API-equivalent', source),
      buildCodexHistoryUnavailableCard('codexHistoryRange', '1M history', source)
    ];
  }

  const cacheTokens = codexCorrelatedHistory.cacheCreationInputTokens + codexCorrelatedHistory.cacheReadInputTokens;
  const codexHistoryTotal = displayTotalTokens(codexCorrelatedHistory);

  const codexHistoryApiEstimate = estimateAggregateCostUsd(
    [
      ...codexCorrelatedHistory.modelUsage.map(m => ({
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheCreationInputTokens: m.cacheCreationInputTokens,
      cacheReadInputTokens: m.cacheReadInputTokens
      })),
      ...(remoteModelEntriesToCostRows(remoteModelEntries) ?? [])
    ],
    false
  );
  const codexHistoryApiAvailable = !remoteModelEntries?.length || remoteModelEntriesToCostRows(remoteModelEntries) !== undefined;

  return [
    {
      key: 'codexHistoryActivity',
      label: '1M Messages/Turns',
      value: formatCount(codexCorrelatedHistory.assistantMessages),
      detail: '',
      available: true,
      source
    },
    {
      key: 'codexHistoryTokens',
      label: '1M tokens',
      value: formatCount(codexHistoryTotal),
      detail: '',
      available: true,
      source
    },
    {
      key: 'codexHistoryInputOutput',
      label: '1M Input / Output',
      value: `${formatCount(codexCorrelatedHistory.inputTokens)} / ${formatCount(codexCorrelatedHistory.outputTokens)}`,
      detail: '',
      available: true,
      source
    },
    {
      key: 'codexHistoryCache',
      label: '1M cache',
      value: formatCount(cacheTokens),
      detail: '',
      available: true,
      source
    },
    {
      key: 'codexHistoryApiEquivalent',
      label: '1M API-equivalent',
      value: codexHistoryApiAvailable ? formatUsd(codexHistoryApiEstimate.costUsd) : 'Unavailable',
      detail: !codexHistoryApiAvailable
        ? 'Estimate unavailable · some snapshot rows lack model/token components'
        : codexHistoryApiEstimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: !codexHistoryApiAvailable
        ? 'API-equivalent is hidden unless all snapshot rows carry model and token component data.'
        : codexHistoryApiEstimate.fallbackCount > 0
        ? `Estimated Codex API-equivalent cost from per-model history (${codexHistoryApiEstimate.fallbackCount}/${codexHistoryApiEstimate.totalCount} models used fallback pricing). Not actual billing.`
        : 'Estimated Codex API-equivalent cost from per-model history; not actual billing',
      available: codexHistoryApiAvailable,
      source
    },
    {
      key: 'codexHistoryRange',
      label: '1M history',
      value: `${codexCorrelatedHistory.activeDays} active days`,
      detail: codexCorrelatedHistory.rangeLabel,
      available: true,
      source
    }
  ];
}
