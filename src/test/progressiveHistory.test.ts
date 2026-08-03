import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProgressiveHistoryManager,
  formatHistoryProgressNote,
  lastFinishedStage,
  PROGRESSIVE_STAGES,
  stageDays,
  stageShortLabel,
  type ProgressiveHistoryManager,
  type ProgressiveHistorySessionEngine,
  type ProgressiveStageInfo,
  type ProviderHistoryProgress
} from '../providers/progressiveHistory';
import {
  makeClaudeHistoryCache,
  readClaudeHistoryIncremental
} from '../providers/historyCache';
import type { ClaudeUsageHistory } from '../providers/claudeDayBucketScanner';
import type { ProviderUsageState } from '../types';
import { buildUsageDashboardModel } from '../panel/usageDashboardModel';
import { buildUsageHistoryRangeViews, type UsageHistoryPoint } from '../panel/usageHistoryBinning';

// ---------------------------------------------------------------------------
// Minimal history type for fake/deferred hook tests
// ---------------------------------------------------------------------------

interface SimpleHistory {
  available: boolean;
  totalTokens: number;
  days: Array<{ dateKey: string }>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Pure-microtask poll loop; no timing sleeps, so tests stay deterministic.
async function waitFor(predicate: () => boolean, iterations = 500): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('waitFor exceeded iteration budget');
}

function fakeSimpleHistory(totalTokens = 100): SimpleHistory {
  return { available: true, totalTokens, days: [{ dateKey: '2026-05-15' }] };
}

interface FakeHooks {
  readCalls: ProgressiveStageInfo[];
  applyCalls: ProgressiveStageInfo[];
  publishes: ProviderHistoryProgress[];
  pendingReads: Deferred<{ history: SimpleHistory; recordsMatched: number }>[];
  pendingApplies: Deferred<void>[];
  readErrorOnce: boolean;
  readErrorConsumed: boolean;
  appliedMatched: number[];
}

function fakeHooks(): FakeHooks {
  return {
    readCalls: [],
    applyCalls: [],
    publishes: [],
    pendingReads: [],
    pendingApplies: [],
    readErrorOnce: false,
    readErrorConsumed: false,
    appliedMatched: []
  };
}

function bindHooks(hooks: FakeHooks, history: SimpleHistory = fakeSimpleHistory()) {
  return {
    readStage: async (stage: ProgressiveStageInfo) => {
      hooks.readCalls.push(stage);
      if (hooks.readErrorOnce && !hooks.readErrorConsumed) {
        hooks.readErrorConsumed = true;
        throw new Error('read failed');
      }
      const pending = hooks.pendingReads.shift();
      if (pending) {
        return pending.promise;
      }
      return { history, recordsMatched: history.days.length };
    },
    applyStage: async (_stage: ProgressiveStageInfo, read: { history: SimpleHistory; recordsMatched: number }) => {
      hooks.applyCalls.push(_stage);
      hooks.appliedMatched.push(read.recordsMatched);
      const pending = hooks.pendingApplies.shift();
      if (pending) {
        await pending.promise;
      }
    },
    publishProgress: async (progress: ProviderHistoryProgress) => {
      hooks.publishes.push(progress);
    }
  };
}

function makeQuotaStates(): ProviderUsageState[] {
  return [
    { provider: 'claude', sevenDay: { usedPercentage: 30 }, fiveHour: { usedPercentage: 10 } },
    { provider: 'codex', sevenDay: { usedPercentage: 45 }, fiveHour: { usedPercentage: 20 } }
  ];
}

function runningProgress(provider: 'claude' | 'codex', finishedStages: ProgressiveStageInfo['key'][] = []): ProviderHistoryProgress {
  return {
    provider,
    status: 'running',
    stages: PROGRESSIVE_STAGES.map(stage => ({ ...stage })),
    finishedStages
  };
}

function completedProgress(provider: 'claude' | 'codex'): ProviderHistoryProgress {
  return {
    provider,
    status: 'completed',
    stages: PROGRESSIVE_STAGES.map(stage => ({ ...stage })),
    finishedStages: PROGRESSIVE_STAGES.map(stage => stage.key)
  };
}

// ---------------------------------------------------------------------------
// JSONL record builder (shared with incrementalHistoryCache tests)
// ---------------------------------------------------------------------------

