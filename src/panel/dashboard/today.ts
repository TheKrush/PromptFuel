import type { ClaudeTodayUsageBucket } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../../providers/codexCorrelatedDayBucketScanner';
import { estimateAggregateCostUsd } from '../../providers/pricing';
import { sumCostIfComplete } from '../../display/apiEquivalentCost';
import type { RemoteSourceTodaySummary, RemoteUsageProjection, RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens, sumTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardMetricCard, UsageDashboardToday, UsageDashboardSourceInfo, UsageDashboardHistoryChart } from '../usageDashboardModel';
import type { UsageHistoryPoint } from '../usageHistoryBinning';
import { formatCount, formatUsd, sourceInfo, buildUnavailableMetricCard } from './format';

interface OverviewTodayPart {
  label: 'Claude' | 'Codex';
  assistantMessages?: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  apiCostUsd?: number;
  apiFallbackPricingUsed?: boolean;
  hasApiEstimateInput: boolean;
}

interface ApiEstimateTooltipOptions {
  label: string;
  fallbackPricingUsed?: boolean;
  unavailableReason?: string;
}

function formatApiEstimateTooltip(options: ApiEstimateTooltipOptions): string {
  const prefix = `${options.label} estimate`;
  if (options.unavailableReason) {
    return `${prefix} unavailable: ${options.unavailableReason}. Not actual billing.`;
  }
  return `${prefix}; ${options.fallbackPricingUsed ? 'fallback pricing used; ' : ''}not actual billing.`;
}

function buildRemoteSourceNote(remote: RemoteSourceTodaySummary): string {
  const sourceNote = remote.sourceCount === 1 ? '1 source' : `${remote.sourceCount} sources`;
  const uniqueLabels = [...new Set(remote.machineLabels)];
  if (uniqueLabels.length === 1) {
    return `${uniqueLabels[0]} snapshot: ${sourceNote}`;
  }
  if (uniqueLabels.length > 1) {
    return `${uniqueLabels.slice(0, 2).join(', ')} snapshot: ${sourceNote}`;
  }
  return `snapshot: ${sourceNote}`;
}

function estimateTodayApiEquivalent(
  usage: ClaudeTodayUsageBucket | CodexCorrelatedDayBucket,
  isClaude: boolean,
  providerLabel: 'Claude' | 'Codex'
): { available: true; costUsd: number; fallbackPricingUsed: boolean; detail: string; detailTooltip?: string } | { available: false; detail: string; detailTooltip?: string } {
  const modelUsage = usage.modelUsage ?? [];
  if (modelUsage.length > 0) {
    const estimate = estimateAggregateCostUsd(modelUsage.map(model => ({
      model: model.model,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cacheCreationInputTokens: model.cacheCreationInputTokens,
      cacheReadInputTokens: model.cacheReadInputTokens
    })), isClaude);

    return {
      available: true,
      costUsd: estimate.costUsd,
      fallbackPricingUsed: estimate.fallbackCount > 0,
      detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, fallbackPricingUsed: estimate.fallbackCount > 0 })
    };
  }

  if (usage.models.length === 1) {
    const estimate = estimateAggregateCostUsd([{
      model: usage.models[0],
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens
    }], isClaude);

    return {
      available: true,
      costUsd: estimate.costUsd,
      fallbackPricingUsed: estimate.fallbackCount > 0,
      detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, fallbackPricingUsed: estimate.fallbackCount > 0 })
    };
  }

  if (usage.models.length > 1) {
    return {
      available: false,
      detail: 'Estimate unavailable · mixed models',
      detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, unavailableReason: 'mixed-model today usage has no per-model token breakdown' })
    };
  }

  return {
    available: false,
    detail: 'No model data',
    detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, unavailableReason: 'no model data is available' })
  };
}

function costRowFromEstimate(
  estimate: { available: true; costUsd: number } | { available: false } | undefined
): { costUsd?: number } {
  return estimate?.available ? { costUsd: estimate.costUsd } : {};
}

function overviewPartHasValues(part: OverviewTodayPart): boolean {
  return part.totalTokens > 0 ||
    part.inputTokens > 0 ||
    part.outputTokens > 0 ||
    part.cacheTokens > 0 ||
    (part.assistantMessages !== undefined && part.assistantMessages > 0) ||
    part.hasApiEstimateInput;
}

function overviewDetailLines(
  parts: OverviewTodayPart[],
  formatValue: (part: OverviewTodayPart) => string,
  isMeaningful: (part: OverviewTodayPart) => boolean
): string[] | undefined {
  const lines = parts
    .filter(isMeaningful)
    .map(part => `${part.label}: ${formatValue(part)}`);
  return lines.length >= 2 ? lines : undefined;
}

