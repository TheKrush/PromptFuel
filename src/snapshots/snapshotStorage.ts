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

export function getPromptFuelSnapshotImportFolderPathFromContext(
  context: SnapshotStorageContext,
): string {
  return getPromptFuelSnapshotImportFolderPath(getDataFolderPath(context));
}

export async function ensurePromptFuelSnapshotImportFolder(
  context: SnapshotStorageContext,
): Promise<string> {
  const folderPath = getPromptFuelSnapshotImportFolderPathFromContext(context);
  await fs.mkdir(folderPath, { recursive: true });
  return folderPath;
}
