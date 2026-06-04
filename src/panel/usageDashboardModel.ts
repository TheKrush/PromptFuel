import { LimitWindow, ProviderName, ProviderUsageState, SourceConfigEntry, UsageTracing } from '../types';
import type { ClaudeTodayUsageBucket } from '../providers/claudeDayBucketScanner';
import type { ClaudeUsageHistory } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../providers/codexCorrelatedDayBucketScanner';
import type { CodexCorrelatedHistory } from '../providers/codexCorrelatedDayBucketScanner';
import { sumCostIfComplete } from '../display/apiEquivalentCost';
import type { RemoteUsageProjection } from '../snapshot/remoteUsageProjection';
import { formatEpochToIso, formatEpochSecondsToIso, formatRelativeTime } from '../usageTime';
import { quotaLevelForRemaining } from '../display/format';

import {
  formatCount, formatUsd, formatPercent, formatPercentSuffix, clamp,
  normalizePercent, normalizePositiveNumber, firstNumber, addNumbers,
  sourceInfo, AUTH_DISABLED_STATUSES, formatProviderStatus, buildUnavailableBreakdownCard
} from './dashboard/format';

import { buildToday, buildTodayOverviewFromCharts } from './dashboard/today';
import {
  buildClaudeHistoryChart, buildCodexHistoryChart, buildCombinedHistoryChart,
  buildHistoryCards, buildCodexHistoryCards
} from './dashboard/historyChart';
import { buildClaudeModelDistribution, buildCodexModelDistribution } from './dashboard/modelDistribution';
import { annotateSourceConfidence } from './dashboard/sourceConfidence';

export interface UsageDashboardTab {
  key: string;
  label: string;
  isDefault?: boolean;
  provider?: 'claude' | 'codex';
}

export interface UsageDashboardModel {
  generatedAtIso: string;
  providers: UsageDashboardProvider[];
  today: UsageDashboardToday;
  details: UsageDashboardDetails;
  remoteProviders?: GroupedRemoteProvider[];
  tabs: UsageDashboardTab[];
  selectedTab: string;
}

export interface GroupedRemoteProvider {
  machineLabel: string;
  stale: boolean;
  lastUpdatedIso?: string;
  providers: UsageDashboardProvider[];
  hasSelectedSources?: boolean;
}

export interface UsageDashboardProvider {
  provider: 'claude' | 'codex';
  label: string;
  stale: boolean;
  source?: string;
  status?: string;
  error?: string;
  lastUpdatedIso?: string;
  lastAuthenticatedRefreshIso?: string;
  nextAuthenticatedRefreshIso?: string;
  windows: UsageDashboardWindow[];
  machineLabel?: string;
}

export interface UsageDashboardWindow {
  key: 'fiveHour' | 'sevenDay' | 'sevenDayOpus';
  label: '5h' | '7d' | 'opus 7d';
  usedPercent?: number;
  remainingPercent?: number;
  level?: UsageDashboardLevel;
  resetIso?: string;
  resetLabel?: string;
  available: boolean;
  source?: UsageDashboardSourceInfo;
}

export type UsageDashboardLevel = Exclude<import('../display/format').QuotaIndicatorLevel, 'unavailable'>;

export type UsageDashboardSourceConfidence =
  | 'trustedCompletedTurnUsage'
  | 'correlatedDayBucket'
  | 'mixedDayBucket'
  | 'quotaState'
  | 'snapshotOnly'
  | 'apiEquivalentEstimate'
  | 'unavailable';

export interface UsageDashboardSourceInfo {
  confidence: UsageDashboardSourceConfidence;
  label: string;
  detail?: string;
  unavailableReason?: string;
}

export interface UsageDashboardToday {
  available: boolean;
  scopeLabel: string;
  cards: UsageDashboardMetricCard[];
  splitCards?: UsageDashboardMetricCard[];
  source?: UsageDashboardSourceInfo;
  claudeSectionLabel?: string;
  codexSectionLabel?: string;
  overviewCards?: UsageDashboardMetricCard[];
}