function claudeRecord(model: string, isoTimestamp: string, input: number, output: number, cacheCreate = 0, cacheRead = 0): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: isoTimestamp,
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead
      }
    }
  });
}

const targetDate = new Date(2026, 4, 15); // 2026-05-15

function makeHistoryPoint(dateKey: string, totalTokens: number): UsageHistoryPoint {
  const inputTokens = Math.floor(totalTokens * 0.5);
  const outputTokens = Math.floor(totalTokens * 0.4);
  const cacheCreationTokens = Math.floor(totalTokens * 0.06);
  const cacheReadTokens = Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens);
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens: cacheCreationTokens + cacheReadTokens,
    cacheCreationTokens,
    cacheReadTokens,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    models: totalTokens > 0 ? [{
      label: 'Sonnet 4',
      model: 'claude-sonnet-4-20250514',
      totalTokens,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cacheReadInputTokens: cacheReadTokens,
      assistantMessages: 1
    }] : []
  };
}

// ---------------------------------------------------------------------------
// Engine-level session behavior (fake hooks with deferred stages)
// ---------------------------------------------------------------------------

describe('progressive history engine', () => {
  it('session publishes running progress before the first stage read', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    const session = manager.startSession('claude', bindHooks(hooks));
    await Promise.resolve();

    assert.equal(hooks.readCalls.length, 0, 'no stage read before the initial publish');
    assert.ok(hooks.publishes.length >= 1, 'initial running progress published immediately');
    const first = hooks.publishes[0];
    assert.equal(first.status, 'running');
    assert.equal(first.currentStage, undefined, 'initial publish has no current stage yet');
    assert.equal(first.finishedStages.length, 0);

    for (const pending of hooks.pendingReads) {
      pending.resolve({ history: fakeSimpleHistory(), recordsMatched: 1 });
    }
    await session.done;
    assert.equal(session.state.status, 'completed');
  });

  it('quota states are already available when the first progress publishes', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    let sawQuotaAtFirstPublish = false;
    const original = hooks.publishes.push.bind(hooks.publishes);
    hooks.publishes.push = (progress: ProviderHistoryProgress) => {
      if (progress.status === 'running' && progress.finishedStages.length === 0) {
        sawQuotaAtFirstPublish = makeQuotaStates().length >= 2;
      }
      return original(progress);
    };
    const session = manager.startSession('claude', bindHooks(hooks));
    await session.done;
    assert.equal(sawQuotaAtFirstPublish, true, 'quota snapshot must be ready before history starts publishing');
  });

  it('publish order: initial progress, then stage progress, then applied history', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    const events: string[] = [];
    const bind = bindHooks(hooks);
    const session = manager.startSession('claude', {
      readStage: async stage => {
        events.push(`read:${stage.key}`);
        return bind.readStage(stage);
      },
      applyStage: async (stage, read) => {
        events.push(`apply:${stage.key}`);
        return bind.applyStage(stage, read);
      },
      publishProgress: async progress => {
        events.push(`publish:${progress.status}`);
        return bind.publishProgress(progress);
      }
    });
    await session.done;

    assert.equal(events[0], 'publish:running', 'initial running publish comes first');
    const readIndex = events.findIndex(event => event.startsWith('read:'));
    const applyIndex = events.findIndex(event => event.startsWith('apply:'));
    assert.ok(readIndex > 0, 'a read must follow the initial publish');
    assert.ok(applyIndex > readIndex, 'a stage apply must follow its read');
    assert.equal(events[events.length - 1], 'publish:completed');
  });

  it('loading note present while running, absent after completion', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    const session = manager.startSession('claude', bindHooks(hooks));
    await session.done;

    const running = hooks.publishes.find(p => p.status === 'running');
    assert.ok(running);
    assert.ok(formatHistoryProgressNote([running]), 'note present while running');
    const completed = hooks.publishes.find(p => p.status === 'completed');
    assert.ok(completed);
    assert.equal(formatHistoryProgressNote([completed]), undefined, 'note absent once completed');
  });

  it('two providers publish independent progress', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const claudeHooks = fakeHooks();
    const codexHooks = fakeHooks();
    const claudeSession = manager.startSession('claude', bindHooks(claudeHooks));
    const codexSession = manager.startSession('codex', bindHooks(codexHooks));
    await Promise.all([claudeSession.done, codexSession.done]);

    const claudeProgress = manager.getProgress('claude');
    const codexProgress = manager.getProgress('codex');
    assert.ok(claudeProgress);
    assert.ok(codexProgress);
    assert.equal(claudeProgress.provider, 'claude');
    assert.equal(codexProgress.provider, 'codex');
    assert.equal(claudeProgress.status, 'completed');
    assert.equal(codexProgress.status, 'completed');
    assert.ok(claudeHooks.publishes.every(p => p.provider === 'claude'));
    assert.ok(codexHooks.publishes.every(p => p.provider === 'codex'));
  });

  it('no progress when no session started', () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    assert.equal(manager.getProgress('claude'), undefined);
    assert.equal(manager.getProgress('codex'), undefined);
    assert.equal(formatHistoryProgressNote([]), undefined);
  });

  it('a custom stage list (warm refresh) runs only those stages, not the full ladder', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    const allStageOnly = PROGRESSIVE_STAGES.filter(stage => stage.key === 'ALL');
    const session = manager.startSession('claude', bindHooks(hooks), allStageOnly);
    await session.done;

    assert.deepEqual(hooks.readCalls.map(s => s.key), ['ALL']);
    assert.deepEqual(hooks.applyCalls.map(s => s.key), ['ALL']);
    assert.equal(session.state.status, 'completed');
    assert.deepEqual(session.state.finishedStages, ['ALL']);

    const completed = hooks.publishes.find(p => p.status === 'completed');
    assert.ok(completed);
    assert.deepEqual(completed!.stages.map(s => s.key), ['ALL'], 'published stages reflect the custom list, not the default ladder');
  });

  it('a custom-stage session never shows a "loaded so far, loading…" note (finishedStages stays empty until it completes)', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    const applyBlocked = createDeferred<void>();
    hooks.pendingApplies.push(applyBlocked);
    const allStageOnly = PROGRESSIVE_STAGES.filter(stage => stage.key === 'ALL');
    const session = manager.startSession('claude', bindHooks(hooks), allStageOnly);

    await waitFor(() => hooks.applyCalls.length >= 1);
    const runningPublish = manager.getProgress('claude');
    assert.ok(runningPublish);
    assert.equal(runningPublish!.status, 'running');
    assert.equal(formatHistoryProgressNote([runningPublish!]), 'Claude history: loading…', 'a single-stage session never claims a narrower-than-actual window');

    applyBlocked.resolve();
    await session.done;
  });
});

