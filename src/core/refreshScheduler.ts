import * as vscode from 'vscode';
import { getConfig } from '../config';
import { PromptFuelStatus, createInitialStatus, applyRefreshResults, applyLiveQuotaResults, applySnapshotReadResults } from './statusModel';
import { formatStatusBarText, formatTooltip } from './formatQuota';
import { ReadResult } from './providerReader';
import { LiveQuotaStatus } from './liveQuotaTypes';
import { getGenericQuotaUnavailableMessage } from './liveQuotaTypes';
import { applyLiveQuotaCacheFallback, type LiveQuotaDiagnostics } from './liveQuotaCache';
import { createEmptySnapshotState, type PromptFuelSnapshotState } from './snapshotTypes';
import { ClaudeLocalReader } from '../providers/claudeLocal';
import { CodexLocalReader } from '../providers/codexLocal';
import { runEnabledReaders } from '../providers/readProviders';
import { runLiveQuotaReaders } from '../providers/readLiveQuota';
import { createAuthenticatedReader } from '../providers/authenticatedQuota';
import { readPromptFuelSnapshots, type SnapshotDiagnostics } from '../snapshots/snapshotReader';
import { getPromptFuelSnapshotImportFolderPathFromContext } from '../snapshots/snapshotStorage';

export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;
  private statusState: PromptFuelStatus;
  private configListener: vscode.Disposable | undefined;

  constructor(
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly context: vscode.ExtensionContext,
    private readonly onRefreshed?: () => void,
    private readonly diagnostics?: LiveQuotaDiagnostics & SnapshotDiagnostics,
  ) {
    const cfg = getConfig();
    this.statusState = createInitialStatus(cfg.enabledProviders, cfg.liveQuotaEnabled);
  }

  public get status(): PromptFuelStatus {
    return this.statusState;
  }

  public start(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    const cfg = getConfig();
    this.statusState = createInitialStatus(cfg.enabledProviders, cfg.liveQuotaEnabled);
    this.updateBar();
    this.onRefreshed?.();
    void this.runRefresh();
    this.scheduleNext(cfg.refreshIntervalMinutes);
    this.watchConfig();
  }

  public async refreshNow(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.running) {
      return;
    }
    await this.runRefresh();
  }

  private watchConfig(): void {
    if (this.configListener) {
      return;
    }
    this.configListener = vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (!e.affectsConfiguration('promptFuel')) {
          return;
        }
        const cfg = getConfig();
        this.statusState = createInitialStatus(cfg.enabledProviders, cfg.liveQuotaEnabled);
        this.updateBar();
        this.onRefreshed?.();
        void this.runRefresh();
        this.scheduleNext(cfg.refreshIntervalMinutes);
      },
    );
    this.context.subscriptions.push(this.configListener);
  }

  private async runRefresh(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    const cfg = getConfig();
    const localReaders = [new ClaudeLocalReader(), new CodexLocalReader()];

    let localResults: ReadResult[];
    let liveResults: LiveQuotaStatus[] = [];
    let snapshotState: PromptFuelSnapshotState = createEmptySnapshotState();

    const snapshotRead = readPromptFuelSnapshots({
      snapshotDir: getPromptFuelSnapshotImportFolderPathFromContext(this.context, cfg.snapshotImportPath),
      enabledProviderIds: cfg.enabledProviders,
      localMachineLabel: cfg.localMachineLabel || undefined,
      snapshotImportLabels: cfg.snapshotImportLabels,
      diagnostics: this.diagnostics,
    }).then(result => result.state).catch(() => {
      this.diagnostics?.info('malformed snapshot ignored; count=1');
      return createEmptySnapshotState(Date.now());
    });

    if (cfg.liveQuotaEnabled) {
      const liveReaders = await Promise.all(
        cfg.enabledProviders.map(id => createAuthenticatedReader(id)),
      );
      try {
        [localResults, liveResults, snapshotState] = await Promise.all([
          runEnabledReaders(localReaders, cfg.enabledProviders),
          runLiveQuotaReaders(liveReaders, cfg.enabledProviders),
          snapshotRead,
        ]);
        liveResults = await applyLiveQuotaCacheFallback({
          storage: this.context.globalState,
          enabledProviderIds: cfg.enabledProviders,
          liveQuotaEnabled: true,
          liveResults,
          diagnostics: this.diagnostics,
        });
      } catch {
        snapshotState = await snapshotRead;
        localResults = cfg.enabledProviders.map((id) => ({
          providerId: id,
          status: 'error' as const,
        }));
        liveResults = await applyLiveQuotaCacheFallback({
          storage: this.context.globalState,
          enabledProviderIds: cfg.enabledProviders,
          liveQuotaEnabled: true,
          liveResults: createUnavailableLiveQuotaResults(cfg.enabledProviders),
          diagnostics: this.diagnostics,
        });
      }
    } else {
      this.diagnostics?.info('live quota disabled; stale cache not used');
      try {
        [localResults, snapshotState] = await Promise.all([
          runEnabledReaders(localReaders, cfg.enabledProviders),
          snapshotRead,
        ]);
      } catch {
        snapshotState = await snapshotRead;
        localResults = cfg.enabledProviders.map((id) => ({
          providerId: id,
          status: 'error' as const,
        }));
      }
    }

    try {
      this.statusState = applyRefreshResults(this.statusState, localResults);
      this.statusState = applySnapshotReadResults(this.statusState, snapshotState);
      if (cfg.liveQuotaEnabled) {
        this.statusState = applyLiveQuotaResults(this.statusState, liveResults);
      }
      this.updateBar();
      this.onRefreshed?.();
    } finally {
      this.running = false;
    }
  }

  private updateBar(): void {
    this.statusBarItem.text = formatStatusBarText(this.statusState);
    const tooltip = new vscode.MarkdownString(formatTooltip(this.statusState), true);
    tooltip.supportHtml = true;
    this.statusBarItem.tooltip = tooltip;
  }

  private scheduleNext(intervalMinutes: number): void {
    this.stop();
    if (this.disposed) {
      return;
    }
    if (intervalMinutes <= 0) {
      return;
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    this.timer = setTimeout(async () => {
      await this.runRefresh();
      if (!this.disposed) {
        this.scheduleNext(getConfig().refreshIntervalMinutes);
      }
    }, intervalMs);
  }

  private stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.stop();
  }
}

function createUnavailableLiveQuotaResults(providerIds: string[]): LiveQuotaStatus[] {
  return providerIds.map(providerId => ({
    providerId,
    windows: [],
    status: 'unavailable',
    freshness: 'unavailable',
    lastUpdatedEpochMs: Date.now(),
    sanitizedMessage: getGenericQuotaUnavailableMessage(),
  }));
}