export interface UsageDashboardDetails {
  available: boolean;
  scopeLabel: string;
  cards: UsageDashboardMetricCard[];
  providers: UsageDashboardProviderDetails[];
  historyChart?: UsageDashboardHistoryChart;
  modelDistribution?: UsageDashboardModelDistributionChart;
  codexHistoryChart?: UsageDashboardHistoryChart;
  codexModelDistribution?: UsageDashboardModelDistributionChart;
  combinedHistoryChart?: UsageDashboardHistoryChart;
  source?: UsageDashboardSourceInfo;
  claudeHistorySectionLabel?: string;
  codexHistorySectionLabel?: string;
  claudeModelDistributionSectionLabel?: string;
  codexModelDistributionSectionLabel?: string;
  combinedHistorySectionLabel?: string;
  combinedModelDistributionSectionLabel?: string;
  todayOverviewCards?: UsageDashboardMetricCard[];
  claudeSourceHistoryPanels?: UsageDashboardSourceHistoryPanel[];
  codexSourceHistoryPanels?: UsageDashboardSourceHistoryPanel[];
  claudeSourceModelDistributionPanels?: UsageDashboardSourceModelDistributionPanel[];
  codexSourceModelDistributionPanels?: UsageDashboardSourceModelDistributionPanel[];
}

export interface UsageDashboardSourceHistoryPanel {
  label: string;
  chart: UsageDashboardHistoryChart;
}

export interface UsageDashboardSourceModelDistributionPanel {
  label: string;
  distribution: UsageDashboardModelDistributionChart;
  historyChart?: UsageDashboardHistoryChart;
}

export interface UsageDashboardHistoryChart {
  available: boolean;
  title: string;
  rangeLabel: string;
  unavailableReason?: string;
  ranges: UsageDashboardHistoryChartRange[];
  points: UsageDashboardHistoryChartPoint[];
  maxTotalTokens: number;
  rangeViews?: import('./usageHistoryBinning').UsageHistoryRangeViews;
  granularity?: import('./usageHistoryBinning').UsageHistoryBinGranularity;
  granularityLabel?: string;
  axisLabel?: string;
  ariaLabel?: string;
  activeBinCount?: number;
  activeUnitLabel?: string;
  limitation?: string;
  source?: UsageDashboardSourceInfo;
}

export interface UsageDashboardHistoryChartRange {
  key: import('./usageHistoryBinning').UsageHistoryRangeKey;
  label: string;
  available: boolean;
  active: boolean;
}

export interface UsageDashboardHistoryChartPoint {
  dateKey: string;
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  assistantMessages: number;
  models: UsageDashboardHistoryChartModelUsage[];
  providerSegments?: UsageDashboardHistoryChartProviderSegment[];
  binStartDateKey?: string;
  binEndDateKey?: string;
  sourcePointCount?: number;
  isEmpty?: boolean;
  source?: 'local' | 'remote';
  sourceLabel?: string;
}

export interface UsageDashboardHistoryChartModelUsage {
  label: string;
  model: string;
  pricingModel?: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  assistantMessages: number;
}

export interface UsageDashboardHistoryChartProviderSegment {
  provider: 'claude' | 'codex';
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  assistantMessages: number;
  sourceConfidence?: UsageDashboardSourceConfidence;
}

export interface UsageDashboardModelDistributionChart {
  available: boolean;
  title: string;
  rangeLabel: string;
  totalTokens: number;
  segments: UsageDashboardModelDistributionSegment[];
  unavailableReason?: string;
  source?: UsageDashboardSourceInfo;
}

export interface UsageDashboardModelDistributionSegment {
  label: string;
  model: string;
  totalTokens: number;
  assistantMessages: number;
  percent: number;
  percentLabel: string;
}

export interface UsageDashboardMetricCard {
  key: string;
  label: string;
  value: string;
  detail?: string;
  detailLines?: string[];
  detailTooltip?: string;
  available: boolean;
  source?: UsageDashboardSourceInfo;
}

export interface UsageDashboardProviderDetails {
  provider: 'claude' | 'codex';
  label: string;
  model?: string;
  workspace?: string;
  totalTokens?: number;
  currentTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  apiEquivalentCostUsd?: number;
  available: boolean;
  source?: UsageDashboardSourceInfo;
}

interface NumericAggregate {
  totalTokens: number;
  currentTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  apiEquivalentCostUsd: number;
}

export interface BuildUsageDashboardModelOptions {
  states: ProviderUsageState[];
  claudeTodayUsage?: ClaudeTodayUsageBucket;
  claudeUsageHistory?: ClaudeUsageHistory;
  codexCorrelatedHistory?: CodexCorrelatedHistory;
  codexTodayUsage?: CodexCorrelatedDayBucket;
  enabledProviders?: ProviderName[];
  remoteProviderGroups?: GroupedRemoteProvider[];
  selectedRemoteProviders?: UsageDashboardProvider[];
  remoteUsage?: RemoteUsageProjection;
  aliasMap?: Record<string, string>;
  normalizedSources?: Record<string, SourceConfigEntry>;
  scopedToProvider?: ProviderName;
}