function buildOverviewTodayCards(parts: OverviewTodayPart[]): UsageDashboardMetricCard[] | undefined {
  const activeParts = parts.filter(overviewPartHasValues);
  if (activeParts.length === 0) {
    return undefined;
  }

  const totalMessages = activeParts.reduce((sum, part) => sum + (part.assistantMessages ?? 0), 0);
  const messagesAvailable = activeParts.some(part => part.assistantMessages !== undefined);
  const totalTokens = activeParts.reduce((sum, part) => sum + part.totalTokens, 0);
  const totalInput = activeParts.reduce((sum, part) => sum + part.inputTokens, 0);
  const totalOutput = activeParts.reduce((sum, part) => sum + part.outputTokens, 0);
  const totalCache = activeParts.reduce((sum, part) => sum + part.cacheTokens, 0);
  const apiRows = activeParts
    .filter(part => part.hasApiEstimateInput)
    .map(part => ({ costUsd: part.apiCostUsd }));
  const totalApi = sumCostIfComplete(apiRows);
  const fallbackPricingUsed = activeParts.some(part => part.apiFallbackPricingUsed);

  const overviewSource = sourceInfo(
    'mixedDayBucket',
    'Today - combined',
    'Combined Today usage from enabled Claude and Codex sources.'
  );

  return [
    {
      key: 'overviewTodayMessages',
      label: '1D Messages/Turns',
      value: messagesAvailable ? formatCount(totalMessages) : '-',
      detail: activeParts
        .map(part => `${part.label} ${part.assistantMessages !== undefined ? formatCount(part.assistantMessages) : 'activity unavailable'}`)
        .join(' | '),
      detailLines: overviewDetailLines(
        activeParts,
        part => part.assistantMessages !== undefined ? formatCount(part.assistantMessages) : 'activity unavailable',
        part => part.assistantMessages !== undefined && part.assistantMessages > 0
      ),
      available: messagesAvailable,
      source: overviewSource
    },
    {
      key: 'overviewTodayTokens',
      label: '1D Tokens',
      value: formatCount(totalTokens),
      detail: activeParts.map(part => `${part.label} ${formatCount(part.totalTokens)}`).join(' | '),
      detailLines: overviewDetailLines(activeParts, part => formatCount(part.totalTokens), part => part.totalTokens > 0),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayInputOutput',
      label: '1D Input / Output',
      value: `${formatCount(totalInput)} / ${formatCount(totalOutput)}`,
      detail: activeParts.map(part => `${part.label} ${formatCount(part.inputTokens)} / ${formatCount(part.outputTokens)}`).join(' | '),
      detailLines: overviewDetailLines(
        activeParts,
        part => `${formatCount(part.inputTokens)} / ${formatCount(part.outputTokens)}`,
        part => part.inputTokens > 0 || part.outputTokens > 0
      ),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayCache',
      label: '1D Cache',
      value: formatCount(totalCache),
      detail: activeParts.map(part => `${part.label} ${formatCount(part.cacheTokens)}`).join(' | '),
      detailLines: overviewDetailLines(activeParts, part => formatCount(part.cacheTokens), part => part.cacheTokens > 0),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayApiEquivalent',
      label: '1D API-equivalent',
      value: totalApi !== undefined ? formatUsd(totalApi) : 'Unavailable',
      detail: totalApi !== undefined
        ? activeParts
          .filter(part => part.hasApiEstimateInput)
          .map(part => `${part.label} ${formatUsd(part.apiCostUsd ?? 0)}`)
          .join(' | ')
        : 'Estimate requires model/token data from all contributing Today sources',
      detailLines: totalApi !== undefined
        ? overviewDetailLines(
          activeParts,
          part => formatUsd(part.apiCostUsd ?? 0),
          part => part.hasApiEstimateInput && part.apiCostUsd !== undefined
        )
        : undefined,
      detailTooltip: formatApiEstimateTooltip({
        label: '1D API-equivalent',
        fallbackPricingUsed,
        unavailableReason: totalApi === undefined ? 'every contributing Today source must include model and token component data' : undefined
      }),
      available: totalApi !== undefined,
      source: overviewSource
    }
  ];
}

function estimateRemoteTodayApiEquivalent(
  remote: RemoteSourceTodaySummary,
  modelEntries: RemoteModelEntry[] | undefined,
  isClaude: boolean,
  providerLabel: 'Claude' | 'Codex'
): { available: true; costUsd: number; fallbackPricingUsed: boolean; detail: string; detailTooltip?: string } | { available: false; detail: string; detailTooltip?: string } {
  const entries = (modelEntries ?? []).filter(entry => entry.model && entry.tokens > 0);
  const remoteTotal = displayTotalTokens(remote);
  const entryTotal = entries.reduce((sum, entry) => sum + displayTotalTokens({
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    cacheReadTokens: entry.cacheReadTokens
  }), 0);
  if (remoteTotal <= 0 || entries.length === 0 || entryTotal !== remoteTotal) {
    return {
      available: false,
      detail: 'Snapshot cost unavailable',
      detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, unavailableReason: 'selected imported snapshot rows do not include model and token component data for every contributing row' })
    };
  }

  const estimate = estimateAggregateCostUsd(entries.map(entry => ({
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationInputTokens: entry.cacheCreationTokens,
    cacheReadInputTokens: entry.cacheReadTokens
  })), isClaude);

  return {
    available: true,
    costUsd: estimate.costUsd,
    fallbackPricingUsed: estimate.fallbackCount > 0,
    detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
    detailTooltip: formatApiEstimateTooltip({ label: `${providerLabel} 1D API-equivalent`, fallbackPricingUsed: estimate.fallbackCount > 0 })
  };
}

export function buildClaudeTodayUnavailableCards(detail: string): UsageDashboardMetricCard[] {
  return [
    buildUnavailableMetricCard('todayMessages', '1D Messages/Turns', detail),
    buildUnavailableMetricCard('todayTokens', '1D Tokens', detail),
    buildUnavailableMetricCard('todayInputOutput', '1D Input / Output', detail),
    buildUnavailableMetricCard('todayCache', '1D Cache', detail),
    buildUnavailableMetricCard('todayApiEquivalent', '1D API-equivalent', 'No Claude today usage data available; cannot estimate API-equivalent cost')
  ];
}

export function buildCodexTodayUnavailableCards(detail: string): UsageDashboardMetricCard[] {
  return [
    buildUnavailableMetricCard('codexTodayMessages', '1D Messages/Turns', detail),
    buildUnavailableMetricCard('codexTodayTokens', '1D Tokens', detail),
    buildUnavailableMetricCard('codexTodayInputOutput', '1D Input / Output', detail),
    buildUnavailableMetricCard('codexTodayCache', '1D Cache', detail),
    buildUnavailableMetricCard('codexTodayApiEquivalent', '1D API-equivalent', 'No Codex today usage data available; cannot estimate API-equivalent cost')
  ];
}

