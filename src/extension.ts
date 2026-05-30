import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDataFolderUri } from './dataFolder';
import { formatRefreshSummary, formatStatusBarText } from './core/formatQuota';
import { ReadResult } from './core/providerReader';
import { ProviderQuotaState, ProviderQuotaStatus } from './core/quotaTypes';
import { ClaudeLocalReader } from './providers/claudeLocal';
import { CodexLocalReader } from './providers/codexLocal';
import { runEnabledReaders } from './providers/readProviders';

let statusBarItem: vscode.StatusBarItem | undefined;

function resultToQuotaState(result: ReadResult): ProviderQuotaState {
  let status: ProviderQuotaStatus = 'no-data';
  if (result.status === 'error') {
    status = 'unknown';
  } else if (result.status === 'ok' && (result.totalTokens ?? 0) > 0) {
    status = 'loaded';
  }
  return {
    providerId: result.providerId,
    status,
    totalTokens: result.totalTokens,
    totalAssistantMessages: result.totalAssistantMessages,
  };
}

function initStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  const cfg = getConfig();
  const states: ProviderQuotaState[] = cfg.enabledProviders.map(id => ({
    providerId: id,
    status: 'no-data' as const,
  }));
  statusBarItem.text = formatStatusBarText(states);
  statusBarItem.tooltip = 'PromptFuel — loading...';
}

async function runRefresh(): Promise<void> {
  if (!statusBarItem) {
    return;
  }
  const cfg = getConfig();
  const readers = [new ClaudeLocalReader(), new CodexLocalReader()];

  let results: ReadResult[];
  try {
    results = await runEnabledReaders(readers, cfg.enabledProviders);
  } catch {
    results = cfg.enabledProviders.map(id => ({ providerId: id, status: 'error' as const }));
  }

  const states = results.map(resultToQuotaState);
  statusBarItem.text = formatStatusBarText(states);
  statusBarItem.tooltip = 'PromptFuel — click to open dashboard';

  const summary = formatRefreshSummary(results);
  vscode.window.showInformationMessage(`PromptFuel: ${summary}`);
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'promptFuel.openDashboard';
  statusBarItem.show();
  initStatusBar();

  const openDashboard = vscode.commands.registerCommand('promptFuel.openDashboard', () => {
    vscode.window.showInformationMessage('PromptFuel: Usage Dashboard — coming soon.');
  });

  const refresh = vscode.commands.registerCommand('promptFuel.refresh', () => {
    void runRefresh();
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