export function buildUsageDashboardModel(options: BuildUsageDashboardModelOptions): UsageDashboardModel {
  const {
    states,
    claudeTodayUsage,
    claudeUsageHistory,
    codexCorrelatedHistory,
    codexTodayUsage,
    enabledProviders,
    remoteProviderGroups,
    selectedRemoteProviders,
    remoteUsage,
    aliasMap,
    normalizedSources,
    scopedToProvider
  } = options;
  const ep = enabledProviders ? new Set(enabledProviders) : new Set(states.map(s => s.provider));
  const hasRemoteClaude = Boolean(
    remoteUsage?.claudeToday ||
    remoteUsage?.claudeHistoryPoints?.length ||
    remoteUsage?.claudeModelEntries?.length
  );
  const hasRemoteCodex = Boolean(
    remoteUsage?.codexToday ||
    remoteUsage?.codexHistoryPoints?.length ||
    remoteUsage?.codexModelEntries?.length
  );
  const claudeEnabled = ep.has('claude') || hasRemoteClaude;
  const codexEnabled = ep.has('codex') || hasRemoteCodex;

  const localProviders = states.map(s => buildProvider(s, normalizedSources));
  const allProviders = selectedRemoteProviders && selectedRemoteProviders.length > 0
    ? [...localProviders, ...selectedRemoteProviders]
    : localProviders;

  const selectedSourceKeys = new Set(
    (selectedRemoteProviders ?? [])
      .filter(p => p.machineLabel)
      .map(p => `${p.machineLabel}/${p.provider}`)
  );

  const filteredRemoteGroups = remoteProviderGroups && remoteProviderGroups.length > 0
    ? remoteProviderGroups
      .map(group => {
        if (selectedSourceKeys.size === 0) {
          return group;
        }
        const remaining = group.providers.filter(
          p => !selectedSourceKeys.has(`${p.machineLabel ?? group.machineLabel}/${p.provider}`)
        );
        const hasSelectedSources = remaining.length < group.providers.length;
        return hasSelectedSources ? { ...group, providers: remaining, hasSelectedSources } : group;
      })
      .filter(group => group.providers.length > 0 || group.hasSelectedSources)
    : undefined;

  const effectiveClaudeEnabled = scopedToProvider ? scopedToProvider === 'claude' : claudeEnabled;
  const effectiveCodexEnabled = scopedToProvider ? scopedToProvider === 'codex' : codexEnabled;
  const scopedProviders = scopedToProvider
    ? allProviders.filter(p => p.provider === scopedToProvider)
    : allProviders;

  const tabs = buildProviderTabs(claudeEnabled, codexEnabled, allProviders, normalizedSources);

  const model: UsageDashboardModel = {
    generatedAtIso: new Date().toISOString(),
    providers: scopedProviders,
    ...(() => {
      const details = buildDetails(states, claudeUsageHistory, codexCorrelatedHistory, effectiveClaudeEnabled, effectiveCodexEnabled, remoteUsage, aliasMap, normalizedSources);
      const today = buildToday(claudeTodayUsage, codexTodayUsage, effectiveClaudeEnabled, effectiveCodexEnabled, remoteUsage, aliasMap);
      return {
        today: today.overviewCards ? today : details.todayOverviewCards ? { ...today, overviewCards: details.todayOverviewCards } : today,
        details
      };
    })(),
    ...(filteredRemoteGroups && filteredRemoteGroups.length > 0 ? { remoteProviders: filteredRemoteGroups } : {}),
    tabs,
    selectedTab: scopedToProvider ?? 'overview'
  };

  return annotateSourceConfidence(model, claudeTodayUsage, codexTodayUsage, remoteUsage);
}

function sourceLabel(provider: string, normalizedSources?: Record<string, SourceConfigEntry>): string {
  return normalizedSources?.[provider]?.label ?? (provider === 'claude' ? 'Claude' : 'Codex');
}