function buildRemoteTodayCards(
  remote: RemoteSourceTodaySummary,
  modelEntries: RemoteModelEntry[] | undefined,
  isClaude: boolean,
  providerLabel: 'Claude' | 'Codex',
  keyPrefix: string,
  remoteSource: UsageDashboardSourceInfo
): UsageDashboardMetricCard[] {
  const remoteTotal = displayTotalTokens(remote);
  const remoteCache = remote.cacheCreationTokens + remote.cacheReadTokens;
  const remoteNote = buildRemoteSourceNote(remote);
  const remoteApiEstimate = estimateRemoteTodayApiEquivalent(remote, modelEntries, isClaude, providerLabel);
  const activityCount = remote.assistantMessages;
  const activityLabel = isClaude ? 'messages' : 'turns';

  return [{
    key: `${keyPrefix}Messages`,
    label: '1D Messages/Turns',
    value: activityCount !== undefined ? formatCount(activityCount) : '—',
    detail: activityCount !== undefined
      ? `${remoteNote} · ${activityCount} ${activityLabel}`
      : 'Activity count not available from snapshot data',
    available: activityCount !== undefined,
    source: remoteSource
  }, {
    key: `${keyPrefix}Tokens`,
    label: '1D Tokens',
    value: formatCount(remoteTotal),
    detail: remoteNote,
    available: true,
    source: remoteSource
  }, {
    key: `${keyPrefix}InputOutput`,
    label: '1D Input / Output',
    value: `${formatCount(remote.inputTokens)} / ${formatCount(remote.outputTokens)}`,
    detail: '',
    available: true,
    source: remoteSource
  }, {
    key: `${keyPrefix}Cache`,
    label: '1D Cache',
    value: formatCount(remoteCache),
    detail: '',
    available: true,
    source: remoteSource
  }, {
    key: `${keyPrefix}ApiEquivalent`,
    label: '1D API-equivalent',
    value: remoteApiEstimate.available ? formatUsd(remoteApiEstimate.costUsd) : 'Unavailable',
    detail: remoteApiEstimate.available ? remoteApiEstimate.detail : 'No per-model data from snapshot; API-equivalent estimate unavailable',
    detailTooltip: remoteApiEstimate.detailTooltip,
    available: remoteApiEstimate.available,
    source: remoteSource
  }];
}

