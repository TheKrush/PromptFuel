import * as vscode from 'vscode';
import { getConfig, PromptFuelConfig } from '../config';
import { PromptFuelStatus, createInitialStatus, applyRefreshResults } from './statusModel';
import { formatStatusBarText, formatTooltip } from './formatQuota';
import { ClaudeLocalReader } from '../providers/claudeLocal';
import { CodexLocalReader } from '../providers/codexLocal';
import { runEnabledReaders } from '../providers/readProviders';

export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;
  private statusState: PromptFuelStatus;
  private configListener: vscode.Disposable | undefined;

  constructor(
    private readonly statusBarItem: vscode.StatusBarItem,
    private readonly context: vscode.ExtensionContext,
  ) {
    const cfg = getConfig();
    this.statusState = createInitialStatus(cfg.enabledProviders);
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
    this.statusState = createInitialStatus(cfg.enabledProviders);
    this.updateBar();
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
        this.statusState = createInitialStatus(cfg.enabledProviders);
        this.updateBar();
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
    const readers = [new ClaudeLocalReader(), new CodexLocalReader()];

    let results;
    try {
      results = await runEnabledReaders(readers, cfg.enabledProviders);
    } catch {
      results = cfg.enabledProviders.map((id) => ({
        providerId: id,
        status: 'error' as const,
      }));
    }

    try {
      this.statusState = applyRefreshResults(this.statusState, results);
      this.updateBar();
    } finally {
      this.running = false;
    }
  }

  private updateBar(): void {
    this.statusBarItem.text = formatStatusBarText(this.statusState);
    this.statusBarItem.tooltip = formatTooltip(this.statusState);
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