function buildProviderTabs(
  claudeEnabled: boolean,
  codexEnabled: boolean,
  allProviders: UsageDashboardProvider[],
  normalizedSources?: Record<string, SourceConfigEntry>
): UsageDashboardTab[] {
  const tabs: UsageDashboardTab[] = [
    { key: 'overview', label: 'Overview', isDefault: true }
  ];

  const seen = new Set<string>();

  if (claudeEnabled) {
    seen.add('claude');
    tabs.push({ key: 'claude', label: sourceLabel('claude', normalizedSources), provider: 'claude' });
  }

  if (codexEnabled) {
    seen.add('codex');
    tabs.push({ key: 'codex', label: sourceLabel('codex', normalizedSources), provider: 'codex' });
  }

  for (const provider of allProviders) {
    if (!seen.has(provider.provider)) {
      seen.add(provider.provider);
      tabs.push({
        key: provider.provider,
        label: provider.label || provider.provider,
        provider: provider.provider
      });
    }
  }

  return tabs;
}

function buildProvider(state: ProviderUsageState, normalizedSources?: Record<string, SourceConfigEntry>): UsageDashboardProvider {
  return {
    provider: state.provider,
    label: normalizedSources?.[state.provider]?.label ?? (state.provider === 'claude' ? 'Claude' : 'Codex'),
    stale: Boolean(state.stale),
    source: state.source,
    status: formatProviderStatus(state.authenticatedStatus),
    error: state.error ?? (state.authenticatedStatus && !AUTH_DISABLED_STATUSES.has(state.authenticatedStatus) ? state.authenticatedError : undefined),
    lastUpdatedIso: formatEpochToIso(state.lastUpdatedEpochMs),
    lastAuthenticatedRefreshIso: formatEpochToIso(state.lastAuthenticatedRefreshEpochMs),
    nextAuthenticatedRefreshIso: formatEpochToIso(state.nextAuthenticatedRefreshEpochMs),
    windows: [
      buildWindow('sevenDay', '7d', state.sevenDay),
      buildWindow('fiveHour', '5h', state.fiveHour),
      ...(state.sevenDayOpus?.usedPercentage !== undefined
        ? [buildWindow('sevenDayOpus', 'opus 7d', state.sevenDayOpus)]
        : [])
    ]
  };
}

function buildWindow(
  key: 'fiveHour' | 'sevenDay' | 'sevenDayOpus',
  label: '5h' | '7d' | 'opus 7d',
  window: LimitWindow | undefined
): UsageDashboardWindow {
  const usedPercent = normalizePercent(window?.usedPercentage);
  const remainingPercent = usedPercent === undefined ? undefined : clamp(100 - usedPercent, 0, 100);
  const level = remainingPercent === undefined ? undefined : quotaLevelForRemaining(remainingPercent);

  return {
    key,
    label,
    usedPercent,
    remainingPercent,
    level: level === 'unavailable' ? undefined : level,
    resetIso: formatEpochSecondsToIso(window?.resetsAtEpochSeconds),
    resetLabel: formatRelativeTime(window?.resetsAtEpochSeconds),
    available: usedPercent !== undefined
  };
}

