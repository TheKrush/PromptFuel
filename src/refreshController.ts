import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getConfig } from './config';
import { formatStatus } from './display/format';
import { buildStatusHoverModelBreakdown, type HistoryModelUsage, STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS } from './display/modelBreakdown';
import { logPromptFuel } from './logger';
import { mergeAuthenticatedFailure, mergeAuthenticatedQuotaSuccess, mergeLocalAndAuthenticated, type QuotaMergeOptions } from './quota/merge';
import {
  fetchAuthenticatedQuota,
  readAuthenticatedQuotaCache,
  writeAuthenticatedQuotaCache
} from './providers/authenticatedQuota';
import { readClaudeBridgeState } from './providers/claudeBridge';
import {
  type ClaudeHistoryModelUsage,
  type ClaudeTodayUsageBucket,
  type ClaudeUsageHistory,
  readClaudeRecentUsageHistory,
  readClaudeTodayUsageBucket
} from './providers/claudeDayBucketScanner';
import {
  type CodexCorrelatedDayBucket,
  type CodexCorrelatedHistory,
  type CodexCorrelatedHistoryModelUsage,
  readCodexCorrelatedHistory,
  readCodexCorrelatedTodayBucket
} from './providers/codexCorrelatedDayBucketScanner';
import { readCodexUsageState } from './providers/codexSessionScanner';
import { readCodexBridgeState } from './providers/codexState';
import { estimateClaudeCostUsd, estimateCodexCostUsd } from './providers/pricing';
import { calculateAuthenticatedBackoffSeconds, getAuthenticatedRefreshGate } from './quota/refreshPolicy';
import { getNextResetRefreshPlan, type ResetRefreshPlan } from './quota/resetRefresh';
import { postUsageDashboardRefreshIfOpen } from './panel/promptFuelPanel';
import { buildUsageDashboardModel, shortenClaudeModel, shortenCodexModel, type UsageDashboardProvider } from './panel/usageDashboardModel';
import {
  buildRemoteProvidersFromSnapshots,
  buildSanitizedHistorySources,
  buildSelectedRemoteSourceProviders,
  readMachineSnapshots,
  type GroupedRemoteProvider,
  type ReadSnapshotResult
} from './snapshot/readMachineSnapshots';
import { aggregateSnapshotBucketModels, buildRemoteUsageProjection, type RemoteUsageProjection } from './snapshot/remoteUsageProjection';
import { writeMachineSnapshotIfEnabled, type ModelContributionInput, type ProviderHistoryInput } from './snapshot/writeMachineSnapshot';
import { type ProviderName, type ProviderUsageState } from './types';
import { RESET_EXPIRY_GRACE_MS } from './usageTime';
import { buildRemoteStatusBarItems } from './statusBar';
import { cancelDebouncedRefresh, markSnapshotSelfWriteTargets } from './watchers';

export interface RefreshOptions {
  allowAuthenticated?: boolean;
  manual?: boolean;
  bypassAuthenticatedPollDelay?: boolean;
  bypassAuthenticatedBackoff?: boolean;
  suppressPanelBroadcast?: boolean;
}

const MIN_BYPASS_BACKOFF_INTERVAL_MS = 60_000;

const authState = {
  cache: {} as Partial<Record<ProviderName, ProviderUsageState>>,
  nextPollEpochMs: {} as Partial<Record<ProviderName, number>>,
  backoffEpochMs: {} as Partial<Record<ProviderName, number>>,
  lastBypassAttemptEpochMs: {} as Partial<Record<ProviderName, number>>,
  consecutiveFailures: {} as Partial<Record<ProviderName, number>>,
  recentResetRefreshAttemptEpochMs: new Map<string, number>()
};