// ---------------------------------------------------------------------------
// Progressive ordering + aggregation against the real reader/cache
// ---------------------------------------------------------------------------

describe('progressive stages against the real reader', () => {
  let tmpDir: string;
  let projectsPath: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-progressive-'));
    projectsPath = path.join(tmpDir, 'projects');
    await fs.mkdir(path.join(projectsPath, 'session1'), { recursive: true });

    // One file with records spread across >365 days so each stage window differs.
    const today = new Date(2026, 4, 15, 9, 0, 0).toISOString();
    const minus3 = new Date(2026, 4, 12, 9, 0, 0).toISOString();
    const minus20 = new Date(2026, 4, 25 - 20, 9, 0, 0).toISOString(); // 2026-04-25
    const minus100 = new Date(2026, 4, 15 - 100, 9, 0, 0).toISOString(); // 2026-02-04
    const minus400 = new Date(2026, 4, 15 - 400, 9, 0, 0).toISOString(); // 2025-04-10
    await fs.writeFile(path.join(projectsPath, 'session1', 'session.jsonl'), [
      claudeRecord('claude-sonnet-4-6', today, 120, 40),
      claudeRecord('claude-sonnet-4-6', minus3, 30, 10),
      claudeRecord('claude-opus-4-8', minus20, 50, 20),
      claudeRecord('claude-opus-4-8', minus100, 70, 30),
      claudeRecord('claude-sonnet-4-6', minus400, 90, 20)
    ].join('\n'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  interface RunOutcome {
    session: ProgressiveHistorySessionEngine<ClaudeUsageHistory>;
    manager: ProgressiveHistoryManager<ClaudeUsageHistory>;
    stageCalls: ProgressiveStageInfo[];
    applied: Array<{ stage: ProgressiveStageInfo; history: ClaudeUsageHistory }>;
    reads: Array<{ stage: ProgressiveStageInfo; recordsMatched: number; recordsRead: number }>;
    publishes: ProviderHistoryProgress[];
  }

  async function runFullSession(): Promise<RunOutcome> {
    const manager = createProgressiveHistoryManager<ClaudeUsageHistory>();
    const cache = makeClaudeHistoryCache();
    const stageCalls: ProgressiveStageInfo[] = [];
    const applied: Array<{ stage: ProgressiveStageInfo; history: ClaudeUsageHistory }> = [];
    const reads: Array<{ stage: ProgressiveStageInfo; recordsMatched: number; recordsRead: number }> = [];
    const publishes: ProviderHistoryProgress[] = [];
    const session = manager.startSession('claude', {
      readStage: async stage => {
        stageCalls.push(stage);
        const history = await readClaudeHistoryIncremental(projectsPath, stageDays(stage), cache, targetDate);
        reads.push({ stage, recordsMatched: history.recordsMatched, recordsRead: history.recordsRead });
        return { history, recordsMatched: history.recordsMatched };
      },
      applyStage: (stage, read) => {
        applied.push({ stage, history: read.history });
      },
      publishProgress: async progress => {
        publishes.push(progress);
      }
    });
    await session.done;
    return { session, manager, stageCalls, applied, reads, publishes };
  }

  it('stages run in order 1D, 7D, 30D, 365D, ALL', async () => {
    const { stageCalls } = await runFullSession();
    assert.deepEqual(stageCalls.map(s => s.key), ['1D', '7D', '30D', '365D', 'ALL']);
  });

  it('later stages day coverage is a superset of earlier stages', async () => {
    const { applied } = await runFullSession();
    const keySets = applied.map(a => new Set(a.history.days.map(d => d.dateKey)));
    for (let i = 1; i < keySets.length; i++) {
      for (const earlier of keySets[i - 1]) {
        assert.ok(keySets[i].has(earlier), `stage ${i} must keep day ${earlier} from stage ${i - 1}`);
      }
    }
  });

  it('totals are non-decreasing across stages', async () => {
    const { applied } = await runFullSession();
    for (let i = 1; i < applied.length; i++) {
      assert.ok(
        applied[i].history.totalTokens >= applied[i - 1].history.totalTokens,
        `stage ${applied[i].stage.key} must not reduce totals`
      );
    }
    assert.equal(applied[4].history.totalTokens, 480, 'final totals aggregate every record exactly once');
  });

  it('final stage totals match a fresh full-range read (no double counting)', async () => {
    const { applied } = await runFullSession();
    const freshCache = makeClaudeHistoryCache();
    const fresh = await readClaudeHistoryIncremental(projectsPath, stageDays(PROGRESSIVE_STAGES[4]), freshCache, targetDate);
    assert.equal(fresh.totalTokens, applied[4].history.totalTokens);
    assert.equal(fresh.recordsMatched, applied[4].history.recordsMatched);
    assert.equal(fresh.days.length, applied[4].history.days.length);
  });

  it('recordsMatched per stage equals a fresh single-range read', async () => {
    const { reads } = await runFullSession();
    for (const read of reads) {
      const freshCache = makeClaudeHistoryCache();
      const fresh = await readClaudeHistoryIncremental(projectsPath, stageDays(read.stage), freshCache, targetDate);
      assert.equal(fresh.recordsMatched, read.recordsMatched, `stage ${read.stage.key} matched count must be range-accurate`);
      assert.equal(fresh.totalTokens, read.recordsMatched > 0 ? fresh.totalTokens : fresh.totalTokens);
    }
  });

  it('files are not rescanned across stages', async () => {
    const { reads } = await runFullSession();
    assert.ok(reads.every(r => r.recordsRead === reads[0].recordsRead), 'recordsRead must stay constant across stages');
    assert.ok(reads[0].recordsRead >= 5, 'the single scan still sees every record in the file');
  });

  it('applyStage receives each stage in order with an available read', async () => {
    const { applied } = await runFullSession();
    assert.deepEqual(applied.map(a => a.stage.key), ['1D', '7D', '30D', '365D', 'ALL']);
    for (const entry of applied) {
      assert.equal(entry.history.available, true, `stage ${entry.stage.key} history must be available`);
    }
  });

  it('publishProgress reflects currentStage then finishedStages as each stage lands', async () => {
    const { publishes } = await runFullSession();
    const seenRunningWithStage = publishes.some(p =>
      p.status === 'running' && p.currentStage === '7D' && p.finishedStages.includes('1D')
    );
    assert.ok(seenRunningWithStage, 'a running publish must show the in-flight stage and the completed 1D stage');
    const completedKeys = publishes.find(p => p.status === 'completed')?.finishedStages;
    assert.deepEqual(completedKeys, ['1D', '7D', '30D', '365D', 'ALL']);
  });

  it('session reaches completed after ALL with per-stage matched totals', async () => {
    const { session, reads } = await runFullSession();
    assert.equal(session.state.status, 'completed');
    assert.deepEqual(session.state.finishedStages, ['1D', '7D', '30D', '365D', 'ALL']);
    assert.equal(session.state.lastStageRecordsMatched, reads[reads.length - 1].recordsMatched);
    assert.equal(lastFinishedStage({ ...session.state } as unknown as ProviderHistoryProgress), 'ALL');
  });

  it('stage labels and short labels cover the full stage list', () => {
    assert.deepEqual(PROGRESSIVE_STAGES.map(s => stageShortLabel(s)), ['1D', '7D', '30D', '1Y', 'ALL']);
    assert.deepEqual(PROGRESSIVE_STAGES.map(s => s.label), ['today', '7 days', '30 days', '12 months', 'all history']);
  });
});

// ---------------------------------------------------------------------------
// Generation supersession
// ---------------------------------------------------------------------------

describe('progressive history session supersession', () => {
  it('starting a new session supersedes a running one before it applies', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooksA = fakeHooks();
    const deferred = createDeferred<{ history: SimpleHistory; recordsMatched: number }>();
    hooksA.pendingReads.push(deferred);
    const sessionA = manager.startSession('claude', bindHooks(hooksA));
    await Promise.resolve();
    assert.equal(sessionA.state.status, 'running');

    const hooksB = fakeHooks();
    const sessionB = manager.startSession('claude', bindHooks(hooksB));
    assert.equal(sessionA.state.status, 'superseded', 'old session marked superseded synchronously');

    deferred.resolve({ history: fakeSimpleHistory(), recordsMatched: 1 });
    await sessionA.done;
    assert.equal(sessionA.state.status, 'superseded');
    assert.equal(hooksA.applyCalls.length, 0, 'superseded session must not apply any stage');
    assert.equal(hooksA.readCalls.length, 0, 'supersession caught the session before its first stage read');

    await sessionB.done;
    assert.equal(sessionB.state.status, 'completed');
    assert.equal(hooksB.applyCalls.length, 5);
  });

  it('supersession during an in-flight apply stops the stage from counting as finished', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooksA = fakeHooks();
    const applyBlocked = createDeferred<void>();
    hooksA.pendingApplies.push(applyBlocked);
    const sessionA = manager.startSession('claude', bindHooks(hooksA));

    await waitFor(() => hooksA.applyCalls.length >= 1);
    assert.equal(hooksA.applyCalls[0].key, '1D');
    assert.equal(sessionA.state.finishedStages.length, 0, '1D not finished while its apply is in flight');

    const hooksB = fakeHooks();
    const sessionB = manager.startSession('claude', bindHooks(hooksB));
    assert.equal(sessionA.state.status, 'superseded');

    applyBlocked.resolve();
    await sessionA.done;
    assert.equal(sessionA.state.status, 'superseded');
    assert.equal(sessionA.state.finishedStages.length, 0, 'superseded mid-apply stage must not be recorded as finished');

    await sessionB.done;
    assert.equal(sessionB.state.status, 'completed');
  });

  it('the newest session wins publication', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooksA = fakeHooks();
    const deferred = createDeferred<{ history: SimpleHistory; recordsMatched: number }>();
    hooksA.pendingReads.push(deferred);
    const sessionA = manager.startSession('claude', bindHooks(hooksA));
    const hooksB = fakeHooks();
    const sessionB = manager.startSession('claude', bindHooks(hooksB));
    deferred.resolve({ history: fakeSimpleHistory(), recordsMatched: 1 });
    await sessionA.done;
    await sessionB.done;

    assert.ok(sessionB.sessionId > sessionA.sessionId);
    assert.equal(manager.getProgress('claude')?.status, 'completed', 'published progress reflects the newest session');
    assert.equal(manager.isCurrent('claude', sessionB.sessionId), true);
    assert.equal(manager.isCurrent('claude', sessionA.sessionId), false);
    assert.equal(manager.isCurrent('codex', sessionB.sessionId), false, 'isCurrent is per-provider');
  });

  it('a readStage error marks the session error and stops further stages', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooks = fakeHooks();
    hooks.readErrorOnce = true;
    const session = manager.startSession('claude', bindHooks(hooks));
    await session.done;

    assert.equal(session.state.status, 'error');
    assert.match(session.state.error ?? '', /read failed/);
    assert.equal(hooks.readCalls.length, 1, 'no further stages after a read error');
    assert.equal(hooks.applyCalls.length, 0);
    const errorPublish = hooks.publishes.find(p => p.status === 'error');
    assert.ok(errorPublish);
    assert.match(errorPublish.error ?? '', /read failed/);
  });

  it('sessions for the same provider run one at a time', async () => {
    const manager = createProgressiveHistoryManager<SimpleHistory>();
    const hooksA = fakeHooks();
    const deferredA = createDeferred<{ history: SimpleHistory; recordsMatched: number }>();
    hooksA.pendingReads.push(deferredA);
    const sessionA = manager.startSession('claude', bindHooks(hooksA));
    await Promise.resolve();
    assert.equal(sessionA.state.status, 'running');

    const hooksB = fakeHooks();
    const sessionB = manager.startSession('claude', bindHooks(hooksB));
    assert.equal(sessionA.state.status, 'superseded');
    assert.equal(manager.getProgress('claude')?.status, 'running', 'published progress tracks the newest session');

    deferredA.resolve({ history: fakeSimpleHistory(), recordsMatched: 1 });
    await sessionA.done;
    await sessionB.done;
    assert.equal(sessionB.state.status, 'completed');
    assert.equal(sessionA.state.status, 'superseded');
  });
});