function buildDetails(
  states: ProviderUsageState[],
  claudeUsageHistory?: ClaudeUsageHistory,
  codexCorrelatedHistory?: CodexCorrelatedHistory,
  claudeEnabled = true,
  codexEnabled = true,
  remoteUsage?: RemoteUsageProjection,
  aliasMap?: Record<string, string>,
  normalizedSources?: Record<string, SourceConfigEntry>
): UsageDashboardDetails {
  const providers = states.map(s => buildProviderDetails(s, normalizedSources));
  const availableProviders = providers.filter(provider => provider.available);
  const totals = aggregateProviders(availableProviders);
  const remoteClaudeHistPoints = remoteUsage?.claudeHistoryPoints?.length ? remoteUsage.claudeHistoryPoints : undefined;
  const remoteCodexHistPoints = remoteUsage?.codexHistoryPoints?.length ? remoteUsage.codexHistoryPoints : undefined;
  const remoteClaudeModels = remoteUsage?.claudeModelEntries?.length ? remoteUsage.claudeModelEntries : undefined;
  const remoteCodexModels = remoteUsage?.codexModelEntries?.length ? remoteUsage.codexModelEntries : undefined;
  const cml = remoteUsage?.contributingMachineLabels;
  const claudeHistRemote = cml?.claudeHistory.length ? cml.claudeHistory : undefined;
  const codexHistRemote = cml?.codexHistory.length ? cml.codexHistory : undefined;
  const claudeModelRemote = cml?.claudeModels.length ? cml.claudeModels : undefined;
  const codexModelRemote = cml?.codexModels.length ? cml.codexModels : undefined;
  const historyChart = claudeEnabled ? buildClaudeHistoryChart(claudeUsageHistory, remoteClaudeHistPoints, aliasMap, claudeHistRemote) : undefined;
  const codexHistoryChart = codexEnabled ? buildCodexHistoryChart(codexCorrelatedHistory, remoteCodexHistPoints, aliasMap, codexHistRemote) : undefined;
  const providerApiEquivalentCostUsd = sumCostIfComplete(availableProviders.map(provider => ({
    costUsd: provider.apiEquivalentCostUsd
  })));

  const available = availableProviders.length > 0;
  const snapshotSource = sourceInfo(
    'snapshotOnly',
    'Current normalized provider snapshot',
    'Snapshot counters are not daily history.'
  );

  const cards: UsageDashboardMetricCard[] = [
    {
      key: 'currentTokens',
      label: 'Current snapshot',
      value: available ? formatCount(totals.currentTokens) : 'Unavailable',
      detail: available ? 'Latest normalized token snapshot' : 'No safe token data available yet',
      available
    },
    {
      key: 'totalTokens',
      label: 'Provider total snapshot',
      value: available ? formatCount(totals.totalTokens) : 'Unavailable',
      detail: available ? 'Provider-reported total snapshot where available' : 'No safe token data available yet',
      available
    },
    {
      key: 'cache',
      label: 'Cache snapshot',
      value: available ? formatCount(totals.cacheReadTokens + totals.cacheWriteTokens) : 'Unavailable',
      detail: available
        ? `${formatCount(totals.cacheReadTokens)} read · ${formatCount(totals.cacheWriteTokens)} write`
        : 'No safe cache data available yet',
      available
    },
    {
      key: 'apiEquivalent',
      label: 'API-equivalent value',
      value: providerApiEquivalentCostUsd !== undefined ? formatUsd(providerApiEquivalentCostUsd) : 'Unavailable',
      detail: providerApiEquivalentCostUsd !== undefined
        ? 'Estimate · not actual billing'
        : 'No safe cost estimate available yet',
      detailTooltip: providerApiEquivalentCostUsd !== undefined
        ? 'Estimate from normalized provider tracing; not actual billing'
        : undefined,
      available: providerApiEquivalentCostUsd !== undefined
    },
    ...(claudeEnabled ? buildHistoryCards(claudeUsageHistory, remoteClaudeModels) : []),
    ...(codexEnabled ? buildCodexHistoryCards(codexCorrelatedHistory, remoteCodexModels) : []),
    ...buildBreakdownCards(availableProviders, totals, snapshotSource)
  ];

  const modelDistribution = claudeEnabled ? buildClaudeModelDistribution(claudeUsageHistory, remoteClaudeModels) : undefined;
  const codexModelDistribution = codexEnabled ? buildCodexModelDistribution(codexCorrelatedHistory, remoteCodexModels) : undefined;

  const claudeHistorySectionLabel = claudeEnabled && (historyChart?.available || claudeHistRemote)
    ? buildSectionLabel(['Claude'], claudeHistRemote ?? [], 'claude', aliasMap)
    : undefined;
  const codexHistorySectionLabel = codexEnabled && (codexHistoryChart?.available || codexHistRemote)
    ? buildSectionLabel(['Codex'], codexHistRemote ?? [], 'codex', aliasMap)
    : undefined;
  const claudeModelDistributionSectionLabel = claudeEnabled && (modelDistribution?.available || claudeModelRemote)
    ? buildSectionLabel(['Claude'], claudeModelRemote ?? [], 'claude', aliasMap)
    : undefined;
  const codexModelDistributionSectionLabel = codexEnabled && (codexModelDistribution?.available || codexModelRemote)
    ? buildSectionLabel(['Codex'], codexModelRemote ?? [], 'codex', aliasMap)
    : undefined;
  const claudeSourceHistoryPanels = claudeEnabled
    ? buildSourceHistoryPanels('Claude', 'claude', claudeUsageHistory?.available ? buildClaudeHistoryChart(claudeUsageHistory) : undefined, remoteClaudeHistPoints?.length ? buildClaudeHistoryChart(undefined, remoteClaudeHistPoints, aliasMap, claudeHistRemote) : undefined, claudeHistRemote, aliasMap)
    : undefined;
  const codexSourceHistoryPanels = codexEnabled
    ? buildSourceHistoryPanels('Codex', 'codex', codexCorrelatedHistory?.available ? buildCodexHistoryChart(codexCorrelatedHistory) : undefined, remoteCodexHistPoints?.length ? buildCodexHistoryChart(undefined, remoteCodexHistPoints, aliasMap, codexHistRemote) : undefined, codexHistRemote, aliasMap)
    : undefined;
  const claudeSourceModelDistributionPanels = claudeEnabled
    ? buildSourceModelDistributionPanels('Claude', 'claude', claudeUsageHistory?.available ? buildClaudeModelDistribution(claudeUsageHistory) : undefined, claudeSourceHistoryPanels?.find(panel => panel.label === 'Claude')?.chart, remoteClaudeModels?.length ? buildClaudeModelDistribution(undefined, remoteClaudeModels) : undefined, claudeSourceHistoryPanels?.find(panel => panel.label !== 'Claude')?.chart, claudeModelRemote, aliasMap)
    : undefined;
  const codexSourceModelDistributionPanels = codexEnabled
    ? buildSourceModelDistributionPanels('Codex', 'codex', codexCorrelatedHistory?.available ? buildCodexModelDistribution(codexCorrelatedHistory) : undefined, codexSourceHistoryPanels?.find(panel => panel.label === 'Codex')?.chart, remoteCodexModels?.length ? buildCodexModelDistribution(undefined, remoteCodexModels) : undefined, codexSourceHistoryPanels?.find(panel => panel.label !== 'Codex')?.chart, codexModelRemote, aliasMap)
    : undefined;

  function buildCombinedSectionLabel(
    baseLabels: string[],
    claudeRemoteLabels: string[] | undefined,
    codexRemoteLabels: string[] | undefined,
    aliasMap?: Record<string, string>
  ): string {
    if (!claudeRemoteLabels?.length && !codexRemoteLabels?.length) {
      return baseLabels.join(' + ');
    }
    const parts = [...baseLabels];
    const seen = new Set(parts);
    if (claudeRemoteLabels) {
      for (const ml of claudeRemoteLabels) {
        const alias = aliasMap?.[ml] ?? ml;
        const label = `Claude ${alias}`;
        if (!seen.has(label)) { seen.add(label); parts.push(label); }
      }
    }
    if (codexRemoteLabels) {
      for (const ml of codexRemoteLabels) {
        const alias = aliasMap?.[ml] ?? ml;
        const label = `Codex ${alias}`;
        if (!seen.has(label)) { seen.add(label); parts.push(label); }
      }
    }
    return parts.join(' + ');
  }

  const combinedBase = [claudeEnabled ? 'Claude' : '', codexEnabled ? 'Codex' : ''].filter(Boolean);
  const combinedHistorySectionLabel = combinedBase.length >= 2
    ? buildCombinedSectionLabel(combinedBase, claudeHistRemote, codexHistRemote, aliasMap)
    : undefined;
  const combinedModelDistributionSectionLabel = combinedBase.length >= 2
    ? buildCombinedSectionLabel(combinedBase, claudeModelRemote, codexModelRemote, aliasMap)
    : undefined;

  const todayOverviewCards = buildTodayOverviewFromCharts(historyChart, codexHistoryChart, claudeEnabled, codexEnabled);

  return {
    available,
    scopeLabel: 'Current normalized provider snapshot — not daily history yet',
    cards,
    providers,
    historyChart,
    modelDistribution,
    codexHistoryChart,
    codexModelDistribution,
    combinedHistoryChart: buildCombinedHistoryChart(historyChart, codexHistoryChart),
    claudeHistorySectionLabel,
    codexHistorySectionLabel,
    claudeModelDistributionSectionLabel,
    codexModelDistributionSectionLabel,
    combinedHistorySectionLabel,
    combinedModelDistributionSectionLabel,
    ...(claudeSourceHistoryPanels ? { claudeSourceHistoryPanels } : {}),
    ...(codexSourceHistoryPanels ? { codexSourceHistoryPanels } : {}),
    ...(claudeSourceModelDistributionPanels ? { claudeSourceModelDistributionPanels } : {}),
    ...(codexSourceModelDistributionPanels ? { codexSourceModelDistributionPanels } : {}),
    ...(todayOverviewCards ? { todayOverviewCards } : {})
  };
}

