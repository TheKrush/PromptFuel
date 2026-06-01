import * as vscode from 'vscode';
import { getConfig } from '../config';
import { PromptFuelStatus } from '../core/statusModel';
import { buildDashboardModel } from './dashboardModel';
import { buildDashboardHtml } from './dashboardHtml';

let panel: vscode.WebviewPanel | undefined;

export function openDashboardPanel(
  context: vscode.ExtensionContext,
  status: PromptFuelStatus,
  refreshAction: () => Promise<void>,
): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    updatePanel(panel, status);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'promptFuelDashboard',
    'PromptFuel Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  const messageHandler = panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.command === 'refreshDashboard') {
        await refreshAction();
        if (panel) {
          void panel.webview.postMessage({ command: 'refreshComplete' });
        }
      }
    },
  );

  panel.onDidDispose(
    () => {
      messageHandler.dispose();
      panel = undefined;
    },
    undefined,
    context.subscriptions,
  );

  updatePanel(panel, status);
}

function updatePanel(
  webviewPanel: vscode.WebviewPanel,
  status: PromptFuelStatus,
): void {
  const model = buildDashboardModel(status, getConfig().dashboardUsageSource);
  webviewPanel.webview.html = buildDashboardHtml(webviewPanel.webview, model);
}

export function postDashboardRefreshIfOpen(status: PromptFuelStatus): void {
  if (panel) {
    updatePanel(panel, status);
  }
}
