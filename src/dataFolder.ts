import * as vscode from 'vscode';

interface DataFolderContext {
  globalStorageUri: {
    fsPath: string;
  };
}

export function getDataFolderUri(context: vscode.ExtensionContext): vscode.Uri {
  return context.globalStorageUri;
}

export function getDataFolderPath(context: DataFolderContext): string {
  return context.globalStorageUri.fsPath;
}
