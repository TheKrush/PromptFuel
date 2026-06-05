import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfig, setInternalStateDirectory } from './config';
import { disposePromptFuelLogger, logPromptFuel } from './logger';
import { registerPromptFuelPanelCommands } from './panel/promptFuelPanel';
import { buildUsageDashboardModel } from './panel/usageDashboardModel';
import { readMachineSnapshots } from './snapshot/readMachineSnapshots';
import { applyStatusBarItem, createStatusBarItem } from './statusBar';
import { loadModelPricingCsv } from './modelPricing';
import {
  cancelDebouncedRefresh,
  clearRefreshTimers,
  configureWatchers,
  disposeWatchers
} from './watchers';
import {
  clearResetRefreshTimer,
  getLatestUsageState,
  initRefreshController,
  refreshNow
} from './refreshController';

let combinedStatusItem: vscode.StatusBarItem;

function logSwallowedError(context: string, err: unknown): void {
  logPromptFuel(`${context} failed`, err);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setInternalStateDirectory(context.globalStorageUri.fsPath);
  logPromptFuel('Activation started.');
  combinedStatusItem = createStatusBarItem(1, 'PromptFuel loading...');
  context.subscriptions.push(combinedStatusItem);

  try {
    await loadModelPricingCsv(context.extensionPath);
    logPromptFuel('Model pricing CSV loaded.');
  } catch (err) {
    logSwallowedError('Loading model pricing CSV', err);
  }

  initRefreshController({
    onStatusUpdate: (text, tooltip) => applyStatusBarItem(combinedStatusItem, text, tooltip)
  });

  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.refresh', () => refreshNow({ allowAuthenticated: true, manual: true, bypassAuthenticatedBackoff: true })));
  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.openDataFolder', () => openStateFolder()));
  context.subscriptions.push(vscode.commands.registerCommand('promptFuel.upgradeSnapshotFiles', () => upgradeSnapshotFiles()));
  registerPromptFuelPanelCommands(context, {
    refreshNow: () => refreshNow({ allowAuthenticated: true, manual: true, bypassAuthenticatedBackoff: true, suppressPanelBroadcast: true }),
    getUsageDashboardModel: () => {
      const cfg = getConfig();
      const state = getLatestUsageState();
      return buildUsageDashboardModel({
        states: state.providerStates,
        claudeTodayUsage: state.claudeTodayUsage,
        claudeUsageHistory: state.claudeUsageHistory,
        codexCorrelatedHistory: state.codexCorrelatedHistory,
        codexTodayUsage: state.codexCorrelatedTodayUsage,
        enabledProviders: cfg.enabledProviders,
        remoteProviderGroups: state.remoteProviderGroups.length > 0 ? state.remoteProviderGroups : undefined,
        selectedRemoteProviders: state.selectedRemoteProviders.length > 0 ? state.selectedRemoteProviders : undefined,
        remoteUsage: state.remoteUsage,
        aliasMap: cfg.snapshot.remoteMachineLabels,
        normalizedSources: cfg.normalizedSources
      });
    }
  });
  logPromptFuel('Commands registered.');

  const watcherDeps = {
    onRefresh: () => void refreshNow(),
    onClearResetRefresh: clearResetRefreshTimer
  };

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('promptFuel')) {
      configureWatchers(context, watcherDeps);
      void refreshNow({ allowAuthenticated: true });
    }
  }));

  configureWatchers(context, watcherDeps);
  void refreshNow({ allowAuthenticated: true })
    .then(() => logPromptFuel('Startup refresh completed.'))
    .catch(error => logPromptFuel('Startup refresh failed', error));
  logPromptFuel('Activation completed; startup refresh scheduled.');
}

export function deactivate(): void {
  clearRefreshTimers();
  cancelDebouncedRefresh();
  clearResetRefreshTimer();
  disposeWatchers();
  disposePromptFuelLogger();
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

