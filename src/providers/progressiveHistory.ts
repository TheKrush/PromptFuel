import type { ProviderName } from '../types';

// ---------------------------------------------------------------------------
// Background per-provider progressive history.
//
// A provider's history is loaded in stages (1d -> 7d -> 30d -> 365d -> all),
// each stage published as available. Stage ordering, per-provider session
// supersession (a new generation cancels the previous one), and publish
// ordering live here so the orchestration is unit-testable without vscode.
//
// The cache under the reader is shared across stages: scanning is at-most-once
// per file per generation because each stage reads through the same per-file
// contribution cache, so later stages only merge the already-bucketed days.
// ---------------------------------------------------------------------------

export type ProgressiveStageKey = '1D' | '7D' | '30D' | '365D' | 'ALL';

export interface ProgressiveStageInfo {
  key: ProgressiveStageKey;
  label: string;
  /** Number of calendar days for the stage, or null for all-time history. */
  days: number | null;
}

export const PROGRESSIVE_STAGES: readonly ProgressiveStageInfo[] = [
  { key: '1D', label: 'today', days: 1 },
  { key: '7D', label: '7 days', days: 7 },
  { key: '30D', label: '30 days', days: 30 },
  { key: '365D', label: '12 months', days: 365 },
  { key: 'ALL', label: 'all history', days: null }
];

/** Read horizon used for the all-time stage (generous; JSONL history is far shorter). */
export const PROGRESSIVE_ALL_HORIZON_DAYS = 3650;

export type HistorySessionStatus = 'running' | 'completed' | 'superseded' | 'error';

export interface HistorySessionState {
  sessionId: number;
  provider: ProviderName;
  status: HistorySessionStatus;
  finishedStages: ProgressiveStageKey[];
  currentStage?: ProgressiveStageKey;
  stageStartedAtEpochMs?: number;
  lastStageFinishedAtEpochMs?: number;
  lastStageRecordsMatched?: number;
  error?: string;
}

export interface ProviderHistoryProgress {
  provider: ProviderName;
  status: HistorySessionStatus;
  stages: ProgressiveStageInfo[];
  finishedStages: ProgressiveStageKey[];
  currentStage?: ProgressiveStageKey;
  lastStageFinishedAtEpochMs?: number;
  lastStageRecordsMatched?: number;
  error?: string;
}

export interface StageRead<T> {
  history: T;
  recordsMatched: number;
}

export interface ProgressiveEngineHooks<T> {
  /** Reads one stage (e.g. readClaudeHistoryIncremental with stage days). */
  readStage: (stage: ProgressiveStageInfo) => Promise<StageRead<T>>;
  /** Applies a completed stage (e.g. publish the history into `latest`). */
  applyStage: (stage: ProgressiveStageInfo, read: StageRead<T>) => void | Promise<void>;
  /** Publishes a progress snapshot (e.g. dashboard model + status bar note). */
  publishProgress: (progress: ProviderHistoryProgress) => void | Promise<void>;
}

export interface ProgressiveHistorySessionEngine<T> {
  readonly provider: ProviderName;
  readonly sessionId: number;
  readonly state: HistorySessionState;
  start: () => Promise<void>;
  /** Resolves when this session finishes (completed, superseded, or errored). */
  done: Promise<void>;
}

interface SessionRecord<T> {
  engine: ProgressiveHistorySessionEngine<T>;
  state: HistorySessionState;
  hooks: ProgressiveEngineHooks<T>;
  stages: readonly ProgressiveStageInfo[];
  superseded: boolean;
}

export interface ProgressiveHistoryManager<T> {
  /**
   * Starts (or supersedes) a session for a provider and runs its stages in the
   * background. `stages` defaults to the full 1D->7D->30D->365D->ALL ladder
   * (cold load / first reveal); pass a narrower list (e.g. just the ALL stage)
   * for a warm refresh of an already-fully-loaded provider, so a routine
   * refresh doesn't replay the whole progressive reveal -- there is nothing
   * left to reveal, and replaying it is both wasted work and the source of
   * every "briefly reports a narrower window than what's already on screen"
   * defect found in review.
   */
  startSession: (provider: ProviderName, hooks: ProgressiveEngineHooks<T>, stages?: readonly ProgressiveStageInfo[]) => ProgressiveHistorySessionEngine<T>;
  getProgress: (provider: ProviderName) => ProviderHistoryProgress | undefined;
  isCurrent: (provider: ProviderName, sessionId: number) => boolean;
}

