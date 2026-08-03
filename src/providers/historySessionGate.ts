import type { HistorySessionStatus } from './progressiveHistory';

export interface HistorySessionGateInput {
  runningStatus: HistorySessionStatus | undefined;
  runningDirPath: string | undefined;
  requestedDirPath: string;
}

/**
 * Decides whether the refresh controller should start a fresh progressive
 * history session for a provider, or let an already-running same-root session
 * run to completion instead. A refresh burst (e.g. the file watcher firing
 * every ~500ms while a coding session is actively appending to its JSONL log)
 * must not perpetually restart the in-flight staged scan at '1D' before it
 * ever reaches 'ALL' -- that would leave history stuck on an early stage
 * indefinitely during the exact usage pattern the feature exists to track.
 * A source-root change must still supersede immediately, so the guard only
 * holds when the requested root matches the root the running session started
 * with.
 */
export function shouldStartHistorySession(input: HistorySessionGateInput): boolean {
  if (input.runningStatus === 'running' && input.runningDirPath === input.requestedDirPath) {
    return false;
  }
  return true;
}
