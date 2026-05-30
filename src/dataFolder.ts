import * as vscode from 'vscode';

export function getDataFolderUri(context: vscode.ExtensionContext): vscode.Uri {
  return context.globalStorageUri;
}

export function getDataFolderPath(context: vscode.ExtensionContext): string {
  return context.globalStorageUri.fsPath;
}
