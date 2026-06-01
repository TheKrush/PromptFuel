import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDataFolderUri } from './dataFolder';
import { RefreshScheduler } from './core/refreshScheduler';
import { openDashboardPanel, postDashboardRefreshIfOpen } from './panel/dashboardPanel';
import {
  ensurePromptFuelSnapshotExportFolder,
  ensurePromptFuelSnapshotImportFolder,
} from './snapshots/snapshotStorage';
import { exportPromptFuelUsageSnapshot } from './snapshots/snapshotExporter';

let scheduler: RefreshScheduler | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('PromptFuel');
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  statusBarItem.command = 'promptFuel.openDashboard';
  statusBarItem.show();

  scheduler = new RefreshScheduler(statusBarItem, context, onRefreshed, {
    info(message: string): void {
      outputChannel.appendLine(`[promptfuel] ${message}`);
    },
  });
  scheduler.start();

  const openDashboard = vscode.commands.registerCommand(
    'promptFuel.openDashboard',
    () => {
      if (scheduler) {
        openDashboardPanel(context, scheduler.status, scheduler.refreshNow.bind(scheduler));
      }
    },
  );

  const refresh = vscode.commands.registerCommand(
    'promptFuel.refresh',
    async () => {
      if (scheduler) {
        await scheduler.refreshNow();
      }
    },
  );

  const openDataFolder = vscode.commands.registerCommand(
    'promptFuel.openDataFolder',
    () => {
      const uri = getDataFolderUri(context);
      vscode.commands.executeCommand('revealFileInOS', uri);
    },
  );

  const openSnapshotImportsFolder = vscode.commands.registerCommand(
    'promptFuel.openSnapshotImportsFolder',
    async () => {
      try {
        const cfg = getConfig();
        const folderPath = await ensurePromptFuelSnapshotImportFolder(context, cfg.snapshotImportPath);
        const uri = vscode.Uri.file(folderPath);
        await vscode.commands.executeCommand('revealFileInOS', uri);
        vscode.window.showInformationMessage('Opened PromptFuel snapshot imports folder. Add aggregate snapshot JSON files there, then refresh.');
      } catch {
        vscode.window.showErrorMessage('PromptFuel could not open the configured snapshot imports folder.');
      }
    },
  );

  const exportUsageSnapshot = vscode.commands.registerCommand(
    'promptFuel.exportUsageSnapshot',
    async () => {
      if (!scheduler) {
        return;
      }
      try {
        const cfg = getConfig();
        const folderPath = await ensurePromptFuelSnapshotExportFolder(context, cfg.snapshotExportPath);
        await exportPromptFuelUsageSnapshot(scheduler.status, folderPath);
        vscode.window.showInformationMessage('Exported PromptFuel aggregate usage snapshot.');
      } catch {
        vscode.window.showErrorMessage('PromptFuel could not export the aggregate usage snapshot.');
      }
    },
  );

  context.subscriptions.push(statusBarItem, outputChannel, openDashboard, refresh, openDataFolder, openSnapshotImportsFolder, exportUsageSnapshot);
}

function onRefreshed() {
  if (scheduler) {
    postDashboardRefreshIfOpen(scheduler.status);
  }
}

export function deactivate() {
  if (scheduler) {
    scheduler.dispose();
    scheduler = undefined;
  }
}
