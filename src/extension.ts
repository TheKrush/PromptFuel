import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDataFolderUri } from './dataFolder';
import { RefreshScheduler } from './core/refreshScheduler';

let scheduler: RefreshScheduler | undefined;

export function activate(context: vscode.ExtensionContext) {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  statusBarItem.command = 'promptFuel.openDashboard';
  statusBarItem.show();

  scheduler = new RefreshScheduler(statusBarItem, context);
  scheduler.start();

  const openDashboard = vscode.commands.registerCommand(
    'promptFuel.openDashboard',
    () => {
      vscode.window.showInformationMessage(
        'PromptFuel: Usage Dashboard — coming soon.',
      );
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

  context.subscriptions.push(statusBarItem, openDashboard, refresh, openDataFolder);
}

export function deactivate() {
  if (scheduler) {
    scheduler.dispose();
    scheduler = undefined;
  }
}
