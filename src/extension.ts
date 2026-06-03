import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { formatStatus, formatRemoteProviderTooltip, quotaIndicatorForRemaining, type FormattedProviderStatus, type RemoteQuotaRow } from './display/format';
import { buildStatusHoverModelBreakdown, HistoryModelUsage, STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS } from './display/modelBreakdown';
import { mergeAuthenticatedFailure, mergeAuthenticatedQuotaSuccess, mergeLocalAndAuthenticated, QuotaMergeOptions } from './quota/merge';
import {
  fetchAuthenticatedQuota,
  readAuthenticatedQuotaCache,
  writeAuthenticatedQuotaCache
} from './providers/authenticatedQuota';
import { readClaudeBridgeState } from './providers/claudeBridge';
import { readCodexUsageState } from './providers/codexSessionScanner';
import { readCodexBridgeState } from './providers/codexState';
import { calculateAuthenticatedBackoffSeconds, getAuthenticatedRefreshGate } from './quota/refreshPolicy';
import { getNextResetRefreshPlan, ResetRefreshPlan } from './quota/resetRefresh';
import { disposePromptFuelLogger, logPromptFuel } from './logger';
import { DisplayMode, ProviderName, ProviderUsageState } from './types';
import { RESET_EXPIRY_GRACE_MS, formatAgeLabel, formatCountdown } from './usageTime';
import { postUsageDashboardRefreshIfOpen, registerPromptFuelPanelCommands } from './panel/promptFuelPanel';
import { writeMachineSnapshotIfEnabled, type ModelContributionInput, type ProviderHistoryInput } from './snapshot/writeMachineSnapshot';
import { readMachineSnapshots, buildRemoteProvidersFromSnapshots, buildSelectedRemoteSourceProviders, buildSanitizedHistorySources, type GroupedRemoteProvider, type ReadSnapshotResult } from './snapshot/readMachineSnapshots';
import { aggregateSnapshotBucketModels, buildRemoteUsageProjection, type RemoteUsageProjection } from './snapshot/remoteUsageProjection';
import { formatSourceLabel, parsePerWindowReset } from './snapshot/remoteSourceHelper';
import type { UsageDashboardProvider } from './panel/usageDashboardModel';
import { buildUsageDashboardModel, shortenClaudeModel, shortenCodexModel } from './panel/usageDashboardModel';
import {
  ClaudeTodayUsageBucket,
  ClaudeUsageHistory,
  readClaudeRecentUsageHistory,
  readClaudeTodayUsageBucket
} from './providers/claudeDayBucketScanner';
import { CodexCorrelatedDayBucket, CodexCorrelatedHistory, readCodexCorrelatedHistory, readCodexCorrelatedTodayBucket } from './providers/codexCorrelatedDayBucketScanner';
import { estimateClaudeCostUsd, estimateCodexCostUsd } from './providers/pricing';

let combinedStatusItem: vscode.StatusBarItem;
let fileWatchers: vscode.FileSystemWatcher[] = [];
const timers: {
  refresh: NodeJS.Timeout | undefined;
  authenticatedRefresh: NodeJS.Timeout | undefined;
  resetRefresh: NodeJS.Timeout | undefined;
  scheduledResetRefreshEpochMs: number | undefined;
  watcherDebounce: NodeJS.Timeout | undefined;
} = {
  refresh: undefined,
  authenticatedRefresh: undefined,
  resetRefresh: undefined,
  scheduledResetRefreshEpochMs: undefined,
  watcherDebounce: undefined
};
const authState = {
  cache: {} as Partial<Record<ProviderName, ProviderUsageState>>,
  nextPollEpochMs: {} as Partial<Record<ProviderName, number>>,
  backoffEpochMs: {} as Partial<Record<ProviderName, number>>,
  lastBypassAttemptEpochMs: {} as Partial<Record<ProviderName, number>>,
  consecutiveFailures: {} as Partial<Record<ProviderName, number>>,
  recentResetRefreshAttemptEpochMs: new Map<string, number>()
};
const MIN_BYPASS_BACKOFF_INTERVAL_MS = 60_000;
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