export function buildTodayOverviewFromCharts(
  claudeChart: UsageDashboardHistoryChart | undefined,
  codexChart: UsageDashboardHistoryChart | undefined,
  claudeEnabled: boolean,
  codexEnabled: boolean
): UsageDashboardMetricCard[] | undefined {
  const claudeView = claudeEnabled ? claudeChart?.rangeViews?.['1D'] : undefined;
  const codexView = codexEnabled ? codexChart?.rangeViews?.['1D'] : undefined;
  const claudeBin = claudeView && claudeView.activeBinCount > 0 ? claudeView.points[0] : undefined;
  const codexBin = codexView && codexView.activeBinCount > 0 ? codexView.points[0] : undefined;
  if (!claudeBin && !codexBin) { return undefined; }

  const toEstimateInput = (bin: UsageHistoryPoint, isClaude: boolean) =>
    bin.models.length > 0
      ? estimateAggregateCostUsd(bin.models.map(m => ({
          model: m.model,
          inputTokens: m.inputTokens ?? 0,
          outputTokens: m.outputTokens ?? 0,
          cacheCreationInputTokens: m.cacheCreationInputTokens ?? 0,
          cacheReadInputTokens: m.cacheReadInputTokens ?? 0
        })), isClaude)
      : undefined;

  if (!claudeBin || !codexBin) {
    const parts: OverviewTodayPart[] = [];
    if (claudeBin) {
      const claudeApi = toEstimateInput(claudeBin, true);
      parts.push({
        label: 'Claude',
        assistantMessages: claudeBin.assistantMessages,
        inputTokens: claudeBin.inputTokens,
        outputTokens: claudeBin.outputTokens,
        cacheTokens: claudeBin.cacheTokens,
        totalTokens: claudeBin.totalTokens,
        apiCostUsd: claudeApi?.costUsd,
        apiFallbackPricingUsed: claudeApi ? claudeApi.fallbackCount > 0 : false,
        hasApiEstimateInput: claudeBin.models.length > 0
      });
    }
    if (codexBin) {
      const codexApi = toEstimateInput(codexBin, false);
      parts.push({
        label: 'Codex',
        assistantMessages: codexBin.assistantMessages,
        inputTokens: codexBin.inputTokens,
        outputTokens: codexBin.outputTokens,
        cacheTokens: codexBin.cacheTokens,
        totalTokens: codexBin.totalTokens,
        apiCostUsd: codexApi?.costUsd,
        apiFallbackPricingUsed: codexApi ? codexApi.fallbackCount > 0 : false,
        hasApiEstimateInput: codexBin.models.length > 0
      });
    }
    return buildOverviewTodayCards(parts);
  }

  const totalTokens = claudeBin.totalTokens + codexBin.totalTokens;
  const totalInput = claudeBin.inputTokens + codexBin.inputTokens;
  const totalOutput = claudeBin.outputTokens + codexBin.outputTokens;
  const totalCache = claudeBin.cacheTokens + codexBin.cacheTokens;

  const claudeApi = toEstimateInput(claudeBin, true);
  const codexApi = toEstimateInput(codexBin, false);
  const totalApi = claudeApi && codexApi ? claudeApi.costUsd + codexApi.costUsd : undefined;
  const parts: OverviewTodayPart[] = [
    {
      label: 'Claude',
      assistantMessages: claudeBin.assistantMessages,
      inputTokens: claudeBin.inputTokens,
      outputTokens: claudeBin.outputTokens,
      cacheTokens: claudeBin.cacheTokens,
      totalTokens: claudeBin.totalTokens,
      apiCostUsd: claudeApi?.costUsd,
      apiFallbackPricingUsed: claudeApi ? claudeApi.fallbackCount > 0 : false,
      hasApiEstimateInput: claudeBin.models.length > 0
    },
    {
      label: 'Codex',
      assistantMessages: codexBin.assistantMessages,
      inputTokens: codexBin.inputTokens,
      outputTokens: codexBin.outputTokens,
      cacheTokens: codexBin.cacheTokens,
      totalTokens: codexBin.totalTokens,
      apiCostUsd: codexApi?.costUsd,
      apiFallbackPricingUsed: codexApi ? codexApi.fallbackCount > 0 : false,
      hasApiEstimateInput: codexBin.models.length > 0
    }
  ];

  const overviewSource = sourceInfo('mixedDayBucket', 'Today — combined', 'Claude and Codex today usage from 1D history bins.');
  return [
    {
      key: 'overviewTodayMessages',
      label: '1D Messages/Turns',
      value: formatCount(claudeBin.assistantMessages + codexBin.assistantMessages),
      detail: `Claude ${formatCount(claudeBin.assistantMessages)} · Codex ${formatCount(codexBin.assistantMessages)}`,
      detailLines: overviewDetailLines(parts, part => formatCount(part.assistantMessages ?? 0), part => (part.assistantMessages ?? 0) > 0),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayTokens',
      label: '1D Tokens',
      value: formatCount(totalTokens),
      detail: `Claude ${formatCount(claudeBin.totalTokens)} · Codex ${formatCount(codexBin.totalTokens)}`,
      detailLines: overviewDetailLines(parts, part => formatCount(part.totalTokens), part => part.totalTokens > 0),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayInputOutput',
      label: '1D Input / Output',
      value: `${formatCount(totalInput)} / ${formatCount(totalOutput)}`,
      detail: `Claude ${formatCount(claudeBin.inputTokens)} / ${formatCount(claudeBin.outputTokens)} · Codex ${formatCount(codexBin.inputTokens)} / ${formatCount(codexBin.outputTokens)}`,
      detailLines: overviewDetailLines(
        parts,
        part => `${formatCount(part.inputTokens)} / ${formatCount(part.outputTokens)}`,
        part => part.inputTokens > 0 || part.outputTokens > 0
      ),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayCache',
      label: '1D Cache',
      value: formatCount(totalCache),
      detail: `Claude ${formatCount(claudeBin.cacheTokens)} · Codex ${formatCount(codexBin.cacheTokens)}`,
      detailLines: overviewDetailLines(parts, part => formatCount(part.cacheTokens), part => part.cacheTokens > 0),
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayApiEquivalent',
      label: '1D API-equivalent',
      value: totalApi !== undefined ? formatUsd(totalApi) : 'Unavailable',
      detail: totalApi !== undefined
        ? `Claude ${formatUsd(claudeApi!.costUsd)} · Codex ${formatUsd(codexApi!.costUsd)}`
        : 'Estimate requires per-model token data from all sources',
      detailLines: totalApi !== undefined
        ? overviewDetailLines(
          parts,
          part => formatUsd(part.apiCostUsd ?? 0),
          part => part.hasApiEstimateInput && part.apiCostUsd !== undefined
        )
        : undefined,
      detailTooltip: formatApiEstimateTooltip({
        label: '1D API-equivalent',
        fallbackPricingUsed: parts.some(part => part.apiFallbackPricingUsed),
        unavailableReason: totalApi === undefined ? 'every contributing Today source must include model and token component data' : undefined
      }),
      available: totalApi !== undefined,
      source: overviewSource
    }
  ];
}

export function buildTodaySectionSource(
  claudeTodayAvailable: boolean,
  codexTodayAvailable: boolean,
  hasRemoteToday: boolean,
  claudeTodaySource: UsageDashboardSourceInfo,
  codexTodaySource: UsageDashboardSourceInfo
): UsageDashboardSourceInfo {
  const hasLocal = claudeTodayAvailable || codexTodayAvailable;
  if (hasLocal && hasRemoteToday) {
    return sourceInfo('mixedDayBucket', 'Today data — merged', 'Section includes local day-bucket and snapshot sources; see each card for trust level.');
  }
  if (claudeTodayAvailable && codexTodayAvailable) {
    return sourceInfo('mixedDayBucket', 'Claude and Codex Today day buckets', 'Section includes provider-specific sources; see each card for trust level.');
  }
  if (claudeTodayAvailable) {
    return claudeTodaySource;
  }
  if (codexTodayAvailable) {
    return codexTodaySource;
  }
  if (hasRemoteToday) {
    return sourceInfo('snapshotOnly', 'Remote snapshot today summary', 'From selected remote machine snapshots only.');
  }
  return sourceInfo('unavailable', 'Today usage unavailable', undefined, 'No enabled provider has Today usage data available.');
}