const latest = {
  providerStates: [] as ProviderUsageState[],
  claudeTodayUsage: undefined as ClaudeTodayUsageBucket | undefined,
  claudeUsageHistory: undefined as ClaudeUsageHistory | undefined,
  codexCorrelatedHistory: undefined as CodexCorrelatedHistory | undefined,
  codexCorrelatedTodayUsage: undefined as CodexCorrelatedDayBucket | undefined,
  remoteProviderGroups: [] as GroupedRemoteProvider[],
  selectedRemoteProviders: [] as UsageDashboardProvider[],
  remoteUsage: undefined as RemoteUsageProjection | undefined
};

const historyScanCache = {
  claude: undefined as {
    dirPath: string;
    dateKey: string;
    fingerprint: string;
    today: ClaudeTodayUsageBucket;
    history: ClaudeUsageHistory;
  } | undefined,
  codex: undefined as {
    dirPath: string;
    dateKey: string;
    fingerprint: string;
    today: CodexCorrelatedDayBucket;
    history: CodexCorrelatedHistory;
  } | undefined
};

const refreshState = {
  inFlight: undefined as Promise<void> | undefined,
  queuedOptions: undefined as RefreshOptions | undefined
};

let resetRefreshTimer: NodeJS.Timeout | undefined;
let scheduledResetRefreshEpochMs: number | undefined;

let _onStatusUpdate: ((text: string, tooltip: string) => void) | undefined;

export function initRefreshController(deps: {
  onStatusUpdate: (text: string, tooltip: string) => void;
}): void {
  _onStatusUpdate = deps.onStatusUpdate;
}

export function getLatestUsageState() {
  return latest;
}

export function clearResetRefreshTimer(): void {
  if (resetRefreshTimer) {
    clearTimeout(resetRefreshTimer);
    resetRefreshTimer = undefined;
  }
  scheduledResetRefreshEpochMs = undefined;
}

function logSwallowedError(context: string, err: unknown): void {
  logPromptFuel(`${context} failed`, err);
}

function getLocalDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function computeDirectoryDigest(dir: string, ext: string): Promise<string> {
  const parts: string[] = [];

  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 8) { return; }

    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(ext)) { continue; }
      try {
        const stat = await fs.stat(full);
        parts.push(`${full}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        // skip files that disappear during scan
      }
    }
  }

  await walk(dir, 0);
  parts.sort();
  return parts.join('|');
}

function toModelContribution(m: ClaudeHistoryModelUsage): ModelContributionInput;
function toModelContribution(m: CodexCorrelatedHistoryModelUsage): ModelContributionInput;
function toModelContribution(m: ClaudeHistoryModelUsage | CodexCorrelatedHistoryModelUsage): ModelContributionInput {
  const base: ModelContributionInput = {
    model: m.model,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreationTokens: m.cacheCreationInputTokens,
    cacheReadTokens: m.cacheReadInputTokens,
  };
  if ('reasoningOutputTokens' in m) {
    return {
      ...base,
      reasoningOutputTokens: m.reasoningOutputTokens,
      turns: m.assistantMessages
    };
  }
  return {
    ...base,
    assistantMessages: m.assistantMessages
  };
}

function mergeCodexBridgeStatusIntoSessionState(
  bridgeState: ProviderUsageState | undefined,
  sessionState: ProviderUsageState
): ProviderUsageState {
  if (!bridgeState) {
    return sessionState;
  }

  const bridgeDetail = bridgeState.error
    ? `Codex completed-turn bridge: ${bridgeState.error}`
    : 'Codex completed-turn bridge status file is present.';

  const sessionHasSnapshotData = Boolean(
    sessionState.fiveHour ||
    sessionState.sevenDay ||
    sessionState.model ||
    sessionState.tracing ||
    sessionState.diagnostics?.usageFieldsFound ||
    sessionState.diagnostics?.quotaFieldsFound
  );

  if (!sessionHasSnapshotData) {
    return {
      ...bridgeState,
      diagnostics: {
        ...sessionState.diagnostics,
        ...bridgeState.diagnostics
      }
    };
  }

  return {
    ...sessionState,
    error: sessionState.error
      ? `${sessionState.error} ${bridgeDetail}`
      : bridgeDetail,
    ignoredQuotaSource: bridgeState.source,
    diagnostics: {
      ...sessionState.diagnostics,
      usageFieldsFound: Boolean(sessionState.diagnostics?.usageFieldsFound || bridgeState.diagnostics?.usageFieldsFound),
      quotaFieldsFound: Boolean(sessionState.diagnostics?.quotaFieldsFound || bridgeState.diagnostics?.quotaFieldsFound)
    }
  };
}

function markLocal(state: ProviderUsageState): ProviderUsageState {
  return {
    ...state,
    lastLocalUpdateEpochMs: state.lastUpdatedEpochMs
  };
}

function patchState(
  current: ProviderUsageState | undefined,
  patch: Partial<ProviderUsageState>
): ProviderUsageState | undefined {
  if (!current) {
    return undefined;
  }
  return { ...current, ...patch };
}

function annotateAuthenticatedDisabled(
  current: ProviderUsageState | undefined,
  status: 'disabled' | 'skipped',
  message: string
): ProviderUsageState | undefined {
  return patchState(current, { authenticatedStatus: status, authenticatedError: message });
}

function annotateBackoff(current: ProviderUsageState | undefined, backoffUntil: number): ProviderUsageState | undefined {
  return patchState(current, {
    authenticatedStatus: 'backoff',
    authenticatedBackoffUntilEpochMs: backoffUntil,
    authenticatedError: `Authenticated refresh is in backoff until ${new Date(backoffUntil).toLocaleString()}.`
  });
}

function annotateNextRefresh(current: ProviderUsageState | undefined, nextRefresh: number): ProviderUsageState | undefined {
  return patchState(current, { nextAuthenticatedRefreshEpochMs: nextRefresh });
}

function mergeRefreshOptions(
  current: RefreshOptions | undefined,
  incoming: RefreshOptions
): RefreshOptions {
  if (!current) {
    return { ...incoming };
  }
  return {
    allowAuthenticated: current.allowAuthenticated || incoming.allowAuthenticated,
    manual: current.manual || incoming.manual,
    bypassAuthenticatedPollDelay: current.bypassAuthenticatedPollDelay || incoming.bypassAuthenticatedPollDelay,
    bypassAuthenticatedBackoff: current.bypassAuthenticatedBackoff || incoming.bypassAuthenticatedBackoff,
    suppressPanelBroadcast: current.suppressPanelBroadcast || incoming.suppressPanelBroadcast
  };
}

function hasExpiredQuotaWindow(state: ProviderUsageState | undefined, nowEpochMs: number): boolean {
  if (!state) {
    return false;
  }
  return isExpiredWindow(state.fiveHour, nowEpochMs) || isExpiredWindow(state.sevenDay, nowEpochMs);
}

function isExpiredWindow(window: ProviderUsageState['fiveHour'], nowEpochMs: number): boolean {
  if (!window) {
    return false;
  }
  const reset = window.resetsAtEpochSeconds;
  if (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0) {
    return false;
  }
  return reset * 1000 + RESET_EXPIRY_GRACE_MS < nowEpochMs;
}

function scheduleResetRefresh(plan: ResetRefreshPlan | undefined): void {
  clearResetRefreshTimer();
  if (!plan) {
    return;
  }

  scheduledResetRefreshEpochMs = plan.scheduledEpochMs;
  const delayMs = Math.max(1000, plan.scheduledEpochMs - Date.now());
  resetRefreshTimer = setTimeout(() => {
    authState.recentResetRefreshAttemptEpochMs.set(plan.key, Date.now());
    resetRefreshTimer = undefined;
    scheduledResetRefreshEpochMs = undefined;
    void refreshNow({
      allowAuthenticated: true,
      bypassAuthenticatedPollDelay: true,
      bypassAuthenticatedBackoff: true
    });
  }, delayMs);
}

export async function refreshNow(options: RefreshOptions = {}): Promise<void> {
  if (options.manual) {
    cancelDebouncedRefresh();
  }
  refreshState.queuedOptions = mergeRefreshOptions(refreshState.queuedOptions, options);
  if (refreshState.inFlight) {
    return refreshState.inFlight;
  }

  refreshState.inFlight = (async () => {
    while (refreshState.queuedOptions) {
      const nextOptions = refreshState.queuedOptions;
      refreshState.queuedOptions = undefined;
      await performRefresh(nextOptions);
    }
  })();

  try {
    await refreshState.inFlight;
  } finally {
    refreshState.inFlight = undefined;
  }
}

async function performRefresh(options: RefreshOptions): Promise<void> {
  const cfg = getConfig();
  const mergeOptions: QuotaMergeOptions = { freshResetToleranceSeconds: cfg.freshResetToleranceSeconds };
  await fs.mkdir(cfg.stateDirectory, { recursive: true }).catch(err => logSwallowedError('state directory mkdir', err));
  authState.cache = await readAuthenticatedQuotaCache(cfg.stateDirectory);

  const statesByProvider: Partial<Record<ProviderName, ProviderUsageState>> = {};
  if (cfg.enabledProviders.includes('claude')) {
    const local = markLocal(await readClaudeBridgeState(cfg.stateDirectory));
    statesByProvider.claude = mergeLocalAndAuthenticated(local, authState.cache.claude, mergeOptions);
  }
  if (cfg.enabledProviders.includes('codex')) {
    const bridgeState = await readCodexBridgeState(cfg.stateDirectory);
    const sessionState = await readCodexUsageState(cfg.codexSessionsPath);
    const local = markLocal(mergeCodexBridgeStatusIntoSessionState(bridgeState, sessionState));
    statesByProvider.codex = mergeLocalAndAuthenticated(local, authState.cache.codex, mergeOptions);
  }

  if (options.allowAuthenticated && cfg.authenticatedQuota.enabled) {
    const providers = cfg.enabledProviders.filter(provider => cfg.authenticatedQuota.providers.includes(provider));
    for (const provider of providers) {
      const now = Date.now();
      const allowBackoffBypass =
        Boolean(options.bypassAuthenticatedBackoff) && hasExpiredQuotaWindow(statesByProvider[provider], now);
      const gate = getAuthenticatedRefreshGate({
        manual: options.manual,
        bypassPollDelay: options.bypassAuthenticatedPollDelay,
        bypassBackoff: allowBackoffBypass,
        nowEpochMs: now,
        backoffUntilEpochMs: authState.backoffEpochMs[provider],
        nextPollEpochMs: authState.nextPollEpochMs[provider],
        lastBypassBackoffAttemptEpochMs: authState.lastBypassAttemptEpochMs[provider],
        minBypassBackoffIntervalMs: MIN_BYPASS_BACKOFF_INTERVAL_MS
      });
      if (gate.action === 'backoff') {
        statesByProvider[provider] = annotateBackoff(statesByProvider[provider], gate.backoffUntilEpochMs);
        continue;
      }
      if (gate.action === 'nextPoll') {
        statesByProvider[provider] = annotateNextRefresh(statesByProvider[provider], gate.nextPollEpochMs);
        continue;
      }
      if (gate.bypassedBackoff) {
        authState.lastBypassAttemptEpochMs[provider] = now;
      }

      const outcome = await fetchAuthenticatedQuota(provider);
      if (outcome.success) {
        const nextRefresh = Date.now() + cfg.refreshIntervalMinutes * 60 * 1000;
        authState.nextPollEpochMs[provider] = nextRefresh;
        authState.backoffEpochMs[provider] = 0;
        authState.consecutiveFailures[provider] = 0;
        outcome.state.nextAuthenticatedRefreshEpochMs = nextRefresh;
        authState.cache[provider] = outcome.state;
        statesByProvider[provider] = mergeAuthenticatedQuotaSuccess(statesByProvider[provider], outcome.state, mergeOptions);
      } else {
        const failures = (authState.consecutiveFailures[provider] ?? 0) + 1;
        authState.consecutiveFailures[provider] = failures;
        const backoffSeconds = calculateAuthenticatedBackoffSeconds(failures, outcome.retryAfterSeconds);
        const backoffUntilNext = Date.now() + backoffSeconds * 1000;
        const nextRefresh = Date.now() + cfg.refreshIntervalMinutes * 60 * 1000;
        authState.backoffEpochMs[provider] = backoffUntilNext;
        authState.nextPollEpochMs[provider] = nextRefresh;
        outcome.state.nextAuthenticatedRefreshEpochMs = nextRefresh;
        const failedState = mergeAuthenticatedFailure(statesByProvider[provider], outcome.state, backoffUntilNext, mergeOptions);
        statesByProvider[provider] = failedState;
        authState.cache[provider] = mergeAuthenticatedFailure(authState.cache[provider], outcome.state, backoffUntilNext, mergeOptions);
      }
    }
    await writeAuthenticatedQuotaCache(cfg.stateDirectory, authState.cache).catch(err => logSwallowedError('authenticated cache write', err));
  } else {
    for (const provider of cfg.enabledProviders) {
      statesByProvider[provider] = annotateAuthenticatedDisabled(
        statesByProvider[provider],
        cfg.authenticatedQuota.enabled ? 'skipped' : 'disabled',
        cfg.authenticatedQuota.enabled ? 'Authenticated provider is not enabled for this provider.' : 'Authenticated provider disabled.'
      );
    }
  }

  const effectiveProviders = cfg.enabledProviders;

  const states = effectiveProviders
    .map(provider => statesByProvider[provider])
    .filter((state): state is ProviderUsageState => Boolean(state));
  latest.providerStates = states;

  const readResult: ReadSnapshotResult = await readMachineSnapshots({
    readEnabled: Boolean(cfg.snapshot.path),
    readPath: cfg.snapshot.path
  }).catch((): ReadSnapshotResult => ({ snapshots: [], errors: [] }));
  latest.remoteProviderGroups = buildRemoteProvidersFromSnapshots(readResult.snapshots);

  const aliasMap = cfg.snapshot.remoteMachineLabels ?? {};
  const selectedRemoteSourceSet = new Set(cfg.snapshot.remoteSources ?? []);
  const selectedStatusBarSourceSet = new Set(cfg.snapshot.statusBarSources ?? []);
  const selectedHistorySourceSet = new Set([
    ...selectedRemoteSourceSet,
    ...selectedStatusBarSourceSet
  ]);
  const sanitizedHistorySources = [
    ...(readResult.archiveSources ?? []),
    ...buildSanitizedHistorySources(readResult.snapshots)
  ];
  const selectedDashboardRemoteProviders = buildSelectedRemoteSourceProviders(
    readResult.snapshots,
    selectedRemoteSourceSet,
    aliasMap
  );
  latest.selectedRemoteProviders = selectedDashboardRemoteProviders;
  const remoteUsage = buildRemoteUsageProjection(
    sanitizedHistorySources,
    selectedHistorySourceSet
  );
  latest.remoteUsage = remoteUsage;
  const remoteHoverUsage = buildRemoteUsageProjection(
    sanitizedHistorySources,
    selectedStatusBarSourceSet,
    { windowDays: STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS }
  );

  const remoteStatusBarItems = buildRemoteStatusBarItems(
    readResult.snapshots,
    cfg.snapshot.statusBarSources ?? [],
    aliasMap,
    cfg.displayMode
  );

  if (effectiveProviders.includes('claude')) {
    const dirPath = cfg.claudeProjectsPath;
    const dateKey = getLocalDateKey();
    const fp = await computeDirectoryDigest(dirPath, '.jsonl');
    if (historyScanCache.claude && historyScanCache.claude.dirPath === dirPath && historyScanCache.claude.dateKey === dateKey && historyScanCache.claude.fingerprint === fp) {
      latest.claudeTodayUsage = historyScanCache.claude.today;
      latest.claudeUsageHistory = historyScanCache.claude.history;
    } else {
      latest.claudeTodayUsage = await readClaudeTodayUsageBucket(dirPath);
      latest.claudeUsageHistory = await readClaudeRecentUsageHistory(dirPath, 365);
      historyScanCache.claude = { dirPath, dateKey, fingerprint: fp, today: latest.claudeTodayUsage, history: latest.claudeUsageHistory };
    }
  } else {
    latest.claudeTodayUsage = undefined;
    latest.claudeUsageHistory = undefined;
  }

  if (effectiveProviders.includes('codex')) {
    const dirPath = cfg.codexSessionsPath;
    const dateKey = getLocalDateKey();
    const fp = await computeDirectoryDigest(dirPath, '.jsonl');
    if (historyScanCache.codex && historyScanCache.codex.dirPath === dirPath && historyScanCache.codex.dateKey === dateKey && historyScanCache.codex.fingerprint === fp) {
      latest.codexCorrelatedHistory = historyScanCache.codex.history;
      latest.codexCorrelatedTodayUsage = historyScanCache.codex.today;
    } else {
      latest.codexCorrelatedHistory = await readCodexCorrelatedHistory(dirPath, 365);
      latest.codexCorrelatedTodayUsage = await readCodexCorrelatedTodayBucket(dirPath);
      historyScanCache.codex = { dirPath, dateKey, fingerprint: fp, history: latest.codexCorrelatedHistory, today: latest.codexCorrelatedTodayUsage };
    }
  } else {
    latest.codexCorrelatedHistory = undefined;
    latest.codexCorrelatedTodayUsage = undefined;
  }

  // Panel-owned refreshes keep the loading/result/final-model sequence in sync.
  // The panel calls refreshNow directly, so the shared refresh path should not also broadcast
  // the same dashboard model to the open webview.
  if (!options.suppressPanelBroadcast) {
    const usageDashboardModel = buildUsageDashboardModel({
      states: latest.providerStates,
      claudeTodayUsage: latest.claudeTodayUsage,
      claudeUsageHistory: latest.claudeUsageHistory,
      codexCorrelatedHistory: latest.codexCorrelatedHistory,
      codexTodayUsage: latest.codexCorrelatedTodayUsage,
      enabledProviders: effectiveProviders,
      remoteProviderGroups: latest.remoteProviderGroups.length > 0 ? latest.remoteProviderGroups : undefined,
      selectedRemoteProviders: selectedDashboardRemoteProviders.length > 0 ? selectedDashboardRemoteProviders : undefined,
      remoteUsage: remoteUsage,
      aliasMap: aliasMap,
      normalizedSources: cfg.normalizedSources
    });
    postUsageDashboardRefreshIfOpen(usageDashboardModel);
  }

  const extraModelData: Record<string, ModelContributionInput[]> = {};
  const historyData: Record<string, ProviderHistoryInput> = {};
  if (latest.claudeUsageHistory?.modelUsage && latest.claudeUsageHistory.modelUsage.length > 0) {
    extraModelData.claude = latest.claudeUsageHistory.modelUsage
      .filter(m => m.totalTokens > 0)
      .map(toModelContribution);
  }
  if (latest.claudeUsageHistory?.days && latest.claudeUsageHistory.days.length > 0) {
    historyData.claude = {
      buckets: latest.claudeUsageHistory.days
        .filter(day => day.totalTokens > 0 || day.assistantMessages > 0 || day.modelUsage.length > 0)
        .map(day => ({
          dateKey: day.dateKey,
          inputTokens: day.inputTokens,
          outputTokens: day.outputTokens,
          cacheCreationTokens: day.cacheCreationInputTokens,
          cacheReadTokens: day.cacheReadInputTokens,
          messages: day.assistantMessages,
          modelUsage: day.modelUsage
            .filter(m => m.totalTokens > 0)
            .map(toModelContribution)
        }))
    };
  }
  if (latest.codexCorrelatedHistory?.modelUsage && latest.codexCorrelatedHistory.modelUsage.length > 0) {
    extraModelData.codex = latest.codexCorrelatedHistory.modelUsage
      .filter(m => m.totalTokens > 0)
      .map(toModelContribution);
  }
  if (latest.codexCorrelatedHistory?.days && latest.codexCorrelatedHistory.days.length > 0) {
    historyData.codex = {
      buckets: latest.codexCorrelatedHistory.days
        .filter(day => day.totalTokens > 0 || day.correlatedTurns > 0 || day.modelUsage.length > 0)
        .map(day => ({
          dateKey: day.dateKey,
          inputTokens: day.inputTokens,
          outputTokens: day.outputTokens,
          cacheCreationTokens: day.cacheCreationInputTokens,
          cacheReadTokens: day.cacheReadInputTokens,
          reasoningOutputTokens: day.reasoningOutputTokens,
          turns: day.correlatedTurns,
          modelUsage: day.modelUsage
            .filter(m => m.totalTokens > 0)
            .map(toModelContribution)
        }))
    };
  }

  markSnapshotSelfWriteTargets(cfg);
  await writeMachineSnapshotIfEnabled(
    {
      enabled: cfg.snapshot.enabled,
      machineLabel: cfg.snapshot.machineLabel,
      path: cfg.snapshot.path,
    },
    cfg.stateDirectory,
    latest.providerStates,
    Object.keys(extraModelData).length > 0 ? extraModelData : undefined,
    Object.keys(historyData).length > 0 ? historyData : undefined
  ).catch(err => logSwallowedError('snapshot write', err));

  const modelBreakdownData = buildStatusHoverModelBreakdown([
    {
      provider: 'claude',
      history: latest.claudeUsageHistory,
      shortenModel: shortenClaudeModel,
      estimateCostUsd: m => estimateClaudeCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).costUsd,
      isFallbackPricing: m => estimateClaudeCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).isFallback,
      remoteModelEntries: remoteHoverUsage.claudeModelEntries
    },
    {
      provider: 'codex',
      history: latest.codexCorrelatedHistory,
      shortenModel: shortenCodexModel,
      estimateCostUsd: m => estimateCodexCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).costUsd,
      isFallbackPricing: m => estimateCodexCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).isFallback,
      remoteModelEntries: remoteHoverUsage.codexModelEntries
    }
  ] as Array<{
    provider: ProviderName;
    history: { available: boolean; days: Array<{ dateKey: string; modelUsage: HistoryModelUsage[] }> } | undefined;
    shortenModel: (model: string) => string;
    estimateCostUsd: (model: HistoryModelUsage) => number;
    isFallbackPricing: (model: HistoryModelUsage) => boolean;
    remoteModelEntries?: Array<{
      model: string;
      tokens: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      assistantMessages?: number;
    }>;
  }>);

  const resetRefreshPlan = getNextResetRefreshPlan(states, {
    lastAttemptEpochMsByKey: authState.recentResetRefreshAttemptEpochMs
  });
  scheduleResetRefresh(resetRefreshPlan);

  const formatted = formatStatus(states, {
    displayMode: cfg.displayMode,
    statusMode: cfg.statusMode,
    lowRemainingPercent: cfg.lowRemainingPercent,
    warnRemainingPercent: cfg.warnRemainingPercent,
    criticalRemainingPercent: cfg.criticalRemainingPercent,
    emptyRemainingPercent: cfg.emptyRemainingPercent,
    nextResetRefreshEpochMs: scheduledResetRefreshEpochMs,
    modelBreakdown: modelBreakdownData,
    normalizedSources: cfg.normalizedSources
  }, remoteStatusBarItems);

  _onStatusUpdate?.(formatted.text, `${formatted.tooltip}\n\nClick to open PromptFuel dashboard`);
}