const WATCHER_DEBOUNCE_MS = 500;
const SNAPSHOT_SELF_WRITE_IGNORE_MS = 5_000;

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

const snapshotSelfWriteIgnore = {
  latestFiles: new Map<string, number>(),
  archiveDirs: new Map<string, number>()
};

function scheduleDebouncedRefresh(uri?: vscode.Uri): void {
  if (uri && shouldIgnoreSnapshotSelfWrite(uri.fsPath)) {
    return;
  }
  if (timers.watcherDebounce) {
    clearTimeout(timers.watcherDebounce);
  }
  timers.watcherDebounce = setTimeout(() => {
    timers.watcherDebounce = undefined;
    void refreshNow();
  }, WATCHER_DEBOUNCE_MS);
}

function cancelDebouncedRefresh(): void {
  if (timers.watcherDebounce) {
    clearTimeout(timers.watcherDebounce);
    timers.watcherDebounce = undefined;
  }
}

function getLocalDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sanitizeSnapshotMachineLabel(label: string): string {
  const sanitized = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized || 'unknown';
}

function normalizeWatchPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathIsInsideOrEqual(filePath: string, dirPath: string): boolean {
  return filePath === dirPath || filePath.startsWith(dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`);
}

function pruneSnapshotSelfWriteIgnores(now: number): void {
  for (const [filePath, until] of snapshotSelfWriteIgnore.latestFiles) {
    if (until <= now) {
      snapshotSelfWriteIgnore.latestFiles.delete(filePath);
    }
  }
  for (const [dirPath, until] of snapshotSelfWriteIgnore.archiveDirs) {
    if (until <= now) {
      snapshotSelfWriteIgnore.archiveDirs.delete(dirPath);
    }
  }
}

function markSnapshotSelfWriteTargets(cfg: ReturnType<typeof getConfig>): void {
  if (!cfg.snapshot.enabled) {
    return;
  }

  const machineSegment = sanitizeSnapshotMachineLabel(cfg.snapshot.machineLabel || 'unknown');
  const roots = [
    path.join(cfg.stateDirectory, 'snapshots'),
    cfg.snapshot.path ? path.resolve(cfg.snapshot.path) : ''
  ].filter((root, index, all): root is string => Boolean(root) && all.indexOf(root) === index);
  const until = Date.now() + SNAPSHOT_SELF_WRITE_IGNORE_MS;

  for (const root of roots) {
    snapshotSelfWriteIgnore.latestFiles.set(
      normalizeWatchPath(path.join(root, `${machineSegment}-latest.json`)),
      until
    );
    snapshotSelfWriteIgnore.archiveDirs.set(
      normalizeWatchPath(path.join(root, 'archive', machineSegment)),
      until
    );
  }
}

function shouldIgnoreSnapshotSelfWrite(filePath: string): boolean {
  const now = Date.now();
  pruneSnapshotSelfWriteIgnores(now);

  const normalized = normalizeWatchPath(filePath);
  const latestUntil = snapshotSelfWriteIgnore.latestFiles.get(normalized);
  if (latestUntil && latestUntil > now) {
    return true;
  }

  if (!normalized.endsWith('.json')) {
    return false;
  }

  for (const [dirPath, until] of snapshotSelfWriteIgnore.archiveDirs) {
    if (until > now && pathIsInsideOrEqual(normalized, dirPath)) {
      return true;
    }
  }
  return false;
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

function logSwallowedError(context: string, err: unknown): void {
  logPromptFuel(`${context} failed`, err);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logPromptFuel('Activation started.');
  combinedStatusItem = createStatusBarItem(1, 'PromptFuel loading...');
  context.subscriptions.push(combinedStatusItem);

  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.refresh', () => refreshNow({ allowAuthenticated: true, manual: true, bypassAuthenticatedBackoff: true })));
  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.openDataFolder', () => openStateFolder()));
  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.upgradeSnapshotFiles', () => upgradeSnapshotFiles()));
  registerPromptFuelPanelCommands(context, {
    refreshNow: () => refreshNow({ allowAuthenticated: true, manual: true, bypassAuthenticatedBackoff: true, suppressPanelBroadcast: true }),
    getUsageDashboardModel: () => buildUsageDashboardModel(latest.providerStates, latest.claudeTodayUsage, latest.claudeUsageHistory, latest.codexCorrelatedHistory, latest.codexCorrelatedTodayUsage, getConfig().enabledProviders, latest.remoteProviderGroups.length > 0 ? latest.remoteProviderGroups : undefined, latest.selectedRemoteProviders.length > 0 ? latest.selectedRemoteProviders : undefined, latest.remoteUsage, getConfig().snapshot.remoteMachineLabels)
  });
  logPromptFuel('Commands registered.');

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('promptFuel')) {
      configureWatchers(context);
      void refreshNow({ allowAuthenticated: true });
    }
  }));

  configureWatchers(context);
  void refreshNow({ allowAuthenticated: true })
    .then(() => logPromptFuel('Startup refresh completed.'))
    .catch(error => logPromptFuel('Startup refresh failed', error));
  logPromptFuel('Activation completed; startup refresh scheduled.');
}

export function deactivate(): void {
  if (timers.refresh) {
    clearInterval(timers.refresh);
  }
  if (timers.authenticatedRefresh) {
    clearInterval(timers.authenticatedRefresh);
  }
  cancelDebouncedRefresh();
  clearResetRefreshTimer();
  disposeWatchers();
  disposePromptFuelLogger();
}

interface RefreshOptions {
  allowAuthenticated?: boolean;
  manual?: boolean;
  bypassAuthenticatedPollDelay?: boolean;
  bypassAuthenticatedBackoff?: boolean;
  suppressPanelBroadcast?: boolean;
}

const refreshState = {
  inFlight: undefined as Promise<void> | undefined,
  queuedOptions: undefined as RefreshOptions | undefined
};

async function refreshNow(options: RefreshOptions = {}): Promise<void> {
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
        const nextRefresh = Date.now() + cfg.authenticatedQuota.refreshIntervalMinutes * 60 * 1000;
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
        const nextRefresh = Date.now() + cfg.authenticatedQuota.refreshIntervalMinutes * 60 * 1000;
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
    const usageDashboardModel = buildUsageDashboardModel(latest.providerStates, latest.claudeTodayUsage, latest.claudeUsageHistory, latest.codexCorrelatedHistory, latest.codexCorrelatedTodayUsage, effectiveProviders, latest.remoteProviderGroups.length > 0 ? latest.remoteProviderGroups : undefined, selectedDashboardRemoteProviders.length > 0 ? selectedDashboardRemoteProviders : undefined, remoteUsage, aliasMap);
    postUsageDashboardRefreshIfOpen(usageDashboardModel);
  }

  const extraModelData: Record<string, ModelContributionInput[]> = {};
  const historyData: Record<string, ProviderHistoryInput> = {};
  if (latest.claudeUsageHistory?.modelUsage && latest.claudeUsageHistory.modelUsage.length > 0) {
    extraModelData.claude = latest.claudeUsageHistory.modelUsage
      .filter(m => m.totalTokens > 0)
      .map(m => ({
        model: m.model,
        totalTokens: m.totalTokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheCreationTokens: m.cacheCreationInputTokens,
        cacheReadTokens: m.cacheReadInputTokens,
        assistantMessages: m.assistantMessages
      }));
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
            .map(m => ({
              model: m.model,
              totalTokens: m.totalTokens,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              cacheCreationTokens: m.cacheCreationInputTokens,
              cacheReadTokens: m.cacheReadInputTokens,
              assistantMessages: m.assistantMessages
            }))
        }))
    };
  }
  if (latest.codexCorrelatedHistory?.modelUsage && latest.codexCorrelatedHistory.modelUsage.length > 0) {
    extraModelData.codex = latest.codexCorrelatedHistory.modelUsage
      .filter(m => m.totalTokens > 0)
      .map(m => ({
        model: m.model,
        totalTokens: m.totalTokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheCreationTokens: m.cacheCreationInputTokens,
        cacheReadTokens: m.cacheReadInputTokens,
        reasoningOutputTokens: m.reasoningOutputTokens,
        turns: m.assistantMessages
      }));
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
            .map(m => ({
              model: m.model,
              totalTokens: m.totalTokens,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              cacheCreationTokens: m.cacheCreationInputTokens,
              cacheReadTokens: m.cacheReadInputTokens,
              reasoningOutputTokens: m.reasoningOutputTokens,
              turns: m.assistantMessages
            }))
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
    nextResetRefreshEpochMs: timers.scheduledResetRefreshEpochMs,
    modelBreakdown: modelBreakdownData
  }, remoteStatusBarItems);

  applyStatusBarItem(
    combinedStatusItem,
    formatted.text,
    `${formatted.tooltip}\n\nClick to open PromptFuel dashboard`
  );
}

function createStatusBarItem(priority: number, label: string): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.command = 'promptFuel.openDashboard';
  item.text = `$(sync~spin) ${label}`;
  item.tooltip = 'PromptFuel is starting.';
  item.show();
  return item;
}

function buildRemoteStatusBarItems(
  snapshots: ReadonlyArray<{ snapshot: { machineLabel: string; providerUsage?: Array<{ provider: string; sourceLabel: string; fiveHourUsedPercent?: number; sevenDayUsedPercent?: number; fiveHourResetAtEpochSeconds?: number; sevenDayResetAtEpochSeconds?: number; lastUpdatedEpochMs?: number; stale: boolean; source: string; sourceConfidence: string; historyBuckets?: Array<{ dateKey: string; models?: Array<{ model: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number; reasoningOutputTokens?: number; messages?: number; turns?: number }> }> }>; generatedAtEpochMs: number }; stale: boolean; staleReason?: string }>,
  statusBarSourceIds: string[],
  aliasMap: Record<string, string>,
  displayMode: DisplayMode
): FormattedProviderStatus[] {
  if (!statusBarSourceIds || statusBarSourceIds.length === 0) {
    return [];
  }

  const sourceSet = new Set(statusBarSourceIds);
  const items: FormattedProviderStatus[] = [];

  for (const vs of snapshots) {
    const machineLabel = vs.snapshot.machineLabel;
    const snapshotStale = vs.stale;
    for (const sp of vs.snapshot.providerUsage ?? []) {
      const sourceId = `${machineLabel}/${sp.provider}`;
      if (!sourceSet.has(sourceId)) {
        continue;
      }

      const statusBarLabel = formatSourceLabel(sp.provider, machineLabel, aliasMap);
      const windows: string[] = [];

      const sevenDay = sp.sevenDayUsedPercent;
      const fiveHour = sp.fiveHourUsedPercent;

      const hasSevenDay = typeof sevenDay === 'number' && sevenDay >= 0;
      const hasFiveHour = typeof fiveHour === 'number' && fiveHour >= 0;
      const resetInfo = parsePerWindowReset(
        sp.sevenDayResetAtEpochSeconds,
        sp.fiveHourResetAtEpochSeconds
      );
      const sevenDayResetEpoch = resetInfo.sevenDayResetEpoch;
      const fiveHourResetEpoch = resetInfo.fiveHourResetEpoch;

      if (hasSevenDay) {
        const remaining = Math.max(0, 100 - sevenDay);
        const emoji = quotaIndicatorForRemaining(remaining);
        if (displayMode === 'standard' && sevenDayResetEpoch) {
          windows.push(`${formatCountdown(sevenDayResetEpoch)} ${emoji}${Math.round(remaining)}%`);
        } else {
          windows.push(`${emoji}${Math.round(remaining)}%`);
        }
      }
      if (hasFiveHour) {
        const remaining = Math.max(0, 100 - (fiveHour as number));
        const emoji = quotaIndicatorForRemaining(remaining);
        if (displayMode === 'standard') {
          windows.push(`${formatCountdown(fiveHourResetEpoch)} ${emoji}${Math.round(remaining)}%`);
        } else {
          windows.push(`${emoji}${Math.round(remaining)}%`);
        }
      }

      const text = windows.length > 0
        ? `${statusBarLabel} ${windows.join(' \u00B7 ')}`
        : `${statusBarLabel} unavailable`;

      const snapshotAgeMs = typeof sp.lastUpdatedEpochMs === 'number' && sp.lastUpdatedEpochMs > 0
        ? sp.lastUpdatedEpochMs
        : vs.snapshot.generatedAtEpochMs;
      const ageStr = formatAgeLabel(snapshotAgeMs, true);

      const isFresh = !(snapshotStale || sp.stale);
      const modelContributions = isFresh
        ? aggregateSnapshotBucketModels(sp.historyBuckets, { windowDays: STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS })
        : undefined;

      const tooltip = formatRemoteProviderTooltip({
        label: statusBarLabel,
        provider: sp.provider as ProviderName,
        sevenDayRemainingPercent: hasSevenDay ? Math.max(0, 100 - (sevenDay as number)) : undefined,
        fiveHourRemainingPercent: hasFiveHour ? Math.max(0, 100 - (fiveHour as number)) : undefined,
        sevenDayResetEpochSeconds: sevenDayResetEpoch,
        fiveHourResetEpochSeconds: fiveHourResetEpoch,
        stale: snapshotStale || sp.stale,
        staleReason: vs.staleReason,
        snapshotAgeLabel: ageStr,
        snapshotEpochMs: snapshotAgeMs,
        modelContributions: modelContributions && modelContributions.length > 0 ? modelContributions : undefined
      });

      items.push({
        provider: sp.provider,
        text,
        tooltip,
        severity: snapshotStale ? 'warning' : 'normal',
        remoteQuotaData: {
          label: statusBarLabel,
          sevenDayRemainingPercent: hasSevenDay ? Math.max(0, 100 - (sevenDay as number)) : undefined,
          fiveHourRemainingPercent: hasFiveHour ? Math.max(0, 100 - (fiveHour as number)) : undefined,
          sevenDayResetEpochSeconds: sevenDayResetEpoch,
          fiveHourResetEpochSeconds: fiveHourResetEpoch,
          stale: snapshotStale || sp.stale,
          snapshotAgeLabel: ageStr
        }
      });
    }
  }

  return items;
}

function applyStatusBarItem(
  item: vscode.StatusBarItem,
  text: string,
  tooltip: string
): void {
  item.text = text;
  const md = new vscode.MarkdownString(tooltip, true);
  md.supportHtml = true;
  item.tooltip = md;
  item.show();
}

function configureWatchers(context: vscode.ExtensionContext): void {
  cancelDebouncedRefresh();
  disposeWatchers();
  if (timers.refresh) {
    clearInterval(timers.refresh);
    timers.refresh = undefined;
  }
  if (timers.authenticatedRefresh) {
    clearInterval(timers.authenticatedRefresh);
    timers.authenticatedRefresh = undefined;
  }
  clearResetRefreshTimer();

  const cfg = getConfig();
  const intervalMs = Math.max(10, cfg.refreshIntervalSeconds) * 1000;
  timers.refresh = setInterval(() => void refreshNow(), intervalMs);
  if (cfg.authenticatedQuota.enabled) {
    timers.authenticatedRefresh = setInterval(
      () => void refreshNow({ allowAuthenticated: true }),
      cfg.authenticatedQuota.refreshIntervalMinutes * 60 * 1000
    );
  }

  watchPathPattern(cfg.stateDirectory, 'claude.json', 'state claude');
  watchPathPattern(cfg.stateDirectory, 'codex.json', 'state codex');
  watchPathPattern(cfg.stateDirectory, '*.json', 'state json');
  if (cfg.snapshot.path) {
    watchPathPattern(cfg.snapshot.path, '*-latest.json', 'snapshot latest');
    watchPathPattern(path.join(cfg.snapshot.path, 'archive'), '**/*.json', 'snapshot archive');
  }
  if (cfg.enabledProviders.includes('claude')) {
    watchPathPattern(cfg.claudeProjectsPath, '**/*.jsonl', 'claude projects');
  }
  if (cfg.enabledProviders.includes('codex')) {
    watchPathPattern(cfg.codexSessionsPath, '**/*.jsonl', 'codex sessions');
  }
}

function watchPathPattern(basePath: string, filePattern: string, label: string): void {
  if (!basePath) {
    return;
  }

  try {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(path.resolve(basePath)), filePattern);
    watchPattern(pattern, label);
  } catch (err) {
    logSwallowedError(`${label} watcher setup`, err);
  }
}

function watchPattern(pattern: vscode.GlobPattern, label: string): void {
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(uri => scheduleDebouncedRefresh(uri));
    watcher.onDidChange(uri => scheduleDebouncedRefresh(uri));
    watcher.onDidDelete(uri => scheduleDebouncedRefresh(uri));
    fileWatchers.push(watcher);
  } catch (err) {
    logSwallowedError(`${label} watcher registration`, err);
  }
}

function disposeWatchers(): void {
  for (const watcher of fileWatchers) {
    watcher.dispose();
  }
  fileWatchers = [];
}

function scheduleResetRefresh(plan: ResetRefreshPlan | undefined): void {
  clearResetRefreshTimer();
  if (!plan) {
    return;
  }

  timers.scheduledResetRefreshEpochMs = plan.scheduledEpochMs;
  const delayMs = Math.max(1000, plan.scheduledEpochMs - Date.now());
  timers.resetRefresh = setTimeout(() => {
    authState.recentResetRefreshAttemptEpochMs.set(plan.key, Date.now());
    timers.resetRefresh = undefined;
    timers.scheduledResetRefreshEpochMs = undefined;
    void refreshNow({
      allowAuthenticated: true,
      bypassAuthenticatedPollDelay: true,
      bypassAuthenticatedBackoff: true
    });
  }, delayMs);
}

function clearResetRefreshTimer(): void {
  if (timers.resetRefresh) {
    clearTimeout(timers.resetRefresh);
    timers.resetRefresh = undefined;
  }
  timers.scheduledResetRefreshEpochMs = undefined;
}

async function openStateFolder(): Promise<void> {
  const cfg = getConfig();
  await fs.mkdir(cfg.stateDirectory, { recursive: true }).catch(err => logSwallowedError('state directory mkdir', err));
  await vscode.env.openExternal(vscode.Uri.file(cfg.stateDirectory));
}

async function upgradeSnapshotFiles(): Promise<void> {
  const cfg = getConfig();
  const paths: string[] = [];
  const snapshotsDir = path.join(cfg.stateDirectory, 'snapshots');
  paths.push(snapshotsDir);
  if (cfg.snapshot.path) {
    const resolved = path.resolve(cfg.snapshot.path);
    if (!paths.includes(resolved)) {
      paths.push(resolved);
    }
  }

  let upgraded = 0;
  let errors = 0;
  for (const readPath of paths) {
    const result = await readMachineSnapshots({ readEnabled: true, readPath });
    upgraded += result.snapshots.length;
    errors += result.errors.length;
  }

  if (upgraded === 0 && errors === 0) {
    void vscode.window.showInformationMessage('PromptFuel: No snapshot files found to upgrade.');
  } else if (errors > 0) {
    void vscode.window.showWarningMessage(`PromptFuel: Snapshot upgrade complete. ${upgraded} file(s) processed, ${errors} error(s).`);
  } else {
    void vscode.window.showInformationMessage(`PromptFuel: Snapshot upgrade complete. ${upgraded} file(s) processed.`);
  }
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
