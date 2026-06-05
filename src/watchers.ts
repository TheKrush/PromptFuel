import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { logPromptFuel } from './logger';

const WATCHER_DEBOUNCE_MS = 500;
const SNAPSHOT_SELF_WRITE_IGNORE_MS = 5_000;

let fileWatchers: vscode.FileSystemWatcher[] = [];
let watcherDebounceTimer: NodeJS.Timeout | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

const snapshotSelfWriteIgnore = {
  latestFiles: new Map<string, number>(),
  archiveDirs: new Map<string, number>()
};

let _onRefresh: (() => void) | undefined;

export interface WatcherDeps {
  onRefresh: () => void;
  onClearResetRefresh: () => void;
}

function logSwallowedError(context: string, err: unknown): void {
  logPromptFuel(`${context} failed`, err);
}

function sanitizeSnapshotMachineLabel(label: string): string {
  const sanitized = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized || 'unknown';
}

function normalizeWatchPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathIsInsideOrEqual(filePath: string, dirPath: string): boolean {
  return filePath === dirPath || filePath.startsWith(dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`);
}

function pruneSnapshotSelfWriteIgnores(now: number): void {
  for (const [filePath, until] of snapshotSelfWriteIgnore.latestFiles) {
    if (until <= now) {
      snapshotSelfWriteIgnore.latestFiles.delete(filePath);
    }
  }
  for (const [dirPath, until] of snapshotSelfWriteIgnore.archiveDirs) {
    if (until <= now) {
      snapshotSelfWriteIgnore.archiveDirs.delete(dirPath);
    }
  }
}

function shouldIgnoreSnapshotSelfWrite(filePath: string): boolean {
  const now = Date.now();
  pruneSnapshotSelfWriteIgnores(now);

  const normalized = normalizeWatchPath(filePath);
  const latestUntil = snapshotSelfWriteIgnore.latestFiles.get(normalized);
  if (latestUntil && latestUntil > now) {
    return true;
  }

  if (!normalized.endsWith('.json')) {
    return false;
  }

  for (const [dirPath, until] of snapshotSelfWriteIgnore.archiveDirs) {
    if (until > now && pathIsInsideOrEqual(normalized, dirPath)) {
      return true;
    }
  }
  return false;
}

function scheduleDebouncedRefresh(uri?: vscode.Uri): void {
  if (uri && shouldIgnoreSnapshotSelfWrite(uri.fsPath)) {
    return;
  }
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer);
  }
  watcherDebounceTimer = setTimeout(() => {
    watcherDebounceTimer = undefined;
    _onRefresh?.();
  }, WATCHER_DEBOUNCE_MS);
}

function watchPattern(pattern: vscode.GlobPattern, label: string): void {
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(uri => scheduleDebouncedRefresh(uri));
    watcher.onDidChange(uri => scheduleDebouncedRefresh(uri));
    watcher.onDidDelete(uri => scheduleDebouncedRefresh(uri));
    fileWatchers.push(watcher);
  } catch (err) {
    logSwallowedError(`${label} watcher registration`, err);
  }
}

function watchPathPattern(basePath: string, filePattern: string, label: string): void {
  if (!basePath) {
    return;
  }

  try {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(path.resolve(basePath)), filePattern);
    watchPattern(pattern, label);
  } catch (err) {
    logSwallowedError(`${label} watcher setup`, err);
  }
}

export function cancelDebouncedRefresh(): void {
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer);
    watcherDebounceTimer = undefined;
  }
}

export function disposeWatchers(): void {
  for (const watcher of fileWatchers) {
    watcher.dispose();
  }
  fileWatchers = [];
}

export function clearRefreshTimers(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export function markSnapshotSelfWriteTargets(cfg: {
  stateDirectory: string;
  snapshot: { enabled: boolean; machineLabel?: string; path?: string };
}): void {
  if (!cfg.snapshot.enabled) {
    return;
  }

  const machineSegment = sanitizeSnapshotMachineLabel(cfg.snapshot.machineLabel || 'unknown');
  const roots = [
    path.join(cfg.stateDirectory, 'snapshots'),
    cfg.snapshot.path ? path.resolve(cfg.snapshot.path) : ''
  ].filter((root, index, all): root is string => Boolean(root) && all.indexOf(root) === index);
  const until = Date.now() + SNAPSHOT_SELF_WRITE_IGNORE_MS;

  for (const root of roots) {
    snapshotSelfWriteIgnore.latestFiles.set(
      normalizeWatchPath(path.join(root, `${machineSegment}-latest.json`)),
      until
    );
    snapshotSelfWriteIgnore.archiveDirs.set(
      normalizeWatchPath(path.join(root, 'archive', machineSegment)),
      until
    );
  }
}

export function configureWatchers(_context: vscode.ExtensionContext, deps: WatcherDeps): void {
  _onRefresh = deps.onRefresh;
  cancelDebouncedRefresh();
  disposeWatchers();
  clearRefreshTimers();
  deps.onClearResetRefresh();

  const cfg = getConfig();
  const intervalMs = Math.max(1, cfg.refreshIntervalMinutes) * 60 * 1000;
  refreshTimer = setInterval(() => deps.onRefresh(), intervalMs);

  watchPathPattern(cfg.stateDirectory, 'claude.json', 'state claude');
  watchPathPattern(cfg.stateDirectory, 'codex.json', 'state codex');
  watchPathPattern(cfg.stateDirectory, '*.json', 'state json');
  if (cfg.snapshot.path) {
    watchPathPattern(cfg.snapshot.path, '*-latest.json', 'snapshot latest');
    watchPathPattern(path.join(cfg.snapshot.path, 'archive'), '**/*.json', 'snapshot archive');
  }
  if (cfg.enabledProviders.includes('claude')) {
    watchPathPattern(cfg.claudeProjectsPath, '**/*.jsonl', 'claude projects');
  }
  if (cfg.enabledProviders.includes('codex')) {
    watchPathPattern(cfg.codexSessionsPath, '**/*.jsonl', 'codex sessions');
  }
}
