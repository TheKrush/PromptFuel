import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getConfig } from './config';
import { formatStatus } from './display/format';
import { buildStatusHoverModelBreakdown, type HistoryModelUsage, STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS } from './display/modelBreakdown';
import { logPromptFuel } from './logger';
import { mergeAuthenticatedFailure, mergeAuthenticatedQuotaSuccess, mergeLocalAndAuthenticated, type QuotaMergeOptions } from './quota/merge';
import {
  type AuthenticatedQuotaFetchOutcome,
  fetchAuthenticatedQuota,
  readAuthenticatedQuotaCache,
  writeAuthenticatedQuotaCache
} from './providers/authenticatedQuota';
import { readClaudeBridgeState } from './providers/claudeBridge';
import {
  type ClaudeHistoryModelUsage,
  type ClaudeUsageHistory
} from './providers/claudeDayBucketScanner';
import {
  type CodexCorrelatedHistory,
  type CodexCorrelatedHistoryModelUsage
} from './providers/codexCorrelatedDayBucketScanner';
import { readCodexUsageState } from './providers/codexSessionScanner';
import { readCodexBridgeState } from './providers/codexState';
import { estimateClaudeCostUsd, estimateCodexCostUsd } from './providers/pricing';
import { calculateAuthenticatedBackoffSeconds, getAuthenticatedRefreshGate } from './quota/refreshPolicy';
import { getNextResetRefreshPlan, type ResetRefreshPlan } from './quota/resetRefresh';
import { isUsageDashboardOpen, postUsageDashboardRefreshIfOpen } from './panel/promptFuelPanel';
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
import { filterSelfSnapshots, filterSelfSourceIds, supplementLocalHistoryWithSelfArchives } from './snapshot/selfArchiveSupplement';
import type { SanitizedHistorySource } from './snapshot/types';
import { writeMachineSnapshotIfEnabled, type ModelContributionInput, type ProviderHistoryInput } from './snapshot/writeMachineSnapshot';
import { type ProviderName, type ProviderUsageState } from './types';
import { RESET_EXPIRY_GRACE_MS } from './usageTime';
import { buildRemoteStatusBarItems } from './statusBar';
import { cancelDebouncedRefresh, markSnapshotSelfWriteTargets } from './watchers';
import {
  makeClaudeHistoryCache,
  makeCodexHistoryCache,
  readClaudeHistoryIncremental,
  readCodexHistoryIncremental,
  type ClaudeHistoryCache,
  type CodexHistoryCache
} from './providers/historyCache';
import {
  createProgressiveHistoryManager,
  formatHistoryProgressNote,
  PROGRESSIVE_ALL_HORIZON_DAYS,
  PROGRESSIVE_STAGES,
  stageDays,
  type ProgressiveHistoryManager,
  type ProviderHistoryProgress
} from './providers/progressiveHistory';

import {
  HISTORY_CACHE_STORE_FILE,
  loadHistoryCacheStore,
  saveHistoryCacheStore
} from './providers/historyCacheStore';
import { shouldStartHistorySession } from './providers/historySessionGate';

// A warm refresh of an already-fully-loaded root re-checks the whole history
// window in one shot instead of replaying the full 1D->7D->30D->365D->ALL
// reveal: there is nothing left to progressively reveal, replaying it wastes
// work (measured ~24 dashboard-model rebuilds per full two-provider cycle),
// and it is the root cause of every "briefly shows a narrower window than
// what's already on screen" defect found across review.
const ALL_STAGE = PROGRESSIVE_STAGES.find(stage => stage.key === 'ALL');
if (!ALL_STAGE) {
  throw new Error('PROGRESSIVE_STAGES is missing its ALL stage');
}
const WARM_REFRESH_STAGES = [ALL_STAGE];

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
  claudeUsageHistory: undefined as ClaudeUsageHistory | undefined,
  codexCorrelatedHistory: undefined as CodexCorrelatedHistory | undefined,
  remoteProviderGroups: [] as GroupedRemoteProvider[],
  selectedRemoteProviders: [] as UsageDashboardProvider[],
  remoteUsage: undefined as RemoteUsageProjection | undefined,
  historyProgress: [] as ProviderHistoryProgress[]
};