export function buildToday(
  claudeTodayUsage?: ClaudeTodayUsageBucket,
  codexTodayUsage?: CodexCorrelatedDayBucket,
  claudeEnabled = true,
  codexEnabled = true,
  remoteUsage?: RemoteUsageProjection,
  aliasMap?: Record<string, string>
): UsageDashboardToday {
  const claudeAvailable = claudeEnabled && Boolean(claudeTodayUsage?.available);
  const codexAvailable = codexEnabled && Boolean(codexTodayUsage?.available);
  const cards: UsageDashboardMetricCard[] = [];
  const splitCards: UsageDashboardMetricCard[] = [];
  const scopeParts: string[] = [];

  const remoteClaude = claudeEnabled ? remoteUsage?.claudeToday : undefined;
  const remoteCodex = codexEnabled ? remoteUsage?.codexToday : undefined;
  const remoteClaudeModels = remoteUsage?.claudeTodayModelEntries;
  const remoteCodexModels = remoteUsage?.codexTodayModelEntries;
  const overviewParts: OverviewTodayPart[] = [];

  if (claudeEnabled) {
    if (claudeAvailable) {
      const hasRemote = Boolean(remoteClaude);
      const remoteNote = hasRemote ? buildRemoteSourceNote(remoteClaude!) : undefined;
      const mergedTokens = sumTokens(claudeTodayUsage!, remoteClaude);
      const mergedInput = mergedTokens.inputTokens;
      const mergedOutput = mergedTokens.outputTokens;
      const mergedCacheCreate = mergedTokens.cacheCreationTokens;
      const mergedCacheRead = mergedTokens.cacheReadTokens;
      const mergedTotal = displayTotalTokens(mergedTokens);
      const localTotal = displayTotalTokens(claudeTodayUsage!);
      const mergedCache = mergedCacheCreate + mergedCacheRead;
      const mergedSource = hasRemote
        ? sourceInfo('mixedDayBucket', 'Claude today — merged', 'Local day-bucket merged with selected snapshot data.')
        : undefined;
      scopeParts.push(hasRemote
        ? `Claude + ${remoteNote}`
        : `Claude assistant-message usage (${claudeTodayUsage!.dateLabel} local)`);

      const claudeTodayApiEstimate = estimateTodayApiEquivalent(claudeTodayUsage!, true, 'Claude');
      const claudeRemoteApiEstimate = hasRemote
        ? estimateRemoteTodayApiEquivalent(remoteClaude!, remoteClaudeModels, true, 'Claude')
        : undefined;
      const claudeMergedApiCost = hasRemote
        ? sumCostIfComplete([costRowFromEstimate(claudeTodayApiEstimate), costRowFromEstimate(claudeRemoteApiEstimate)])
        : claudeTodayApiEstimate.available
          ? claudeTodayApiEstimate.costUsd
          : undefined;
      const claudeMergedApiAvailable = claudeMergedApiCost !== undefined;
      overviewParts.push({
        label: 'Claude',
        assistantMessages: claudeTodayUsage!.assistantMessages + (remoteClaude?.assistantMessages ?? 0),
        inputTokens: mergedInput,
        outputTokens: mergedOutput,
        cacheTokens: mergedCache,
        totalTokens: hasRemote ? mergedTotal : localTotal,
        apiCostUsd: claudeMergedApiCost,
        apiFallbackPricingUsed: (claudeTodayApiEstimate.available && claudeTodayApiEstimate.fallbackPricingUsed) ||
          Boolean(claudeRemoteApiEstimate?.available && claudeRemoteApiEstimate.fallbackPricingUsed),
        hasApiEstimateInput: true
      });

      if (hasRemote) {
        splitCards.push({
          key: 'todayMessages',
          label: '1D Messages/Turns',
          value: formatCount(claudeTodayUsage!.assistantMessages),
          detail: '',
          available: true
        }, {
          key: 'todayTokens',
          label: '1D Tokens',
          value: formatCount(localTotal),
          detail: '',
          available: true
        }, {
          key: 'todayInputOutput',
          label: '1D Input / Output',
          value: `${formatCount(claudeTodayUsage!.inputTokens)} / ${formatCount(claudeTodayUsage!.outputTokens)}`,
          detail: '',
          available: true
        }, {
          key: 'todayCache',
          label: '1D Cache',
          value: formatCount(claudeTodayUsage!.cacheCreationInputTokens + claudeTodayUsage!.cacheReadInputTokens),
          detail: '',
          available: true
        }, {
          key: 'todayApiEquivalent',
          label: '1D API-equivalent',
          value: claudeTodayApiEstimate.available ? formatUsd(claudeTodayApiEstimate.costUsd) : 'Unavailable',
          detail: claudeTodayApiEstimate.detail,
          detailTooltip: claudeTodayApiEstimate.detailTooltip,
          available: claudeTodayApiEstimate.available
        },
        ...buildRemoteTodayCards(
          remoteClaude!,
          remoteClaudeModels,
          true,
          'Claude',
          'remoteTodayClaude',
          sourceInfo('snapshotOnly', 'Claude snapshot today summary', 'Aggregated from selected imported Claude snapshots')
        ));
      }

      cards.push({
        key: 'todayMessages',
        label: '1D Messages/Turns',
        value: formatCount(claudeTodayUsage!.assistantMessages),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'todayTokens',
        label: '1D Tokens',
        value: formatCount(hasRemote ? mergedTotal : localTotal),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'todayInputOutput',
        label: '1D Input / Output',
        value: hasRemote
          ? `${formatCount(mergedInput)} / ${formatCount(mergedOutput)}`
          : `${formatCount(claudeTodayUsage!.inputTokens)} / ${formatCount(claudeTodayUsage!.outputTokens)}`,
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'todayCache',
        label: '1D Cache',
        value: formatCount(hasRemote ? mergedCache : claudeTodayUsage!.cacheCreationInputTokens + claudeTodayUsage!.cacheReadInputTokens),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'todayApiEquivalent',
        label: '1D API-equivalent',
        value: claudeMergedApiAvailable ? formatUsd(claudeMergedApiCost) : 'Unavailable',
        detail: claudeMergedApiAvailable
          ? (hasRemote ? 'Estimate · not actual billing' : claudeTodayApiEstimate.detail)
          : 'Estimate unavailable · some snapshot rows lack model/token components',
        detailTooltip: hasRemote
          ? formatApiEstimateTooltip({
            label: 'Claude 1D API-equivalent',
            fallbackPricingUsed: (claudeTodayApiEstimate.available && claudeTodayApiEstimate.fallbackPricingUsed) ||
              Boolean(claudeRemoteApiEstimate?.available && claudeRemoteApiEstimate.fallbackPricingUsed),
            unavailableReason: claudeMergedApiAvailable ? undefined : 'all snapshot rows must carry model and token component data'
          })
          : claudeTodayApiEstimate.detailTooltip,
        available: claudeMergedApiAvailable
      });
    } else if (remoteClaude) {
      const remoteTotal = displayTotalTokens(remoteClaude);
      const remoteCache = remoteClaude.cacheCreationTokens + remoteClaude.cacheReadTokens;
      const sourceNote = remoteClaude.sourceCount === 1 ? '1 source' : `${remoteClaude.sourceCount} sources`;
      const remoteSource = sourceInfo('snapshotOnly', 'Snapshot today summary', 'Aggregated from selected imported snapshots');
      const remoteApiEstimate = estimateRemoteTodayApiEquivalent(remoteClaude, remoteClaudeModels, true, 'Claude');

      scopeParts.push(`Claude snapshot (${sourceNote})`);
      const remoteClaudeMessages = remoteClaude.assistantMessages;
      overviewParts.push({
        label: 'Claude',
        ...(remoteClaudeMessages !== undefined ? { assistantMessages: remoteClaudeMessages } : {}),
        inputTokens: remoteClaude.inputTokens,
        outputTokens: remoteClaude.outputTokens,
        cacheTokens: remoteCache,
        totalTokens: remoteTotal,
        apiCostUsd: remoteApiEstimate.available ? remoteApiEstimate.costUsd : undefined,
        apiFallbackPricingUsed: remoteApiEstimate.available && remoteApiEstimate.fallbackPricingUsed,
        hasApiEstimateInput: true
      });
      cards.push({
        key: 'todayMessages',
        label: '1D Messages/Turns',
        value: remoteClaudeMessages !== undefined ? formatCount(remoteClaudeMessages) : '—',
        detail: remoteClaudeMessages !== undefined ? '' : 'Activity count not available from snapshot data',
        available: remoteClaudeMessages !== undefined,
        source: remoteSource
      }, {
        key: 'todayTokens',
        label: '1D Tokens',
        value: formatCount(remoteTotal),
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'todayInputOutput',
        label: '1D Input / Output',
        value: `${formatCount(remoteClaude.inputTokens)} / ${formatCount(remoteClaude.outputTokens)}`,
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'todayCache',
        label: '1D Cache',
        value: formatCount(remoteCache),
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'todayApiEquivalent',
        label: '1D API-equivalent',
        value: remoteApiEstimate.available ? formatUsd(remoteApiEstimate.costUsd) : 'Unavailable',
        detail: remoteApiEstimate.available ? remoteApiEstimate.detail : 'No per-model data from snapshot; API-equivalent estimate unavailable',
        detailTooltip: remoteApiEstimate.detailTooltip,
        available: remoteApiEstimate.available
      });
      // Separate view: local panel shows no-local placeholder; remote panel shows snapshot cards.
      splitCards.push(
        buildUnavailableMetricCard('todayMessages', '1D Messages/Turns', 'No local Claude activity today'),
        buildUnavailableMetricCard('todayTokens', '1D Tokens', 'No local Claude activity today'),
        buildUnavailableMetricCard('todayInputOutput', '1D Input / Output', 'No local Claude activity today'),
        buildUnavailableMetricCard('todayCache', '1D Cache', 'No local Claude activity today'),
        buildUnavailableMetricCard('todayApiEquivalent', '1D API-equivalent', 'No local Claude activity today'),
        ...buildRemoteTodayCards(remoteClaude, remoteClaudeModels, true, 'Claude', 'remoteTodayClaude',
          sourceInfo('snapshotOnly', 'Claude snapshot today summary', 'Aggregated from selected imported Claude snapshots'))
      );
    } else {
      scopeParts.push('Claude (no activity today)');
      cards.push(
        { key: 'todayMessages', label: '1D Messages/Turns', value: '0', detail: 'No Claude activity today', available: true },
        { key: 'todayTokens', label: '1D Tokens', value: '0', detail: 'No Claude activity today', available: true },
        { key: 'todayInputOutput', label: '1D Input / Output', value: '0 / 0', detail: '', available: true },
        { key: 'todayCache', label: '1D Cache', value: '0', detail: '', available: true },
        buildUnavailableMetricCard('todayApiEquivalent', '1D API-equivalent', 'No Claude activity today')
      );
    }
  }

  if (codexEnabled) {
    if (codexAvailable) {
      const hasRemote = Boolean(remoteCodex);
      const remoteNote = hasRemote ? buildRemoteSourceNote(remoteCodex!) : undefined;
      const mergedTokens = sumTokens(codexTodayUsage!, remoteCodex);
      const mergedInput = mergedTokens.inputTokens;
      const mergedOutput = mergedTokens.outputTokens;
      const mergedCacheCreate = mergedTokens.cacheCreationTokens;
      const mergedCacheRead = mergedTokens.cacheReadTokens;
      const mergedTotal = displayTotalTokens(mergedTokens);
      const localTotal = displayTotalTokens(codexTodayUsage!);
      const mergedCache = mergedCacheCreate + mergedCacheRead;
      const mergedSource = hasRemote
        ? sourceInfo('mixedDayBucket', 'Codex today — merged', 'Local correlated day-bucket merged with selected snapshot data.')
        : undefined;
      scopeParts.push(hasRemote
        ? `Codex + ${remoteNote}`
        : `Codex correlated usage (${codexTodayUsage!.dateLabel} local)`);

      const codexTodayApiEstimate = estimateTodayApiEquivalent(codexTodayUsage!, false, 'Codex');
      const codexRemoteApiEstimate = hasRemote
        ? estimateRemoteTodayApiEquivalent(remoteCodex!, remoteCodexModels, false, 'Codex')
        : undefined;
      const codexMergedApiCost = hasRemote
        ? sumCostIfComplete([costRowFromEstimate(codexTodayApiEstimate), costRowFromEstimate(codexRemoteApiEstimate)])
        : codexTodayApiEstimate.available
          ? codexTodayApiEstimate.costUsd
          : undefined;
      const codexMergedApiAvailable = codexMergedApiCost !== undefined;
      overviewParts.push({
        label: 'Codex',
        assistantMessages: codexTodayUsage!.correlatedTurns + (remoteCodex?.assistantMessages ?? 0),
        inputTokens: mergedInput,
        outputTokens: mergedOutput,
        cacheTokens: mergedCache,
        totalTokens: hasRemote ? mergedTotal : localTotal,
        apiCostUsd: codexMergedApiCost,
        apiFallbackPricingUsed: (codexTodayApiEstimate.available && codexTodayApiEstimate.fallbackPricingUsed) ||
          Boolean(codexRemoteApiEstimate?.available && codexRemoteApiEstimate.fallbackPricingUsed),
        hasApiEstimateInput: true
      });

      if (hasRemote) {
        splitCards.push({
          key: 'codexTodayMessages',
          label: '1D Messages/Turns',
          value: formatCount(codexTodayUsage!.correlatedTurns),
          detail: '',
          available: true
        }, {
          key: 'codexTodayTokens',
          label: '1D Tokens',
          value: formatCount(localTotal),
          detail: '',
          available: true
        }, {
          key: 'codexTodayInputOutput',
          label: '1D Input / Output',
          value: `${formatCount(codexTodayUsage!.inputTokens)} / ${formatCount(codexTodayUsage!.outputTokens)}`,
          detail: '',
          available: true
        }, {
          key: 'codexTodayCache',
          label: '1D Cache',
          value: formatCount(codexTodayUsage!.cacheCreationInputTokens + codexTodayUsage!.cacheReadInputTokens),
          detail: '',
          available: true
        }, {
          key: 'codexTodayApiEquivalent',
          label: '1D API-equivalent',
          value: codexTodayApiEstimate.available ? formatUsd(codexTodayApiEstimate.costUsd) : 'Unavailable',
          detail: codexTodayApiEstimate.detail,
          detailTooltip: codexTodayApiEstimate.detailTooltip,
          available: codexTodayApiEstimate.available
        },
        ...buildRemoteTodayCards(
          remoteCodex!,
          remoteCodexModels,
          false,
          'Codex',
          'remoteTodayCodex',
          sourceInfo('snapshotOnly', 'Codex snapshot today summary', 'Aggregated from selected imported Codex snapshots')
        ));
      }

      cards.push({
        key: 'codexTodayMessages',
        label: '1D Messages/Turns',
        value: formatCount(codexTodayUsage!.correlatedTurns),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'codexTodayTokens',
        label: '1D Tokens',
        value: formatCount(hasRemote ? mergedTotal : localTotal),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'codexTodayInputOutput',
        label: '1D Input / Output',
        value: hasRemote
          ? `${formatCount(mergedInput)} / ${formatCount(mergedOutput)}`
          : `${formatCount(codexTodayUsage!.inputTokens)} / ${formatCount(codexTodayUsage!.outputTokens)}`,
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'codexTodayCache',
        label: '1D Cache',
        value: formatCount(hasRemote ? mergedCache : codexTodayUsage!.cacheCreationInputTokens + codexTodayUsage!.cacheReadInputTokens),
        detail: '',
        available: true,
        ...(mergedSource ? { source: mergedSource } : {})
      }, {
        key: 'codexTodayApiEquivalent',
        label: '1D API-equivalent',
        value: codexMergedApiAvailable ? formatUsd(codexMergedApiCost) : 'Unavailable',
        detail: codexMergedApiAvailable
          ? (hasRemote ? 'Estimate · not actual billing' : codexTodayApiEstimate.detail)
          : 'Estimate unavailable · some snapshot rows lack model/token components',
        detailTooltip: hasRemote
          ? formatApiEstimateTooltip({
            label: 'Codex 1D API-equivalent',
            fallbackPricingUsed: (codexTodayApiEstimate.available && codexTodayApiEstimate.fallbackPricingUsed) ||
              Boolean(codexRemoteApiEstimate?.available && codexRemoteApiEstimate.fallbackPricingUsed),
            unavailableReason: codexMergedApiAvailable ? undefined : 'all snapshot rows must carry model and token component data'
          })
          : codexTodayApiEstimate.detailTooltip,
        available: codexMergedApiAvailable
      });
    } else if (remoteCodex) {
      const remoteTotal = displayTotalTokens(remoteCodex);
      const remoteCache = remoteCodex.cacheCreationTokens + remoteCodex.cacheReadTokens;
      const sourceNote = remoteCodex.sourceCount === 1 ? '1 source' : `${remoteCodex.sourceCount} sources`;
      const remoteSource = sourceInfo('snapshotOnly', 'Codex snapshot today summary', 'Aggregated from selected imported Codex snapshots');
      const remoteApiEstimate = estimateRemoteTodayApiEquivalent(remoteCodex, remoteCodexModels, false, 'Codex');

      scopeParts.push(`Codex snapshot (${sourceNote})`);
      const remoteCodexMessages = remoteCodex.assistantMessages;
      overviewParts.push({
        label: 'Codex',
        ...(remoteCodexMessages !== undefined ? { assistantMessages: remoteCodexMessages } : {}),
        inputTokens: remoteCodex.inputTokens,
        outputTokens: remoteCodex.outputTokens,
        cacheTokens: remoteCache,
        totalTokens: remoteTotal,
        apiCostUsd: remoteApiEstimate.available ? remoteApiEstimate.costUsd : undefined,
        apiFallbackPricingUsed: remoteApiEstimate.available && remoteApiEstimate.fallbackPricingUsed,
        hasApiEstimateInput: true
      });
      cards.push({
        key: 'codexTodayMessages',
        label: '1D Messages/Turns',
        value: remoteCodexMessages !== undefined ? formatCount(remoteCodexMessages) : '—',
        detail: remoteCodexMessages !== undefined ? '' : 'Activity count not available from snapshot data',
        available: remoteCodexMessages !== undefined,
        source: remoteSource
      }, {
        key: 'codexTodayTokens',
        label: '1D Tokens',
        value: formatCount(remoteTotal),
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'codexTodayInputOutput',
        label: '1D Input / Output',
        value: `${formatCount(remoteCodex.inputTokens)} / ${formatCount(remoteCodex.outputTokens)}`,
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'codexTodayCache',
        label: '1D Cache',
        value: formatCount(remoteCache),
        detail: '',
        available: true,
        source: remoteSource
      }, {
        key: 'codexTodayApiEquivalent',
        label: '1D API-equivalent',
        value: remoteApiEstimate.available ? formatUsd(remoteApiEstimate.costUsd) : 'Unavailable',
        detail: remoteApiEstimate.available ? remoteApiEstimate.detail : 'No per-model data from snapshot; API-equivalent estimate unavailable',
        detailTooltip: remoteApiEstimate.detailTooltip,
        available: remoteApiEstimate.available
      });
      // Separate view: local panel shows no-local placeholder; remote panel shows snapshot cards.
      splitCards.push(
        buildUnavailableMetricCard('codexTodayMessages', '1D Messages/Turns', 'No local Codex activity today'),
        buildUnavailableMetricCard('codexTodayTokens', '1D Tokens', 'No local Codex activity today'),
        buildUnavailableMetricCard('codexTodayInputOutput', '1D Input / Output', 'No local Codex activity today'),
        buildUnavailableMetricCard('codexTodayCache', '1D Cache', 'No local Codex activity today'),
        buildUnavailableMetricCard('codexTodayApiEquivalent', '1D API-equivalent', 'No local Codex activity today'),
        ...buildRemoteTodayCards(remoteCodex, remoteCodexModels, false, 'Codex', 'remoteTodayCodex', remoteSource)
      );
    } else {
      scopeParts.push('Codex (no activity today)');
      cards.push(
        { key: 'codexTodayMessages', label: '1D Messages/Turns', value: '0', detail: 'No Codex activity today', available: true },
        { key: 'codexTodayTokens', label: '1D Tokens', value: '0', detail: 'No Codex activity today', available: true },
        { key: 'codexTodayInputOutput', label: '1D Input / Output', value: '0 / 0', detail: '', available: true },
        { key: 'codexTodayCache', label: '1D Cache', value: '0', detail: '', available: true },
        buildUnavailableMetricCard('codexTodayApiEquivalent', '1D API-equivalent', 'No Codex activity today')
      );
    }
  }

  const claudeSectionLabel = (claudeAvailable || remoteClaude) && claudeEnabled
    ? buildSectionLabel(['Claude'], remoteClaude?.machineLabels ?? [], 'claude', aliasMap)
    : undefined;
  const codexSectionLabel = (codexAvailable || remoteCodex) && codexEnabled
    ? buildSectionLabel(['Codex'], remoteCodex?.machineLabels ?? [], 'codex', aliasMap)
    : undefined;
  const overviewCards = buildOverviewTodayCards(overviewParts);

  return {
    available: claudeEnabled || codexEnabled || claudeAvailable || codexAvailable || Boolean(remoteClaude) || Boolean(remoteCodex),
    scopeLabel: scopeParts.length > 0 ? `Today — ${scopeParts.join('; ')}` : 'Today — no enabled providers',
    cards,
    ...(splitCards.length > 0 ? { splitCards } : {}),
    ...(claudeSectionLabel ? { claudeSectionLabel } : {}),
    ...(codexSectionLabel ? { codexSectionLabel } : {}),
    ...(overviewCards ? { overviewCards } : {})
  };
}

function buildSectionLabel(
  baseLabels: string[],
  remoteMachineLabels: string[],
  provider: 'claude' | 'codex',
  aliasMap?: Record<string, string>
): string {
  if (remoteMachineLabels.length === 0) {
    return baseLabels.join(' + ');
  }
  const providerLabel = provider === 'claude' ? 'Claude' : 'Codex';
  const seen = new Set(baseLabels);
  const parts = [...baseLabels];
  for (const ml of remoteMachineLabels) {
    const alias = aliasMap?.[ml] ?? ml;
    const label = `${providerLabel} ${alias}`;
    if (!seen.has(label)) {
      seen.add(label);
      parts.push(label);
    }
  }
  return parts.join(' + ');
}
