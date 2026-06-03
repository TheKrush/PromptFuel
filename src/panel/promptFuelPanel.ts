import * as vscode from 'vscode';
import { formatPromptFuelError, logPromptFuel, showPromptFuelOutput } from '../logger';
import { buildPromptFuelPanelHtml } from './promptFuelPanelView';
import { UsageDashboardModel } from './usageDashboardModel';

let panel: vscode.WebviewPanel | undefined;
let usageWorkspaceState: vscode.Memento | undefined;

type UsageHistoryLayout = 'split' | 'combined';

const USAGE_HISTORY_LAYOUT_STATE_KEY = 'promptFuel.usage.historyLayout.v2';

interface OpenPromptFuelPanelOptions {
  focusTab?: 'usage';
}

interface PromptFuelPanelActions {
  refreshNow: () => Promise<void>;
  getUsageDashboardModel: () => UsageDashboardModel;
}

interface PromptFuelPanelMessage {
  command?: string;
  layout?: string;
}

export function registerPromptFuelPanelCommands(
  context: vscode.ExtensionContext,
  actions: PromptFuelPanelActions
): void {
  usageWorkspaceState = context.workspaceState;
  logPromptFuel('Registering dashboard command.');
  context.subscriptions.push(
    vscode.commands.registerCommand('promptFuel.openDashboard', (options?: OpenPromptFuelPanelOptions) => {
      try {
        logPromptFuel('Dashboard command invoked.');
        openPromptFuelPanel(context, actions, options);
      } catch (error) {
        reportDashboardOpenError(error);
      }
    })
  );
}

function openPromptFuelPanel(
  context: vscode.ExtensionContext,
  actions: PromptFuelPanelActions,
  options: OpenPromptFuelPanelOptions = {}
): void {
  const focusTab = options.focusTab ?? 'usage';

  if (panel) {
    logPromptFuel('Revealing existing dashboard panel.');
    panel.reveal(vscode.ViewColumn.One);
    void panel.webview.postMessage({ command: 'focusTab', tab: focusTab });
    void refreshPanelUsage(actions, panel.webview);
    return;
  }

  logPromptFuel('Creating dashboard webview panel.');
  panel = vscode.window.createWebviewPanel(
    'promptFuelPanel',
    'PromptFuel',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  const panelMessageHandler = panel.webview.onDidReceiveMessage(
    (message: PromptFuelPanelMessage) => {
      if (message.command === 'refreshUsage') {
        void refreshPanelUsage(actions, panel?.webview);
      } else if (message.command === 'setUsageHistoryLayout') {
        void context.workspaceState.update(USAGE_HISTORY_LAYOUT_STATE_KEY, normalizeUsageHistoryLayout(message.layout));
      }
    }
  );

  panel.onDidDispose(() => {
    logPromptFuel('Dashboard panel disposed.');
    panelMessageHandler.dispose();
    panel = undefined;
  }, undefined, context.subscriptions);

  const cssUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'promptFuelPanel.css')
  ).toString();

  try {
    panel.webview.html = buildPromptFuelPanelHtml(cssUri, panel.webview.cspSource);
  } catch (error) {
    panel.dispose();
    panel = undefined;
    throw error;
  }
  logPromptFuel('Dashboard webview HTML assigned.');
  postUsageDashboardModel(actions, panel.webview);

  const createdPanel = panel;
  setTimeout(() => {
    if (panel === createdPanel) {
      void panel.webview.postMessage({ command: 'focusTab', tab: focusTab });
      void refreshPanelUsage(actions, panel.webview);
    }
  }, 250);
}

function reportDashboardOpenError(error: unknown): void {
  const message = formatPromptFuelError(error);
  logPromptFuel('Dashboard open failed', error);
  void vscode.window.showErrorMessage(`PromptFuel dashboard could not open: ${message}`, 'Show Output')
    .then(selection => {
      if (selection === 'Show Output') {
        showPromptFuelOutput();
      }
    });
}

async function refreshPanelUsage(
  actions: PromptFuelPanelActions,
  webview: vscode.Webview | undefined
): Promise<void> {
  if (!webview) {
    return;
  }

  logPromptFuel('Dashboard refresh started.');
  void webview.postMessage({ command: 'refreshUsageStarted' });

  try {
    await actions.refreshNow();
    logPromptFuel('Dashboard refresh completed.');
    void webview.postMessage({
      command: 'refreshUsageResult',
      success: true,
      refreshedAtIso: new Date().toISOString()
    });
  } catch (error) {
    logPromptFuel('Dashboard refresh failed', error);
    void webview.postMessage({
      command: 'refreshUsageResult',
      success: false
    });
  } finally {
    postUsageDashboardModel(actions, webview);
  }
}

function postUsageDashboardModel(
  actions: PromptFuelPanelActions,
  webview: vscode.Webview
): void {
  try {
    logPromptFuel('Posting dashboard model.');
    void webview.postMessage({
      command: 'usageDashboardModel',
      model: actions.getUsageDashboardModel(),
      historyLayout: getUsageHistoryLayout()
    });
  } catch (error) {
    const message = formatPromptFuelError(error);
    logPromptFuel('Posting dashboard model failed', error);
    void webview.postMessage({
      command: 'usageDashboardModelError',
      error: message
    });
  }
}

function getUsageHistoryLayout(): UsageHistoryLayout {
  return normalizeUsageHistoryLayout(usageWorkspaceState?.get<string>(USAGE_HISTORY_LAYOUT_STATE_KEY));
}

function normalizeUsageHistoryLayout(layout: string | undefined): UsageHistoryLayout {
  return layout === 'split' ? 'split' : 'combined';
}

export function postUsageDashboardRefreshIfOpen(model: UsageDashboardModel): void {
  const webview = panel?.webview;
  if (!webview) {
    return;
  }

  try {
    void webview.postMessage({
      command: 'refreshUsageResult',
      success: true,
      refreshedAtIso: new Date().toISOString(),
      background: true
    });
  } catch {
    return;
  }

  try {
    void webview.postMessage({
      command: 'usageDashboardModel',
      model,
      historyLayout: getUsageHistoryLayout()
    });
  } catch {
    // Panel disposed.
  }
}
