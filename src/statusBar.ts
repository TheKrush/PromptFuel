import * as vscode from 'vscode';

export { buildRemoteStatusBarItems } from './statusBarBuild';

export function createStatusBarItem(priority: number, label: string): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.command = 'promptFuel.openDashboard';
  item.text = `$(sync~spin) ${label}`;
  item.tooltip = 'PromptFuel is starting.';
  item.show();
  return item;
}

export function applyStatusBarItem(
  item: vscode.StatusBarItem,
  text: string,
  tooltip: string
): void {
  item.text = text;
  const md = new vscode.MarkdownString(tooltip, true);
  md.supportHtml = true;
  item.tooltip = md;
  item.show();
}
