#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  await testEmptyDir();
  await testNoSessionsDir();
  await testSingleTurnSession();
  await testMultiTurnSession();
  await testAbortedTurn();
  await testCrossTurnModelChange();
  await testNoTokenDataTurn();
  await testSkippedTracking();
  await testTurnIdFallbackFromTurnContext();
  await testRecordTimestampFallback();
  await testBaselineTotalDeltas();
  await testReasoningTokensRetained();
  await testNegativeDeltaSkipped();
  await testTodayBucket();
  await testTodayBucketEmptyDir();

  console.log('PASS: codex correlated day-bucket scanner smoke test');
}

async function testEmptyDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-empty-'));
  try {
    const result = await runScanner(tmpDir);
    assert.equal(result.available, false);
    assert.equal(result.filesFound, 0);
    assert.equal(result.filesInspected, 0);
    assert.equal(result.recordsMatched, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testNoSessionsDir() {
  const tmpDir = path.join(os.tmpdir(), `ab-cdx-history-nonexistent-${Date.now()}`);
  try {
    const result = await runScanner(tmpDir);
    assert.equal(result.available, false);
    assert.equal(result.filesFound, 0);
  } finally {
    // no cleanup needed
  }
}

async function testSingleTurnSession() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-single-'));
  try {
    const lines = buildSingleTurnSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.filesInspected, 1);
    assert.equal(result.totalTokens, 5000);
    assert.equal(result.inputTokens, 3000);
    assert.equal(result.outputTokens, 1500);
    assert.equal(result.cacheCreationInputTokens, 500);
    assert.equal(result.assistantMessages, 1);
    assert.equal(result.skippedMissingTokenData, 0, 'skippedMissingTokenData');
    assert.equal(result.skippedMissingModel, 0, 'Turn 2 gets model from latestModel fallback');
    assert.equal(result.skippedMissingBaseline, 0, 'skippedMissingBaseline');
    assert.equal(result.skippedNegativeDelta, 0, 'skippedNegativeDelta');
    assert.equal(result.days.length, 30, 'should fill all 30 calendar days');
    assert.equal(result.days[0].dateKey, '2026-04-13', 'first day of 30-day range');
    assert.equal(result.days[0].correlatedTurns, 0, 'first day should be zero');
    assert.equal(result.activeDays, 1, 'only one active day');
    assert.equal(result.totalDays, 30);
    // The matched day should be May 12
    const may12 = result.days.find(d => d.dateKey === '2026-05-12');
    assert.ok(may12, 'should have May 12 entry');
    assert.equal(may12.correlatedTurns, 1);
    assert.equal(may12.totalTokens, 5000);
    assert.equal(result.modelUsage.length, 1);
    assert.equal(result.modelUsage[0].model, 'gpt-5.5');
    assert.equal(result.modelUsage[0].totalTokens, 5000);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testMultiTurnSession() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-multi-'));
  try {
    const lines = buildMultiTurnSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 3);
    assert.equal(result.assistantMessages, 3);
    assert.equal(result.filesInspected, 1);
    assert.equal(result.skippedMissingTokenData, 0);
    assert.equal(result.skippedMissingModel, 0);

    // Check per-day aggregation
    assert.equal(result.days.length, 30, 'multiTurn: days');
    assert.equal(result.activeDays, 1, 'multiTurn: activeDays');
    const totalMatch = result.days.reduce((s, d) => s + d.correlatedTurns, 0);
    assert.equal(totalMatch, 3);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testAbortedTurn() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-abort-'));
  try {
    const lines = buildAbortedTurnSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.assistantMessages, 1);
    assert.equal(result.skippedMissingTokenData, 0);
    assert.equal(result.days.length, 30, 'should fill 30 calendar days');
    const abortedDay = result.days.find(d => d.correlatedTurns > 0);
    assert.ok(abortedDay, 'should have an active day');
    assert.equal(abortedDay.correlatedTurns, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testCrossTurnModelChange() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-models-'));
  try {
    const lines = buildModelChangeSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true);
    assert.equal(result.recordsMatched, 2);
    assert.equal(result.modelUsage.length, 2);

    const modelNames = result.modelUsage.map(m => m.model).sort();
    assert.deepEqual(modelNames, ['codex-auto-review', 'gpt-5.5']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testNoTokenDataTurn() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-notoken-'));
  try {
    const lines = buildNoTokenDataSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, false);
    assert.equal(result.recordsMatched, 0);
    assert.equal(result.skippedMissingTokenData, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testSkippedTracking() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-skipped-'));
  try {
    const lines = buildSkippedTrackingSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.skippedMissingTokenData, 1);
    assert.equal(result.skippedMissingModel, 0, 'Turn 2 gets model from latestModel fallback');
    assert.equal(result.skippedMissingBaseline, 0);
    assert.equal(result.skippedNegativeDelta, 0);

    // Turn 2 matches via latestModel fallback, Turn 3 matches normally
    assert.equal(result.recordsMatched, 2);
    // Zero-day fill: should have 30 days, correct active days
    assert.equal(result.days.length, 30, 'should fill 30 calendar days');
    assert.equal(result.activeDays, 1, 'all matched turns on same date');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testTurnIdFallbackFromTurnContext() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-tidfall-'));
  try {
    // task_started and task_complete lack turn_id — scanner must infer from latest turn_context
    const lines = buildTurnIdFallbackSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true, 'should correlate without turn_id on task_started');
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.filesInspected, 1);
    assert.equal(result.skippedTaskStartedWithoutTurnId, 0, 'should not count as skipped when fallback works');
    assert.equal(result.skippedCompletionTimestampMissing, 0);
    assert.equal(result.modelUsage.length, 1);
    assert.equal(result.modelUsage[0].model, 'gpt-5.5');
    assert.equal(result.totalTokens, 1000);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testRecordTimestampFallback() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-tsfall-'));
  try {
    // task_complete with no completed_at on payload — scanner must use record.timestamp
    const lines = buildRecordTimestampFallbackSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true, 'should correlate using record.timestamp fallback');
    assert.equal(result.recordsMatched, 1);
    assert.equal(result.skippedCompletionTimestampMissing, 0, 'should not be skipped — record.timestamp resolves');
    assert.equal(result.days.length, 30, 'recordTimestamp: days');
    const activeDay = result.days.find(d => d.correlatedTurns > 0);
    assert.ok(activeDay, 'recordTimestamp: should have active day');
    assert.equal(activeDay.dateKey, '2026-05-12', 'recordTimestamp: dateKey');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testBaselineTotalDeltas() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-baseline-'));
  try {
    // lastSeenTotal from token_count BEFORE task_started should serve as baseline
    // The first token_count inside the turn is NOT the baseline — baseline is from before the turn
    const lines = buildBaselineTotalSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true, 'baseline: available');
    assert.equal(result.recordsMatched, 1, 'baseline: recordsMatched');
    assert.equal(result.totalTokens, 5000, 'baseline: total delta should use pre-turn baseline (1000) not first-in-turn (5000)');
    // lastSeenTotal before task_started: {input:500, output:250, total:1000}
    // lastTotal at close: {input:4000, output:2000, total:6000}
    // delta: 4000-500=3500 input, 2000-250=1750 output, 6000-1000=5000 total
    assert.equal(result.inputTokens, 3500, 'baseline: inputTokens');
    assert.equal(result.outputTokens, 1750, 'baseline: outputTokens');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testReasoningTokensRetained() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-reasoning-'));
  try {
    const lines = buildReasoningTokenSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, true, 'reasoning: available');
    assert.equal(result.recordsMatched, 2, 'reasoning: recordsMatched');

    // Per-bucket reasoning tokens on the active day
    const activeDay = result.days.find(d => d.correlatedTurns > 0);
    assert.ok(activeDay, 'reasoning: active day found');
    assert.equal(activeDay.reasoningOutputTokens, 600, 'reasoning: day reasoning tokens (200 + 400)');
    assert.equal(activeDay.inputTokens, 3000, 'reasoning: day input tokens (1500 + 1500)');
    assert.equal(activeDay.outputTokens, 4000, 'reasoning: day output tokens (1500 + 2500)');

    // Aggregate history reasoning tokens
    assert.equal(result.reasoningOutputTokens, 600, 'reasoning: history reasoning tokens');

    // Per-model reasoning tokens
    assert.equal(result.modelUsage.length, 1, 'reasoning: one model');
    assert.equal(result.modelUsage[0].model, 'o3');
    assert.equal(result.modelUsage[0].reasoningOutputTokens, 600, 'reasoning: model-level reasoning tokens');
    assert.equal(result.modelUsage[0].totalTokens, 8300, 'reasoning: model-level total tokens (3500 + 4800)');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function testNegativeDeltaSkipped() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-history-negdelta-'));
  try {
    // Turn with total_token_usage that decreases (simulates a reset)
    const lines = buildNegativeDeltaSession();
    await fs.writeFile(path.join(tmpDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8');
    const result = await runScanner(tmpDir);

    assert.equal(result.available, false, 'negDelta: available');
    assert.equal(result.recordsMatched, 0, 'negDelta: recordsMatched');
    assert.equal(result.skippedNegativeDelta, 1, 'negDelta: skippedNegativeDelta');
    assert.equal(result.totalTokens, 0, 'negDelta: totalTokens');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runTodayBucket(sessionsPath) {
  const repoRoot = path.resolve(__dirname, '..');
  const scanner = require(path.join(repoRoot, 'out', 'providers', 'codexCorrelatedDayBucketScanner.js'));
  const result = await scanner.readCodexCorrelatedTodayBucket(sessionsPath, new Date('2026-05-12T12:00:00Z'));
  return result;
}

async function testTodayBucket() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-today-'));
  try {
    await fs.writeFile(path.join(tmpDir, 'today.jsonl'), buildSingleTurnSession().join('\n'));

    const bucket = await runTodayBucket(tmpDir);

    assert.equal(bucket.available, true, 'today bucket available with session data');
    assert.equal(bucket.dateKey, '2026-05-12', 'today bucket date key is correct');
    assert.equal(bucket.totalTokens, 5000, 'today bucket delta total (6700-1700=5000)');
    assert.equal(bucket.inputTokens, 3000, 'today bucket delta input (4000-1000=3000)');
    assert.equal(bucket.outputTokens, 1500, 'today bucket delta output (2000-500=1500)');
    assert.equal(bucket.cacheCreationInputTokens, 500, 'today bucket delta cached (700-200=500)');
    assert.equal(bucket.correlatedTurns, 1, 'today bucket 1 correlated turn');
    assert.deepEqual(bucket.models, ['gpt-5.5'], 'today bucket model detected');

    console.log('PASS: readCodexCorrelatedTodayBucket with single-turn session');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testTodayBucketEmptyDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-cdx-today-empty-'));
  try {
    const bucket = await runTodayBucket(tmpDir);

    assert.equal(bucket.available, false, 'today bucket unavailable with empty dir');
    assert.equal(bucket.dateKey, '2026-05-12', 'today bucket keeps target date key when empty');
    assert.equal(bucket.filesFound, 0, 'filesFound is 0 for empty dir');

    console.log('PASS: readCodexCorrelatedTodayBucket with empty dir');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function runScanner(sessionsPath) {
  const repoRoot = path.resolve(__dirname, '..');
  const scanner = require(path.join(repoRoot, 'out', 'providers', 'codexCorrelatedDayBucketScanner.js'));
  const result = await scanner.readCodexCorrelatedHistory(sessionsPath, 30, new Date('2026-05-12T12:00:00Z'));
  return result;
}

function buildSingleTurnSession() {
  // May 12, 2026 10:00:00 UTC in epoch seconds ≈ 1778544000 + 36000 = 1778580000
  const COMPLETED_SEC = 1778580000;
  const turnId = '019e2000-0000-7000-8000-000000000001';
  return [
    JSON.stringify({ timestamp: '2026-05-12T10:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5', collaboration_mode: { mode: 'default', settings: { model: 'gpt-5.5' } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId, started_at: COMPLETED_SEC - 3 } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, total_tokens: 1700 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4000, output_tokens: 2000, cached_input_tokens: 700, total_tokens: 6700 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId, completed_at: COMPLETED_SEC } })
  ];
}

function buildMultiTurnSession() {
  const BASE = 1778580000;
  const turnId1 = '019e2000-0000-7000-8000-000000000001';
  const turnId2 = '019e2000-0000-7000-8000-000000000002';
  const turnId3 = '019e2000-0000-7000-8000-000000000003';
  return [
    // Turn 1
    JSON.stringify({ timestamp: '2026-05-12T08:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId1, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId1 } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId1, completed_at: BASE - 7200 } }),
    // Turn 2
    JSON.stringify({ timestamp: '2026-05-12T09:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId2, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId2 } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2000, output_tokens: 1000, total_tokens: 3000 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId2, completed_at: BASE - 3600 } }),
    // Turn 3
    JSON.stringify({ timestamp: '2026-05-12T10:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId3, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId3 } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 3000, output_tokens: 1500, total_tokens: 4500 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId3, completed_at: BASE } })
  ];
}

function buildAbortedTurnSession() {
  const BASE = 1778580000;
  const turnId = '019e2000-0000-7000-8000-000000000005';
  return [
    JSON.stringify({ timestamp: '2026-05-12T11:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T11:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } }),
    JSON.stringify({ timestamp: '2026-05-12T11:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, output_tokens: 250, total_tokens: 750 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T11:00:03.000Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: turnId, completed_at: BASE + 3600 } })
  ];
}

function buildModelChangeSession() {
  const BASE = 1778580000;
  const turnId1 = '019e2000-0000-7000-8000-000000000010';
  const turnId2 = '019e2000-0000-7000-8000-000000000011';
  return [
    // Turn 1 with gpt-5.5
    JSON.stringify({ timestamp: '2026-05-12T06:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId1, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T06:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId1 } }),
    JSON.stringify({ timestamp: '2026-05-12T06:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T06:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId1, completed_at: BASE - 14400 } }),
    // Turn 2 with different model
    JSON.stringify({ timestamp: '2026-05-12T07:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId2, model: 'codex-auto-review' } }),
    JSON.stringify({ timestamp: '2026-05-12T07:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId2 } }),
    JSON.stringify({ timestamp: '2026-05-12T07:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T07:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId2, completed_at: BASE - 10800 } })
  ];
}

function buildNoTokenDataSession() {
  const BASE = 1778580000;
  const turnId = '019e2000-0000-7000-8000-000000000020';
  return [
    JSON.stringify({ timestamp: '2026-05-12T12:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T12:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } }),
    // No token_count records between start and complete = skipped as missing token data
    JSON.stringify({ timestamp: '2026-05-12T12:00:02.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId, completed_at: BASE + 7200 } })
  ];
}

function buildSkippedTrackingSession() {
  const BASE = 1778580000;
  const turnId1 = '019e2000-0000-7000-8000-000000000030';
  const turnId2 = '019e2000-0000-7000-8000-000000000031';
  const turnId3 = '019e2000-0000-7000-8000-000000000032';
  return [
    // Turn 1: has model, no token data (skippedMissingTokenData)
    JSON.stringify({ timestamp: '2026-05-12T13:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId1, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T13:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId1 } }),
    JSON.stringify({ timestamp: '2026-05-12T13:00:02.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId1, completed_at: BASE + 10800 } }),
    // Turn 2: no model on turn_context, but latestModel from Turn 1 fills in — NOT skipped
    // Total_token_usage is cumulative across turns (150 at Turn 2 close)
    JSON.stringify({ timestamp: '2026-05-12T14:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId2 } }),
    JSON.stringify({ timestamp: '2026-05-12T14:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId2 } }),
    JSON.stringify({ timestamp: '2026-05-12T14:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T14:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId2, completed_at: BASE + 14400 } }),
    // Turn 3: has everything, should match. Totals are cumulative from Turn 2 (start at 150+)
    JSON.stringify({ timestamp: '2026-05-12T15:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId3, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T15:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId3 } }),
    JSON.stringify({ timestamp: '2026-05-12T15:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 180, output_tokens: 90, total_tokens: 250 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T15:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId3, completed_at: BASE + 18000 } })
  ];
}

function buildTurnIdFallbackSession() {
  const BASE = 1778580000;
  const turnId = '019e2000-0000-7000-8000-000000000050';
  // task_started and task_complete have NO turn_id — scanner must infer from latest turn_context
  return [
    JSON.stringify({ timestamp: '2026-05-12T08:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', started_at: BASE - 3 } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, output_tokens: 250, total_tokens: 750 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 600, total_tokens: 1750 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', completed_at: BASE } })
  ];
}

function buildRecordTimestampFallbackSession() {
  const turnId = '019e2000-0000-7000-8000-000000000060';
  // task_complete has NO completed_at in payload, no turn_id — must use top-level record.timestamp
  // Need two token_count records so delta > 0 (single record yields firstTotal=lastTotal)
  return [
    JSON.stringify({ timestamp: '2026-05-12T10:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, output_tokens: 150, total_tokens: 450 } } } }),
    // No completed_at — relies on record.timestamp "2026-05-12T10:00:04.000Z"
    JSON.stringify({ timestamp: '2026-05-12T10:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete' } })
  ];
}

function buildBaselineTotalSession() {
  const turnId = '019e2000-0000-7000-8000-000000000070';
  // token_count BEFORE task_started establishes lastSeenTotal=1000
  // First token_count in turn starts at 5000 (already includes pre-turn consumption)
  // The delta should be from baselineTotal=1000 to lastTotal=6000 = 5000, not from firstTotal=5000-5000=0
  const BASE_SEC = 1778580000;
  return [
    JSON.stringify({ timestamp: '2026-05-12T09:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    // token_count before turn starts — establishes lastSeenTotal
    JSON.stringify({ timestamp: '2026-05-12T09:00:01.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, output_tokens: 250, total_tokens: 1000 } } } }),
    // turn starts
    JSON.stringify({ timestamp: '2026-05-12T09:00:02.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId, started_at: BASE_SEC - 5 } }),
    // first token_count in turn — total has grown
    JSON.stringify({ timestamp: '2026-05-12T09:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2500, output_tokens: 1250, total_tokens: 5000 } } } }),
    // last token_count in turn
    JSON.stringify({ timestamp: '2026-05-12T09:00:04.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4000, output_tokens: 2000, total_tokens: 6000 } } } }),
    // turn completes
    JSON.stringify({ timestamp: '2026-05-12T09:00:05.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId, completed_at: BASE_SEC } })
  ];
}

function buildReasoningTokenSession() {
  const BASE = 1778580000;
  const turnId1 = '019e2000-0000-7000-8000-000000000081';
  const turnId2 = '019e2000-0000-7000-8000-000000000082';
  return [
    // Turn 1 with reasoning tokens: input_tokens=1000, output_tokens=1500, reasoning=200, cached=300
    JSON.stringify({ timestamp: '2026-05-12T08:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId1, model: 'o3' } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId1, started_at: BASE - 7200 - 5 } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 1500, cached_input_tokens: 300, reasoning_output_tokens: 200, total_tokens: 3000 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2500, output_tokens: 3000, cached_input_tokens: 600, reasoning_output_tokens: 400, total_tokens: 6500 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T08:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId1, completed_at: BASE - 7200 } }),
    // Turn 2: cumulative totals continue; delta = last - first within turn (same baseline from lastSeenTotal)
    // lastSeenTotal after turn 1: 2500/3000/600/400/6500
    // Turn 2 starts with those as lastSeenTotal (baselineTotal)
    JSON.stringify({ timestamp: '2026-05-12T09:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId2, model: 'o3' } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId2, started_at: BASE - 3600 - 5 } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 3000, output_tokens: 4000, cached_input_tokens: 800, reasoning_output_tokens: 500, total_tokens: 8300 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4000, output_tokens: 5500, cached_input_tokens: 1000, reasoning_output_tokens: 800, total_tokens: 11300 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T09:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId2, completed_at: BASE - 3600 } })
  ];
}

function buildNegativeDeltaSession() {
  const BASE = 1778580000;
  const turnId = '019e2000-0000-7000-8000-000000000080';
  // total_token_usage decreases from 1000 to 500 — must be detected as negative delta
  return [
    JSON.stringify({ timestamp: '2026-05-12T10:00:00.000Z', type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-5.5' } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId, started_at: BASE - 3 } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 800, output_tokens: 400, total_tokens: 1000 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, output_tokens: 200, total_tokens: 500 } } } }),
    JSON.stringify({ timestamp: '2026-05-12T10:00:04.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId, completed_at: BASE } })
  ];
}

main().catch(err => {
  console.error('Smoke test FAILED:', err.message);
  process.exitCode = 1;
});
