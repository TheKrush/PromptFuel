import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';

const DEFAULT_TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SnapshotCleanupOptions {
  nowEpochMs?: number;
  tempFileMaxAgeMs?: number;
  backupFileMaxAgeMs?: number;
}

export interface SnapshotCleanupResult {
  deleted: string[];
}

function isSnapshotTempFile(fileName: string): boolean {
  return /\.json\.tmp\..+/.test(fileName);
}

function isSnapshotBackupFile(fileName: string): boolean {
  return /\.json\.bak$/.test(fileName);
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function collectSnapshotCleanupDirs(rootDir: string): Promise<string[]> {
  const dirs = [rootDir];
  const archiveRoot = path.join(rootDir, 'archive');
  const machineEntries = await safeReadDir(archiveRoot);

  for (const machineEntry of machineEntries) {
    if (!machineEntry.isDirectory()) {
      continue;
    }

    const machineDir = path.join(archiveRoot, machineEntry.name);
    dirs.push(machineDir);

    const archiveEntries = await safeReadDir(machineDir);
    for (const archiveEntry of archiveEntries) {
      if (archiveEntry.isDirectory() && /^\d{4}$/.test(archiveEntry.name)) {
        dirs.push(path.join(machineDir, archiveEntry.name));
      }
    }
  }

  return dirs;
}

async function cleanupCandidateFile(
  filePath: string,
  fileName: string,
  nowEpochMs: number,
  tempFileMaxAgeMs: number,
  backupFileMaxAgeMs: number,
  deleted: string[]
): Promise<void> {
  const isTemp = isSnapshotTempFile(fileName);
  const isBackup = isSnapshotBackupFile(fileName);
  if (!isTemp && !isBackup) {
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return;
    }

    const maxAgeMs = isTemp ? tempFileMaxAgeMs : backupFileMaxAgeMs;
    if (nowEpochMs - stats.mtimeMs < maxAgeMs) {
      return;
    }

    await fs.unlink(filePath);
    deleted.push(filePath);
  } catch (error) {
    console.debug(`PromptFuel: failed to clean stale snapshot file ${fileName}`, error);
  }
}

export async function cleanupSnapshotFiles(
  rootDir: string,
  options: SnapshotCleanupOptions = {}
): Promise<SnapshotCleanupResult> {
  const nowEpochMs = options.nowEpochMs ?? Date.now();
  const tempFileMaxAgeMs = options.tempFileMaxAgeMs ?? DEFAULT_TEMP_FILE_MAX_AGE_MS;
  const backupFileMaxAgeMs = options.backupFileMaxAgeMs ?? DEFAULT_BACKUP_FILE_MAX_AGE_MS;
  const deleted: string[] = [];

  const dirs = await collectSnapshotCleanupDirs(rootDir);
  for (const dir of dirs) {
    const entries = await safeReadDir(dir);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      await cleanupCandidateFile(
        path.join(dir, entry.name),
        entry.name,
        nowEpochMs,
        tempFileMaxAgeMs,
        backupFileMaxAgeMs,
        deleted
      );
    }
  }

  return { deleted };
}

export async function cleanupTempSnapshotFile(tmpPath: string): Promise<void> {
  try {
    await fs.unlink(tmpPath);
  } catch {
    // Best effort only; callers should preserve the original write failure.
  }
}
