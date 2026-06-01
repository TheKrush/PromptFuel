import { promises as fs } from 'fs';
import * as path from 'path';
import { getDataFolderPath } from '../dataFolder';

export const PROMPTFUEL_SNAPSHOT_IMPORT_FOLDER = 'snapshot-imports';

interface SnapshotStorageContext {
  globalStorageUri: {
    fsPath: string;
  };
}

export function getPromptFuelSnapshotImportFolderPath(storageRootPath: string): string {
  return path.join(storageRootPath, PROMPTFUEL_SNAPSHOT_IMPORT_FOLDER);
}

export function getEffectivePromptFuelSnapshotImportFolderPath(
  storageRootPath: string,
  configuredPath?: string,
): string {
  const trimmed = configuredPath?.trim();
  return trimmed ? path.resolve(trimmed) : getPromptFuelSnapshotImportFolderPath(storageRootPath);
}

export function getPromptFuelSnapshotImportFolderPathFromContext(
  context: SnapshotStorageContext,
  configuredPath?: string,
): string {
  return getEffectivePromptFuelSnapshotImportFolderPath(getDataFolderPath(context), configuredPath);
}

export function getPromptFuelSnapshotExportFolderPathFromContext(
  context: SnapshotStorageContext,
  configuredPath?: string,
): string {
  return getPromptFuelSnapshotImportFolderPathFromContext(context, configuredPath);
}

export async function ensurePromptFuelSnapshotImportFolder(
  context: SnapshotStorageContext,
  configuredPath?: string,
): Promise<string> {
  const folderPath = getPromptFuelSnapshotImportFolderPathFromContext(context, configuredPath);
  await fs.mkdir(folderPath, { recursive: true });
  return folderPath;
}

export async function ensurePromptFuelSnapshotExportFolder(
  context: SnapshotStorageContext,
  configuredPath?: string,
): Promise<string> {
  const folderPath = getPromptFuelSnapshotExportFolderPathFromContext(context, configuredPath);
  await fs.mkdir(folderPath, { recursive: true });
  return folderPath;
}