const claudeHistoryCache: ClaudeHistoryCache = makeClaudeHistoryCache();
const codexHistoryCache: CodexHistoryCache = makeCodexHistoryCache();

// Schema/revision token written into the history cache store; a mismatch (e.g. a
// future scanner change) discards the persisted cache instead of reusing stale
// per-file contributions. Bump when the contribution schema or scanner semantics change.
const SCANNER_REVISION = 'history-scan-v1';

const claudeHistoryManager: ProgressiveHistoryManager<ClaudeUsageHistory> = createProgressiveHistoryManager<ClaudeUsageHistory>();
const codexHistoryManager: ProgressiveHistoryManager<CodexCorrelatedHistory> = createProgressiveHistoryManager<CodexCorrelatedHistory>();

// Root path the currently-running progressive session was started against, per
// provider; see shouldStartHistorySession for why duplicate same-root triggers
// must not restart an in-flight session.
let claudeHistorySessionDirPath: string | undefined;
let codexHistorySessionDirPath: string | undefined;

let lastStatusContext: {
  states: ProviderUsageState[];
  cfg: ReturnType<typeof getConfig>;
  remoteStatusBarItems: ReturnType<typeof buildRemoteStatusBarItems>;
  remoteHoverUsage: RemoteUsageProjection;
} | undefined;

let historySupplementContext: {
  machineLabel?: string;
  archiveSources: SanitizedHistorySource[];
} | undefined;

const refreshState = {
  inFlight: undefined as Promise<void> | undefined,
  queuedOptions: undefined as RefreshOptions | undefined
};

let resetRefreshTimer: NodeJS.Timeout | undefined;
let scheduledResetRefreshEpochMs: number | undefined;

let _onStatusUpdate: ((text: string, tooltip: string) => void) | undefined;
let _onHistoryFullyLoaded: (() => void) | undefined;

// Set once the extension is deactivating: background progressive-history stages
// keep running to completion (so the persisted cache stays consistent), but any
// publish that would touch the (by then disposed) status bar item or webview is
// skipped instead of throwing on a disposed VS Code object.
let disposed = false;

// Fires onHistoryFullyLoaded at most once per activation, the first time every
// enabled provider's published history reaches the all-time horizon -- not on
// every already-complete warm refresh, which would otherwise notify repeatedly.
let notifiedHistoryFullyLoaded = false;

export function initRefreshController(deps: {
  onStatusUpdate: (text: string, tooltip: string) => void;
  onHistoryFullyLoaded?: () => void;
}): void {
  _onStatusUpdate = deps.onStatusUpdate;
  _onHistoryFullyLoaded = deps.onHistoryFullyLoaded;
  disposed = false;
  notifiedHistoryFullyLoaded = false;
}