function buildSourceHistoryPanels(
  localLabel: 'Claude' | 'Codex',
  provider: 'claude' | 'codex',
  localChart: UsageDashboardHistoryChart | undefined,
  remoteChart: UsageDashboardHistoryChart | undefined,
  remoteMachineLabels: string[] | undefined,
  aliasMap?: Record<string, string>
): { label: string; chart: UsageDashboardHistoryChart }[] | undefined {
  const panels: { label: string; chart: UsageDashboardHistoryChart }[] = [];
  if (localChart?.available) {
    panels.push({ label: localLabel, chart: localChart });
  }
  if (remoteChart?.available) {
    panels.push({
      label: buildRemoteOnlySectionLabel(localLabel, provider, remoteMachineLabels, aliasMap),
      chart: remoteChart
    });
  }
  return panels.length > 1 ? panels : undefined;
}

function buildSourceModelDistributionPanels(
  localLabel: 'Claude' | 'Codex',
  provider: 'claude' | 'codex',
  localDistribution: UsageDashboardModelDistributionChart | undefined,
  localHistoryChart: UsageDashboardHistoryChart | undefined,
  remoteDistribution: UsageDashboardModelDistributionChart | undefined,
  remoteHistoryChart: UsageDashboardHistoryChart | undefined,
  remoteMachineLabels: string[] | undefined,
  aliasMap?: Record<string, string>
): { label: string; distribution: UsageDashboardModelDistributionChart; historyChart?: UsageDashboardHistoryChart }[] | undefined {
  const panels: { label: string; distribution: UsageDashboardModelDistributionChart; historyChart?: UsageDashboardHistoryChart }[] = [];
  if (localDistribution?.available) {
    panels.push({ label: localLabel, distribution: localDistribution, ...(localHistoryChart ? { historyChart: localHistoryChart } : {}) });
  }
  if (remoteDistribution?.available) {
    panels.push({
      label: buildRemoteOnlySectionLabel(localLabel, provider, remoteMachineLabels, aliasMap),
      distribution: remoteDistribution,
      ...(remoteHistoryChart ? { historyChart: remoteHistoryChart } : {})
    });
  }
  return panels.length > 1 ? panels : undefined;
}

