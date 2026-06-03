import type { ClaudeTodayUsageBucket } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../../providers/codexCorrelatedDayBucketScanner';
import { estimateAggregateCostUsd } from '../../providers/pricing';
import { sumCostIfComplete } from '../../display/apiEquivalentCost';
import type { RemoteSourceTodaySummary, RemoteUsageProjection, RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens, sumTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardMetricCard, UsageDashboardToday, UsageDashboardSourceInfo, UsageDashboardHistoryChart } from '../usageDashboardModel';
import type { UsageHistoryPoint } from '../usageHistoryBinning';
import { formatCount, formatUsd, sourceInfo, buildUnavailableMetricCard } from './format';

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
): { available: true; costUsd: number; detail: string; detailTooltip?: string } | { available: false; detail: string; detailTooltip?: string } {
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
      detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: estimate.fallbackCount > 0
        ? `Estimated ${providerLabel} API-equivalent cost from per-model today usage (${estimate.fallbackCount}/${estimate.totalCount} models used fallback pricing). Not actual billing.`
        : `Estimated ${providerLabel} API-equivalent cost from per-model today usage; not actual billing`
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
      detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
      detailTooltip: estimate.fallbackCount > 0
        ? `Estimated ${providerLabel} API-equivalent cost using single-model today aggregate (fallback pricing for unrecognized model "${usage.models[0]}"). Not actual billing.`
        : `Estimated ${providerLabel} API-equivalent cost using single-model today aggregate; not actual billing`
    };
  }

  if (usage.models.length > 1) {
    return {
      available: false,
      detail: 'Estimate unavailable · mixed models',
      detailTooltip: `Mixed-model ${providerLabel} today usage has no per-model token breakdown; API-equivalent estimate unavailable.`
    };
  }

  return {
    available: false,
    detail: 'No model data',
    detailTooltip: `No ${providerLabel} model data available; cannot estimate API-equivalent cost.`
  };
}

function costRowFromEstimate(
  estimate: { available: true; costUsd: number } | { available: false } | undefined
): { costUsd?: number } {
  return estimate?.available ? { costUsd: estimate.costUsd } : {};
}

function estimateRemoteTodayApiEquivalent(
  remote: RemoteSourceTodaySummary,
  modelEntries: RemoteModelEntry[] | undefined,
  isClaude: boolean,
  providerLabel: 'Claude' | 'Codex'
): { available: true; costUsd: number; detail: string; detailTooltip?: string } | { available: false; detail: string; detailTooltip?: string } {
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
      detailTooltip: `Selected imported ${providerLabel} snapshot rows do not include model and token component data for every contributing row.`
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
    detail: estimate.fallbackCount > 0 ? 'Estimate · fallback pricing used' : 'Estimate · not actual billing',
    detailTooltip: estimate.fallbackCount > 0
      ? `Estimated ${providerLabel} API-equivalent cost from selected remote bucket model rows (${estimate.fallbackCount}/${estimate.totalCount} models used fallback pricing). Not actual billing.`
      : `Estimated ${providerLabel} API-equivalent cost from selected remote bucket model rows; not actual billing.`
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
  if (!claudeChart?.rangeViews || !codexChart?.rangeViews) {
    return undefined;
  }
  const claudeView = claudeEnabled ? claudeChart.rangeViews['1D'] : undefined;
  const codexView = codexEnabled ? codexChart.rangeViews['1D'] : undefined;
  const claudeBin = claudeView && claudeView.activeBinCount > 0 ? claudeView.points[0] : undefined;
  const codexBin = codexView && codexView.activeBinCount > 0 ? codexView.points[0] : undefined;
  if (!claudeBin || !codexBin) { return undefined; }

  const totalTokens = claudeBin.totalTokens + codexBin.totalTokens;
  const totalInput = claudeBin.inputTokens + codexBin.inputTokens;
  const totalOutput = claudeBin.outputTokens + codexBin.outputTokens;
  const totalCache = claudeBin.cacheTokens + codexBin.cacheTokens;

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

  const claudeApi = toEstimateInput(claudeBin, true);
  const codexApi = toEstimateInput(codexBin, false);
  const totalApi = claudeApi && codexApi ? claudeApi.costUsd + codexApi.costUsd : undefined;

  const overviewSource = sourceInfo('mixedDayBucket', 'Today — combined', 'Claude and Codex today usage from 1D history bins.');
  return [
    {
      key: 'overviewTodayMessages',
      label: '1D Messages/Turns',
      value: formatCount(claudeBin.assistantMessages + codexBin.assistantMessages),
      detail: `Claude ${formatCount(claudeBin.assistantMessages)} · Codex ${formatCount(codexBin.assistantMessages)}`,
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayTokens',
      label: '1D Tokens',
      value: formatCount(totalTokens),
      detail: `Claude ${formatCount(claudeBin.totalTokens)} · Codex ${formatCount(codexBin.totalTokens)}`,
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayInputOutput',
      label: '1D Input / Output',
      value: `${formatCount(totalInput)} / ${formatCount(totalOutput)}`,
      detail: `Claude ${formatCount(claudeBin.inputTokens)} / ${formatCount(claudeBin.outputTokens)} · Codex ${formatCount(codexBin.inputTokens)} / ${formatCount(codexBin.outputTokens)}`,
      available: true,
      source: overviewSource
    },
    {
      key: 'overviewTodayCache',
      label: '1D Cache',
      value: formatCount(totalCache),
      detail: `Claude ${formatCount(claudeBin.cacheTokens)} · Codex ${formatCount(codexBin.cacheTokens)}`,
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
          ? 'API-equivalent is hidden unless all snapshot rows carry model and token component data.'
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
          ? 'API-equivalent is hidden unless all snapshot rows carry model and token component data.'
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

  return {
    available: claudeEnabled || codexEnabled || claudeAvailable || codexAvailable || Boolean(remoteClaude) || Boolean(remoteCodex),
    scopeLabel: scopeParts.length > 0 ? `Today — ${scopeParts.join('; ')}` : 'Today — no enabled providers',
    cards,
    ...(splitCards.length > 0 ? { splitCards } : {}),
    ...(claudeSectionLabel ? { claudeSectionLabel } : {}),
    ...(codexSectionLabel ? { codexSectionLabel } : {})
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
