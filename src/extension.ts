import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const openDashboard = vscode.commands.registerCommand('promptFuel.openDashboard', () => {
    vscode.window.showInformationMessage('PromptFuel: Usage Dashboard (MVP) — coming soon.');
  });

  const refresh = vscode.commands.registerCommand('promptFuel.refresh', () => {
    vscode.window.showInformationMessage('PromptFuel: Usage data refreshed.');
  });

  const openDataFolder = vscode.commands.registerCommand('promptFuel.openDataFolder', () => {
    const dataPath = context.globalStorageUri.fsPath;
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dataPath));
  });

  context.subscriptions.push(openDashboard, refresh, openDataFolder);
}

export function deactivate() {}