function buildRemoteOnlySectionLabel(
  localLabel: 'Claude' | 'Codex',
  provider: 'claude' | 'codex',
  remoteMachineLabels: string[] | undefined,
  aliasMap?: Record<string, string>
): string {
  const label = buildSectionLabel([], remoteMachineLabels ?? [], provider, aliasMap);
  return label || `${localLabel} snapshot`;
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

function buildBreakdownCards(
  providers: UsageDashboardProviderDetails[],
  totals: NumericAggregate,
  snapshotSource: UsageDashboardSourceInfo
): UsageDashboardMetricCard[] {
  return [
    buildModelBreakdownCard(providers, totals, snapshotSource),
    buildCachePerformanceCard(totals, snapshotSource),
    buildUnavailableBreakdownCard(
      'projectUsageBreakdown',
      'Project usage',
      'No sanitized project/workspace breakdown is available yet.'
    ),
    buildUnavailableBreakdownCard(
      'toolUsageBreakdown',
      'Tool usage',
      'No safe tool-call aggregation is available yet.'
    )
  ];
}

function buildModelBreakdownCard(
  providers: UsageDashboardProviderDetails[],
  totals: NumericAggregate,
  snapshotSource: UsageDashboardSourceInfo
): UsageDashboardMetricCard {
  const entries = providers
    .map(provider => ({
      label: provider.model ? `${provider.label}: ${provider.model}` : provider.label,
      tokens: provider.currentTokens ?? provider.totalTokens ?? 0
    }))
    .filter(entry => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  if (entries.length === 0) {
    return buildUnavailableBreakdownCard(
      'modelBreakdown',
      'Model breakdown',
      'No safe model/token breakdown is available yet.'
    );
  }

  const total = entries.reduce((sum, entry) => sum + entry.tokens, 0) || totals.currentTokens || totals.totalTokens;
  const detail = entries
    .slice(0, 3)
    .map(entry => `${entry.label} ${formatCount(entry.tokens)}${formatPercentSuffix(entry.tokens, total)}`)
    .join(' · ');

  return {
    key: 'modelBreakdown',
    label: 'Model breakdown',
    value: `${entries.length} model${entries.length === 1 ? '' : 's'}`,
    detail,
    available: true,
    source: snapshotSource
  };
}

function buildCachePerformanceCard(
  totals: NumericAggregate,
  snapshotSource: UsageDashboardSourceInfo
): UsageDashboardMetricCard {
  const cacheTokens = totals.cacheReadTokens + totals.cacheWriteTokens;
  if (cacheTokens <= 0) {
    return buildUnavailableBreakdownCard(
      'cachePerformance',
      'Cache performance',
      'No safe cache read/write breakdown is available yet.'
    );
  }

  const readPercent = totals.cacheReadTokens / cacheTokens;
  return {
    key: 'cachePerformance',
    label: 'Cache performance',
    value: `${formatPercent(readPercent)} read`,
    detail: `${formatCount(totals.cacheReadTokens)} read · ${formatCount(totals.cacheWriteTokens)} write/creation`,
    available: true,
    source: snapshotSource
  };
}

function buildProviderDetails(state: ProviderUsageState, normalizedSources?: Record<string, SourceConfigEntry>): UsageDashboardProviderDetails {
  const tracing = state.tracing;
  const available = hasAnyTracingValue(tracing);

  return {
    provider: state.provider,
    label: normalizedSources?.[state.provider]?.label ?? (state.provider === 'claude' ? 'Claude' : 'Codex'),
    model: state.model,
    workspace: state.workspace,
    totalTokens: firstNumber(tracing?.totalTokens, addNumbers(tracing?.totalInputTokens, tracing?.totalOutputTokens)),
    currentTokens: firstNumber(tracing?.currentTotalTokens, addNumbers(tracing?.currentInputTokens, tracing?.currentOutputTokens)),
    inputTokens: firstNumber(tracing?.currentInputTokens, tracing?.totalInputTokens),
    outputTokens: firstNumber(tracing?.currentOutputTokens, tracing?.totalOutputTokens),
    cacheReadTokens: firstNumber(tracing?.currentCacheReadInputTokens, tracing?.totalCachedInputTokens, tracing?.currentCachedInputTokens),
    cacheWriteTokens: addNumbers(
      tracing?.currentCacheCreationInputTokens,
      tracing?.currentEphemeral1hCacheCreationInputTokens,
      tracing?.currentEphemeral5mCacheCreationInputTokens
    ),
    reasoningTokens: firstNumber(tracing?.currentReasoningOutputTokens, tracing?.totalReasoningOutputTokens),
    apiEquivalentCostUsd: normalizePositiveNumber(tracing?.totalCostUsd),
    available
  };
}

function aggregateProviders(providers: UsageDashboardProviderDetails[]): NumericAggregate {
  return providers.reduce<NumericAggregate>(
    (totals, provider) => ({
      totalTokens: totals.totalTokens + (provider.totalTokens ?? 0),
      currentTokens: totals.currentTokens + (provider.currentTokens ?? 0),
      inputTokens: totals.inputTokens + (provider.inputTokens ?? 0),
      outputTokens: totals.outputTokens + (provider.outputTokens ?? 0),
      cacheReadTokens: totals.cacheReadTokens + (provider.cacheReadTokens ?? 0),
      cacheWriteTokens: totals.cacheWriteTokens + (provider.cacheWriteTokens ?? 0),
      reasoningTokens: totals.reasoningTokens + (provider.reasoningTokens ?? 0),
      apiEquivalentCostUsd: totals.apiEquivalentCostUsd + (provider.apiEquivalentCostUsd ?? 0)
    }),
    {
      totalTokens: 0,
      currentTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      apiEquivalentCostUsd: 0
    }
  );
}

function hasAnyTracingValue(tracing: UsageTracing | undefined): boolean {
  if (!tracing) {
    return false;
  }

  return [
    tracing.totalCostUsd,
    tracing.totalInputTokens,
    tracing.totalOutputTokens,
    tracing.totalCachedInputTokens,
    tracing.totalReasoningOutputTokens,
    tracing.totalTokens,
    tracing.currentInputTokens,
    tracing.currentOutputTokens,
    tracing.currentCachedInputTokens,
    tracing.currentReasoningOutputTokens,
    tracing.currentTotalTokens,
    tracing.currentCacheCreationInputTokens,
    tracing.currentCacheReadInputTokens,
    tracing.currentEphemeral1hCacheCreationInputTokens,
    tracing.currentEphemeral5mCacheCreationInputTokens
  ].some(value => typeof value === 'number' && Number.isFinite(value));
}

export { AUTH_DISABLED_STATUSES, shortenClaudeModel, shortenCodexModel } from './dashboard/format';
