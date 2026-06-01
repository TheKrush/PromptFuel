import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function logPromptFuel(message: string, error?: unknown): void {
  const text = error === undefined ? message : `${message}: ${formatPromptFuelError(error)}`;
  console.debug(`[PromptFuel] ${text}`);
  getOutputChannel().appendLine(`${new Date().toISOString()} ${text}`);
}

export function showPromptFuelOutput(): void {
  getOutputChannel().show(true);
}

export function disposePromptFuelLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}

export function formatPromptFuelError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`.replace(/\s+/g, ' ').trim()
    : String(error || 'unknown error');
}

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('PromptFuel');
  return outputChannel;
}
