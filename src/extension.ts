import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDataFolderUri } from './dataFolder';
import { formatStatusBarText } from './core/formatQuota';
import { ProviderQuotaState } from './core/quotaTypes';

let statusBarItem: vscode.StatusBarItem | undefined;

function buildPlaceholderStates(enabledProviders: string[]): ProviderQuotaState[] {
  return enabledProviders.map(id => ({ providerId: id, status: 'no-data' as const }));
}

function refreshStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  const cfg = getConfig();
  const states = buildPlaceholderStates(cfg.enabledProviders);
  statusBarItem.text = formatStatusBarText(states);
  statusBarItem.tooltip = 'PromptFuel — provider data not yet implemented';
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'promptFuel.openDashboard';
  statusBarItem.show();
  refreshStatusBar();

  const openDashboard = vscode.commands.registerCommand('promptFuel.openDashboard', () => {
    vscode.window.showInformationMessage('PromptFuel: Usage Dashboard — coming soon.');
  });

  const refresh = vscode.commands.registerCommand('promptFuel.refresh', () => {
    refreshStatusBar();
    vscode.window.showInformationMessage('PromptFuel: refreshed.');
  });

  const openDataFolder = vscode.commands.registerCommand('promptFuel.openDataFolder', () => {
    const uri = getDataFolderUri(context);
    vscode.commands.executeCommand('revealFileInOS', uri);
  });

  context.subscriptions.push(statusBarItem, openDashboard, refresh, openDataFolder);
}

export function deactivate() {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
