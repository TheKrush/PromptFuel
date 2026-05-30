import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDataFolderUri } from './dataFolder';
import { formatStatusBarText, formatRefreshSummary, formatTooltip } from './core/formatQuota';
import {
  createInitialStatus,
  applyRefreshResults,
  PromptFuelStatus,
} from './core/statusModel';
import { ReadResult } from './core/providerReader';
import { ClaudeLocalReader } from './providers/claudeLocal';
import { CodexLocalReader } from './providers/codexLocal';
import { runEnabledReaders } from './providers/readProviders';

let statusBarItem: vscode.StatusBarItem | undefined;
let statusState: PromptFuelStatus | undefined;

function updateBar(): void {
  if (!statusBarItem || !statusState) {
    return;
  }
  statusBarItem.text = formatStatusBarText(statusState);
  statusBarItem.tooltip = formatTooltip(statusState);
}

async function runRefresh(): Promise<void> {
  if (!statusBarItem || !statusState) {
    return;
  }
  const cfg = getConfig();
  const readers = [new ClaudeLocalReader(), new CodexLocalReader()];

  let results: ReadResult[];
  try {
    results = await runEnabledReaders(readers, cfg.enabledProviders);
  } catch {
    results = cfg.enabledProviders.map(id => ({
      providerId: id,
      status: 'error' as const,
    }));
  }

  statusState = applyRefreshResults(statusState, results);
  updateBar();

  const summary = formatRefreshSummary(results);
  vscode.window.showInformationMessage(`PromptFuel: ${summary}`);
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'promptFuel.openDashboard';
  statusBarItem.show();

  const cfg = getConfig();
  statusState = createInitialStatus(cfg.enabledProviders);
  updateBar();

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
  statusState = undefined;
}
