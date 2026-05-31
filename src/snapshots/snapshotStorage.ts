import * as path from 'path';
import * as vscode from 'vscode';
import { getDataFolderPath } from '../dataFolder';

export const PROMPTFUEL_SNAPSHOT_IMPORT_FOLDER = 'snapshot-imports';

export function getPromptFuelSnapshotImportFolderPath(storageRootPath: string): string {
  return path.join(storageRootPath, PROMPTFUEL_SNAPSHOT_IMPORT_FOLDER);
}

export function getPromptFuelSnapshotImportFolderPathFromContext(
  context: vscode.ExtensionContext,
): string {
  return getPromptFuelSnapshotImportFolderPath(getDataFolderPath(context));
}