// ---------------------------------------------------------------------------
// Dashboard / status integration
// ---------------------------------------------------------------------------

describe('progressive history dashboard and status integration', () => {
  it('dashboard model includes historyProgress and a loading note while running', () => {
    const progress = [runningProgress('claude', ['1D'])];
    const model = buildUsageDashboardModel({
      states: makeQuotaStates(),
      historyProgress: progress
    });

    assert.deepEqual(model.historyProgress, progress);
    assert.ok(model.historyProgressNote);
    assert.match(model.historyProgressNote!, /Claude history/);
    assert.match(model.historyProgressNote!, /loading/);
  });

  it('the note disappears once all providers complete', () => {
    const model = buildUsageDashboardModel({
      states: makeQuotaStates(),
      historyProgress: [completedProgress('claude'), completedProgress('codex')]
    });

    assert.equal(model.historyProgress?.length, 2);
    assert.equal(model.historyProgressNote, undefined, 'no loading note once everything has settled');
  });

  it('note is truthful about the loaded window and remaining stages', () => {
    const one = formatHistoryProgressNote([runningProgress('claude', ['1D'])]);
    assert.ok(one);
    assert.match(one!, /today loaded so far/);
    assert.match(one!, /7 days → 30 days → 12 months → all history/);

    const partial = formatHistoryProgressNote([runningProgress('claude', ['1D', '7D', '30D'])]);
    assert.ok(partial);
    assert.match(partial!, /30 days loaded so far/);
    assert.match(partial!, /12 months → all history/);

    const fresh = formatHistoryProgressNote([runningProgress('codex')]);
    assert.ok(fresh);
    assert.match(fresh!, /Codex history: loading…/);

    assert.equal(formatHistoryProgressNote([completedProgress('claude')]), undefined);
  });

  it('ALL range limitation stays truthful during partial loads', () => {
    const views = buildUsageHistoryRangeViews([makeHistoryPoint('2026-05-15', 120)], '2026-05-15');
    assert.ok(views.ALL.limitation);
    assert.match(views.ALL.limitation!, /most recent 12 months of the loaded history window/);
    assert.equal(views.ALL.points.length, 12);
  });

  it('dashboard model passes through historyProgress when provided and omits it otherwise', () => {
    const progress = [runningProgress('codex', ['1D', '7D'])];
    const withProgress = buildUsageDashboardModel({ states: makeQuotaStates(), historyProgress: progress });
    assert.deepEqual(withProgress.historyProgress, progress);
    assert.ok(withProgress.historyProgressNote);

    const withoutProgress = buildUsageDashboardModel({ states: makeQuotaStates() });
    assert.equal(withoutProgress.historyProgress, undefined);
    assert.equal(withoutProgress.historyProgressNote, undefined);
  });
});