export function disposeRefreshController(): void {
  disposed = true;
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

function logAuthenticatedQuotaOutcome(outcome: AuthenticatedQuotaFetchOutcome): void {
  const statusCategory = httpStatusCategory(outcome.state.authenticatedHttpStatus);
  const sourceKind = outcome.state.sourceKind ?? 'unknown';
  const fiveHour = authenticatedWindowDiagnostic(outcome.state, 'fiveHour');
  const sevenDay = authenticatedWindowDiagnostic(outcome.state, 'sevenDay');
  logPromptFuel(
    `Authenticated refresh completed provider=${outcome.provider} outcome=${outcome.success ? 'success' : outcome.state.authenticatedStatus ?? 'failure'}`
    + ` http=${statusCategory} source=${sourceKind} 5h=${fiveHour} 7d=${sevenDay}`
  );
}

function authenticatedWindowDiagnostic(state: ProviderUsageState, key: 'fiveHour' | 'sevenDay'): string {
  const windowState = state.authenticatedWindows?.[key];
  if (windowState) {
    return `${windowState.observation}/${windowState.availability}`;
  }
  return state[key] ? 'valid/unclassified' : 'unknown/unavailable';
}

function httpStatusCategory(statusCode: number | undefined): string {
  if (!statusCode || statusCode < 100) {
    return 'none';
  }
  return `${Math.floor(statusCode / 100)}xx`;
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
  let codexBridgeState: ProviderUsageState | undefined;
  if (cfg.enabledProviders.includes('codex')) {
    // readCodexBridgeState reads one small hook-written JSON file (fast). Publish
    // from that alone first -- the session scan below walks and parses up to 32
    // recent Codex JSONL files and has been measured at 1.4s+ locally (more on a
    // slower disk/VM), which must not gate the fast first paint any more than the
    // authenticated network call does.
    codexBridgeState = await readCodexBridgeState(cfg.stateDirectory);
    const local = markLocal(codexBridgeState ?? { provider: 'codex', stale: true });
    statesByProvider.codex = mergeLocalAndAuthenticated(local, authState.cache.codex, mergeOptions);
  }

  // Layer A: publish cached/local quota status immediately -- before the local Codex
  // session scan, the authenticated network round trip, history, or snapshot work --
  // so the status bar reflects usage and reset timers right away.
  publishEarlyStatus(cfg, cfg.enabledProviders
    .map(provider => statesByProvider[provider])
    .filter((state): state is ProviderUsageState => Boolean(state)));

  if (cfg.enabledProviders.includes('codex')) {
    const sessionState = await readCodexUsageState(cfg.codexSessionsPath);
    const local = markLocal(mergeCodexBridgeStatusIntoSessionState(codexBridgeState, sessionState));
    statesByProvider.codex = mergeLocalAndAuthenticated(local, authState.cache.codex, mergeOptions);
  }

  if (options.allowAuthenticated !== false) {
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

      logPromptFuel(`Authenticated refresh started provider=${provider}`);
      const outcome = await fetchAuthenticatedQuota(provider);
      logAuthenticatedQuotaOutcome(outcome);
      if (outcome.success) {
        const nextRefresh = Date.now() + cfg.refreshIntervalMinutes * 60 * 1000;
        authState.nextPollEpochMs[provider] = nextRefresh;
        authState.backoffEpochMs[provider] = 0;
        authState.consecutiveFailures[provider] = 0;
        outcome.state.nextAuthenticatedRefreshEpochMs = nextRefresh;
        authState.cache[provider] = mergeAuthenticatedQuotaSuccess(authState.cache[provider], outcome.state, mergeOptions);
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
    try {
      await writeAuthenticatedQuotaCache(cfg.stateDirectory, authState.cache);
      logPromptFuel('Authenticated cache write completed');
    } catch {
      logPromptFuel('Authenticated cache write failed');
    }
  } else {
    for (const provider of cfg.enabledProviders) {
      statesByProvider[provider] = annotateAuthenticatedDisabled(
        statesByProvider[provider],
        'skipped',
        'Authenticated provider skipped for this refresh.'
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
  const remoteSnapshots = filterSelfSnapshots(readResult.snapshots, cfg.snapshot.machineLabel);
  latest.remoteProviderGroups = buildRemoteProvidersFromSnapshots(remoteSnapshots);
  historySupplementContext = {
    machineLabel: cfg.snapshot.machineLabel,
    archiveSources: readResult.archiveSources ?? []
  };

  const aliasMap = cfg.snapshot.remoteMachineLabels ?? {};
  const selectedRemoteSourceSet = new Set(filterSelfSourceIds(cfg.snapshot.remoteSources ?? [], cfg.snapshot.machineLabel));
  const selectedStatusBarSourceSet = new Set(filterSelfSourceIds(cfg.snapshot.statusBarSources ?? [], cfg.snapshot.machineLabel));
  const selectedHistorySourceSet = new Set([
    ...selectedRemoteSourceSet,
    ...selectedStatusBarSourceSet
  ]);
  const sanitizedHistorySources = [
    ...(readResult.archiveSources ?? []),
    ...buildSanitizedHistorySources(remoteSnapshots)
  ];
  const selectedDashboardRemoteProviders = buildSelectedRemoteSourceProviders(
    remoteSnapshots,
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
    remoteSnapshots,
    Array.from(selectedStatusBarSourceSet),
    aliasMap,
    cfg.displayMode,
    cfg.normalizedSources
  );

  await loadHistoryCacheStoreOnce();

  if (effectiveProviders.includes('claude')) {
    startClaudeHistorySession();
  } else {
    latest.claudeUsageHistory = undefined;
  }

  if (effectiveProviders.includes('codex')) {
    startCodexHistorySession();
  } else {
    latest.codexCorrelatedHistory = undefined;
  }

  // History sessions above are fire-and-forget: this supplements whichever
  // generation's data is currently in `latest.*` (the previous generation until
  // the new session's first stage lands via supplementStageHistory/applyStage),
  // not a freshly-scanned read. Safe because the merge is day-keyed and
  // idempotent, not additive.
  const supplementedHistory = supplementLocalHistoryWithSelfArchives({
    machineLabel: cfg.snapshot.machineLabel,
    archiveSources: readResult.archiveSources ?? [],
    claudeUsageHistory: effectiveProviders.includes('claude') ? latest.claudeUsageHistory : undefined,
    codexCorrelatedHistory: effectiveProviders.includes('codex') ? latest.codexCorrelatedHistory : undefined
  });
  latest.claudeUsageHistory = supplementedHistory.claudeUsageHistory;
  latest.codexCorrelatedHistory = supplementedHistory.codexCorrelatedHistory;

  // Panel-owned refreshes keep the loading/result/final-model sequence in sync.
  // The panel calls refreshNow directly, so the shared refresh path should not also broadcast
  // the same dashboard model to the open webview.
  if (!options.suppressPanelBroadcast && isUsageDashboardOpen()) {
    const usageDashboardModel = buildUsageDashboardModel({
      states: latest.providerStates,
      claudeUsageHistory: latest.claudeUsageHistory,
      codexCorrelatedHistory: latest.codexCorrelatedHistory,
      enabledProviders: effectiveProviders,
      remoteProviderGroups: latest.remoteProviderGroups.length > 0 ? latest.remoteProviderGroups : undefined,
      selectedRemoteProviders: selectedDashboardRemoteProviders.length > 0 ? selectedDashboardRemoteProviders : undefined,
      remoteUsage: remoteUsage,
      aliasMap: aliasMap,
      normalizedSources: cfg.normalizedSources,
      weekStartsOn: cfg.weekStartsOn,
      historyProgress: currentHistoryProgress()
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

  const resetRefreshPlan = getNextResetRefreshPlan(states, {
    lastAttemptEpochMsByKey: authState.recentResetRefreshAttemptEpochMs
  });
  scheduleResetRefresh(resetRefreshPlan);

  lastStatusContext = {
    states,
    cfg,
    remoteStatusBarItems,
    remoteHoverUsage
  };

  publishStatusFromLatest();
}

// ---------------------------------------------------------------------------
// Background progressive history sessions
// ---------------------------------------------------------------------------

function currentHistoryProgress(): ProviderHistoryProgress[] {
  const entries: ProviderHistoryProgress[] = [];
  const claude = claudeHistoryManager.getProgress('claude');
  if (claude && !hasReachedFullWindow('claude')) { entries.push(claude); }
  const codex = codexHistoryManager.getProgress('codex');
  if (codex && !hasReachedFullWindow('codex')) { entries.push(codex); }
  return entries;
}

// A warm refresh (already-loaded provider) restarts the internal stage
// sequence from '1D' every time (see applyStage's non-decreasing-width guard
// below), so a session's own finishedStages/currentStage go through the same
// "not there yet" states even though the currently-published window is
// already full. Once the published window has reached the all-time horizon,
// omit that provider from the reported progress entirely so the loading note
// and any future progress UI stop asserting a partial load that isn't real.
function hasReachedFullWindow(provider: ProviderName): boolean {
  const totalDays = provider === 'claude' ? latest.claudeUsageHistory?.totalDays : latest.codexCorrelatedHistory?.totalDays;
  return typeof totalDays === 'number' && totalDays >= PROGRESSIVE_ALL_HORIZON_DAYS;
}

function persistHistoryCacheStore(): Promise<void> {
  const storePath = getHistoryCacheStorePath();
  return saveHistoryCacheStore(storePath, claudeHistoryCache, codexHistoryCache, SCANNER_REVISION)
    .catch(err => logSwallowedError('history cache store save', err));
}

let historyCacheStoreLoadPromise: Promise<void> | undefined;

// True once a valid persisted cache store was found on disk -- meaning the
// very first session this process runs will already have most/all per-file
// contributions warm, and is not the kind of genuine first-time cold wait the
// "fully loaded" notification exists to announce. Without this, the toast
// would fire a few seconds after every single window open/reload, since a
// warm-cache cold session still completes and still reaches the full window.
let historyCacheStoreWasPreloaded = false;

function loadHistoryCacheStoreOnce(): Promise<void> {
  if (!historyCacheStoreLoadPromise) {
    historyCacheStoreLoadPromise = (async () => {
      const loaded = await loadHistoryCacheStore(getHistoryCacheStorePath(), {
        scannerRevision: SCANNER_REVISION,
        onSanitizedLog: (message) => logPromptFuel(`historyCacheStore: ${message}`)
      });
      historyCacheStoreWasPreloaded = loaded.loaded;
      claudeHistoryCache.entries = loaded.claude.entries;
      claudeHistoryCache.dirPath = loaded.claude.dirPath;
      claudeHistoryCache.dateKey = loaded.claude.dateKey;
      codexHistoryCache.entries = loaded.codex.entries;
      codexHistoryCache.dirPath = loaded.codex.dirPath;
      codexHistoryCache.dateKey = loaded.codex.dateKey;
    })().catch(err => logSwallowedError('history cache store load', err));
  }
  return historyCacheStoreLoadPromise;
}

function getHistoryCacheStorePath(): string {
  return path.join(getConfig().stateDirectory, HISTORY_CACHE_STORE_FILE);
}

function publishHistoryProgress(_provider: ProviderName, _progress: ProviderHistoryProgress): void {
  if (disposed) { return; }
  // Single source of truth: latest.historyProgress is always the same
  // hasReachedFullWindow-filtered view as the periodic broadcast below, so a
  // panel-open request reading it directly (extension.ts) can't see a raw,
  // unfiltered entry that falsely claims a partial load mid-warm-refresh.
  latest.historyProgress = currentHistoryProgress();

  const cfg = getConfig();
  // buildUsageDashboardModel is measured at ~29ms and a multi-MB payload against
  // a large history corpus; a full progressive session publishes it up to a
  // dozen times per provider, so skip building it at all when there's no open
  // webview to receive it instead of building-then-discarding on every publish.
  if (isUsageDashboardOpen()) {
    const usageDashboardModel = buildUsageDashboardModel({
      states: latest.providerStates,
      claudeUsageHistory: latest.claudeUsageHistory,
      codexCorrelatedHistory: latest.codexCorrelatedHistory,
      enabledProviders: cfg.enabledProviders,
      remoteProviderGroups: latest.remoteProviderGroups.length > 0 ? latest.remoteProviderGroups : undefined,
      selectedRemoteProviders: latest.selectedRemoteProviders.length > 0 ? latest.selectedRemoteProviders : undefined,
      remoteUsage: latest.remoteUsage,
      aliasMap: cfg.snapshot.remoteMachineLabels,
      normalizedSources: cfg.normalizedSources,
      weekStartsOn: cfg.weekStartsOn,
      historyProgress: latest.historyProgress
    });
    postUsageDashboardRefreshIfOpen(usageDashboardModel);
  }
  publishStatusFromLatest();
  maybeNotifyHistoryFullyLoaded(cfg.enabledProviders);
}

function maybeNotifyHistoryFullyLoaded(enabledProviders: ProviderName[]): void {
  if (disposed || notifiedHistoryFullyLoaded || !_onHistoryFullyLoaded || historyCacheStoreWasPreloaded) { return; }
  const relevant = enabledProviders.filter(provider => provider === 'claude' || provider === 'codex');
  // hasReachedFullWindow alone isn't enough here: a provider whose session
  // directory is missing/unreadable still reaches totalDays === horizon with
  // available: false (the failure-path returns still carry the requested
  // width), which would otherwise announce "fully loaded" for a provider that
  // has no data at all.
  if (relevant.length === 0 || !relevant.every(provider => hasReachedFullWindow(provider) && historyIsAvailable(provider))) { return; }
  notifiedHistoryFullyLoaded = true;
  _onHistoryFullyLoaded();
}

function historyIsAvailable(provider: ProviderName): boolean {
  return provider === 'claude' ? Boolean(latest.claudeUsageHistory?.available) : Boolean(latest.codexCorrelatedHistory?.available);
}

function startClaudeHistorySession(): void {
  const cfg = getConfig();
  const dirPath = cfg.claudeProjectsPath;
  const running = claudeHistoryManager.getProgress('claude');
  if (!shouldStartHistorySession({ runningStatus: running?.status, runningDirPath: claudeHistorySessionDirPath, requestedDirPath: dirPath })) {
    return;
  }
  const isRootChange = claudeHistorySessionDirPath !== dirPath;
  if (isRootChange) {
    // Source root changed (or this is the very first session for this process):
    // the previously published history belongs to a different root and must not
    // linger or gate the stage-width check below, so treat this session as a
    // fresh cold start.
    latest.claudeUsageHistory = undefined;
  }
  claudeHistorySessionDirPath = dirPath;
  const stages = !isRootChange && hasReachedFullWindow('claude') ? WARM_REFRESH_STAGES : undefined;
  claudeHistoryManager.startSession('claude', {
    readStage: async (stage) => {
      const history = await readClaudeHistoryIncremental(dirPath, stageDays(stage), claudeHistoryCache);
      return { history, recordsMatched: history.recordsMatched };
    },
    applyStage: async (stage, read) => {
      // Defense in depth alongside the warm-refresh single-stage list above:
      // never republish a narrower window than what's already shown.
      const publishedDays = latest.claudeUsageHistory?.totalDays ?? -1;
      if (stageDays(stage) >= publishedDays) {
        latest.claudeUsageHistory = supplementStageHistory('claude', read.history);
      }
      await persistHistoryCacheStore();
    },
    publishProgress: (progress) => {
      publishHistoryProgress('claude', progress);
    }
  }, stages);
}

function startCodexHistorySession(): void {
  const cfg = getConfig();
  const dirPath = cfg.codexSessionsPath;
  const running = codexHistoryManager.getProgress('codex');
  if (!shouldStartHistorySession({ runningStatus: running?.status, runningDirPath: codexHistorySessionDirPath, requestedDirPath: dirPath })) {
    return;
  }
  const isRootChange = codexHistorySessionDirPath !== dirPath;
  if (isRootChange) {
    latest.codexCorrelatedHistory = undefined;
  }
  codexHistorySessionDirPath = dirPath;
  const stages = !isRootChange && hasReachedFullWindow('codex') ? WARM_REFRESH_STAGES : undefined;
  codexHistoryManager.startSession('codex', {
    readStage: async (stage) => {
      const history = await readCodexHistoryIncremental(dirPath, stageDays(stage), codexHistoryCache);
      return { history, recordsMatched: history.recordsMatched };
    },
    applyStage: async (stage, read) => {
      // See startClaudeHistorySession: skip republishing a narrower window
      // than what is currently shown to avoid collapsing totals on refresh.
      const publishedDays = latest.codexCorrelatedHistory?.totalDays ?? -1;
      if (stageDays(stage) >= publishedDays) {
        latest.codexCorrelatedHistory = supplementStageHistory('codex', read.history);
      }
      await persistHistoryCacheStore();
    },
    publishProgress: (progress) => {
      publishHistoryProgress('codex', progress);
    }
  }, stages);
}

function supplementStageHistory<T extends ClaudeUsageHistory | CodexCorrelatedHistory>(
  provider: ProviderName,
  history: T
): T {
  const context = historySupplementContext;
  if (!context) {
    return history;
  }
  const supplemented = supplementLocalHistoryWithSelfArchives({
    machineLabel: context.machineLabel,
    archiveSources: context.archiveSources,
    claudeUsageHistory: provider === 'claude' ? (history as ClaudeUsageHistory) : undefined,
    codexCorrelatedHistory: provider === 'codex' ? (history as CodexCorrelatedHistory) : undefined
  });
  if (provider === 'claude') {
    return (supplemented.claudeUsageHistory ?? history) as T;
  }
  return (supplemented.codexCorrelatedHistory ?? history) as T;
}

function publishEarlyStatus(cfg: ReturnType<typeof getConfig>, states: ProviderUsageState[]): void {
  if (disposed || !_onStatusUpdate) { return; }
  // Reuse the last known-good remote status-bar segments (this refresh hasn't
  // read snapshots yet) so an early publish doesn't visibly drop remote
  // sources for the duration of the authenticated network call that follows.
  const formatted = formatStatus(states, {
    displayMode: cfg.displayMode,
    statusMode: cfg.statusMode,
    nextResetRefreshEpochMs: scheduledResetRefreshEpochMs,
    modelBreakdown: undefined,
    normalizedSources: cfg.normalizedSources
  }, lastStatusContext?.remoteStatusBarItems);
  // Only claim history is loading when a provider session is actually running;
  // a warm refresh of already-loaded history must not assert this on every cycle.
  const note = formatHistoryProgressNote(currentHistoryProgress());
  _onStatusUpdate?.(
    formatted.text,
    `${formatted.tooltip}${note ? `\n\n${note}` : ''}\n\nClick to open PromptFuel dashboard`
  );
}

function buildHoverModelBreakdownProviders(): Array<{
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
}> {
  const remoteHoverUsage = lastStatusContext?.remoteHoverUsage;
  const claudeHistory = hasLoadedSevenDayWindow('claude') ? latest.claudeUsageHistory : undefined;
  const codexHistory = hasLoadedSevenDayWindow('codex') ? latest.codexCorrelatedHistory : undefined;
  return [
    {
      provider: 'claude',
      history: claudeHistory,
      shortenModel: shortenClaudeModel,
      estimateCostUsd: m => estimateClaudeCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).costUsd,
      isFallbackPricing: m => estimateClaudeCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).isFallback,
      remoteModelEntries: remoteHoverUsage?.claudeModelEntries
    },
    {
      provider: 'codex',
      history: codexHistory,
      shortenModel: shortenCodexModel,
      estimateCostUsd: m => estimateCodexCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).costUsd,
      isFallbackPricing: m => estimateCodexCostUsd(m.inputTokens, m.outputTokens, m.cacheReadInputTokens, m.cacheCreationInputTokens, [m.model]).isFallback,
      remoteModelEntries: remoteHoverUsage?.codexModelEntries
    }
  ];
}

function hasLoadedSevenDayWindow(provider: ProviderName): boolean {
  // Keyed off the currently-published window rather than the in-flight
  // session's finishedStages: a warm refresh restarts the stage sequence
  // internally (see applyStage above) without republishing narrower stages,
  // so finishedStages alone would flicker this false on every refresh even
  // though a >=7-day window is already on screen.
  const totalDays = provider === 'claude' ? latest.claudeUsageHistory?.totalDays : latest.codexCorrelatedHistory?.totalDays;
  return typeof totalDays === 'number' && totalDays >= 7;
}

function publishStatusFromLatest(): void {
  const ctx = lastStatusContext;
  if (disposed || !ctx || !_onStatusUpdate) { return; }
  const modelBreakdownData = buildStatusHoverModelBreakdown(buildHoverModelBreakdownProviders());
  const note = formatHistoryProgressNote(currentHistoryProgress());
  const formatted = formatStatus(ctx.states, {
    displayMode: ctx.cfg.displayMode,
    statusMode: ctx.cfg.statusMode,
    nextResetRefreshEpochMs: scheduledResetRefreshEpochMs,
    modelBreakdown: modelBreakdownData,
    normalizedSources: ctx.cfg.normalizedSources
  }, ctx.remoteStatusBarItems);
  _onStatusUpdate?.(
    formatted.text,
    `${formatted.tooltip}${note ? `\n\n${note}` : ''}\n\nClick to open PromptFuel dashboard`
  );
}