export function createProgressiveHistoryManager<T>(): ProgressiveHistoryManager<T> {
  const sessions = new Map<ProviderName, SessionRecord<T>>();
  let nextSessionId = 0;

  function buildProgress(state: HistorySessionState, stages: readonly ProgressiveStageInfo[]): ProviderHistoryProgress {
    return {
      provider: state.provider,
      status: state.status,
      stages: stages.map(stage => ({ ...stage })),
      finishedStages: [...state.finishedStages],
      ...(state.currentStage !== undefined ? { currentStage: state.currentStage } : {}),
      ...(state.stageStartedAtEpochMs !== undefined ? { stageStartedAtEpochMs: state.stageStartedAtEpochMs } : {}),
      ...(state.lastStageFinishedAtEpochMs !== undefined ? { lastStageFinishedAtEpochMs: state.lastStageFinishedAtEpochMs } : {}),
      ...(state.lastStageRecordsMatched !== undefined ? { lastStageRecordsMatched: state.lastStageRecordsMatched } : {}),
      ...(state.error !== undefined ? { error: state.error } : {})
    };
  }

  async function runSession(record: SessionRecord<T>): Promise<void> {
    const { state, hooks, stages } = record;
    const isActive = () => !record.superseded;
    const publish = () => safePublish(hooks, buildProgress(state, stages));

    state.status = 'running';
    await publish();

    for (const stage of stages) {
      if (!isActive()) {
        state.status = 'superseded';
        return;
      }
      state.currentStage = stage.key;
      state.stageStartedAtEpochMs = Date.now();
      await publish();

      let read: StageRead<T>;
      try {
        read = await hooks.readStage(stage);
      } catch (error) {
        state.currentStage = undefined;
        state.status = 'error';
        state.error = sanitizeStageError(error);
        await publish();
        return;
      }
      if (!isActive()) {
        state.status = 'superseded';
        return;
      }

      await safeApply(hooks, stage, read);
      if (!isActive()) {
        state.status = 'superseded';
        return;
      }

      state.finishedStages.push(stage.key);
      state.currentStage = undefined;
      state.lastStageFinishedAtEpochMs = Date.now();
      state.lastStageRecordsMatched = read.recordsMatched;
      await publish();
    }

    if (!isActive()) {
      state.status = 'superseded';
      return;
    }
    state.status = 'completed';
    await publish();
  }

  return {
    startSession(provider, hooks, stages = PROGRESSIVE_STAGES) {
      const previous = sessions.get(provider);
      if (previous) {
        previous.superseded = true;
        previous.state.status = 'superseded';
      }
      const sessionId = ++nextSessionId;
      const state: HistorySessionState = {
        sessionId,
        provider,
        status: 'running',
        finishedStages: []
      };
      const record: SessionRecord<T> = {
        engine: null as unknown as ProgressiveHistorySessionEngine<T>,
        state,
        hooks,
        stages,
        superseded: false
      };
      // Register before running: runSession executes synchronously up to its
      // first await (the initial progress publish), and that publish's
      // getProgress/isCurrent calls must already see this record, not the
      // previous (now-superseded) one.
      sessions.set(provider, record);
      const runPromise = runSession(record);
      const engine: ProgressiveHistorySessionEngine<T> = {
        provider,
        sessionId,
        state,
        start: () => runPromise,
        done: runPromise.then(() => undefined)
      };
      record.engine = engine;
      runPromise.catch(() => undefined);
      void engine.start();
      return engine;
    },
    getProgress(provider) {
      const record = sessions.get(provider);
      return record ? buildProgress(record.state, record.stages) : undefined;
    },
    isCurrent(provider, sessionId) {
      const record = sessions.get(provider);
      return Boolean(record && record.state.sessionId === sessionId);
    }
  };
}

async function safePublish<T>(hooks: ProgressiveEngineHooks<T>, progress: ProviderHistoryProgress): Promise<void> {
  try {
    await hooks.publishProgress(progress);
  } catch {
    // Publishing failures must never abort the history session.
  }
}

async function safeApply<T>(hooks: ProgressiveEngineHooks<T>, stage: ProgressiveStageInfo, read: StageRead<T>): Promise<void> {
  try {
    await hooks.applyStage(stage, read);
  } catch {
    // Apply failures are logged by the controller; a failed stage still counts
    // as finished so later stages can continue off the shared cache.
  }
}

export function stageDays(stage: ProgressiveStageInfo): number {
  return stage.days === null ? PROGRESSIVE_ALL_HORIZON_DAYS : stage.days;
}

const STAGE_SHORT_LABELS: Record<ProgressiveStageKey, string> = {
  '1D': '1D',
  '7D': '7D',
  '30D': '30D',
  '365D': '1Y',
  'ALL': 'ALL'
};

export function stageShortLabel(stage: ProgressiveStageInfo): string {
  return STAGE_SHORT_LABELS[stage.key];
}

export function lastFinishedStage(progress: ProviderHistoryProgress): ProgressiveStageKey | undefined {
  if (progress.finishedStages.length === 0) {
    return undefined;
  }
  return progress.finishedStages[progress.finishedStages.length - 1];
}

/**
 * Human-readable loading note for the dashboard banner and status tooltip.
 * Returns undefined when no provider history is currently loading, so callers
 * can hide the note entirely once all providers have settled.
 */
export function formatHistoryProgressNote(progress: ProviderHistoryProgress[]): string | undefined {
  const loading = (progress ?? []).filter(entry => entry.status === 'running');
  if (loading.length === 0) {
    return undefined;
  }

  const parts = loading.map(entry => {
    const providerLabel = entry.provider === 'claude' ? 'Claude' : 'Codex';
    const finished = lastFinishedStage(entry);
    if (!finished) {
      return `${providerLabel} history: loading…`;
    }
    const finishedLabel = stageLabelFor(finished);
    const remaining = (entry.stages ?? PROGRESSIVE_STAGES)
      .filter(stage => !entry.finishedStages.includes(stage.key))
      .map(stage => stage.label);
    const suffix = remaining.length > 0 ? `, loading ${remaining.join(' → ')}…` : '';
    return `${providerLabel} history: ${finishedLabel} loaded so far${suffix}`;
  });

  return parts.join(' · ');
}

function stageLabelFor(key: ProgressiveStageKey): string {
  const stage = PROGRESSIVE_STAGES.find(candidate => candidate.key === key);
  return stage ? stage.label : key;
}

// Node fs error messages embed absolute paths (e.g. "ENOENT: ... open
// 'C:\Users\<name>\.claude\projects\...'"), and this string reaches the
// webview via ProviderHistoryProgress.error. Report the error code when
// available and strip path-shaped segments otherwise, so a local read failure
// can't leak the OS username or project directory names into the UI.
function sanitizeStageError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) {
      return `history stage failed (${code})`;
    }
    const scrubbed = error.message.replace(/[A-Za-z]:\\[^\s'"]+|\/(?:home|Users)\/[^\s'"]+/g, '<path>');
    return scrubbed.slice(0, 300);
  }
  return 'history stage failed';
}
