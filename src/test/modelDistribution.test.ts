import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeModelDistribution, buildCodexModelDistribution } from '../panel/dashboard/modelDistribution';
import type { ClaudeUsageHistory, ClaudeHistoryModelUsage } from '../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory, CodexCorrelatedHistoryModelUsage } from '../providers/codexCorrelatedDayBucketScanner';

function claudeModelUsage(model: string, totalTokens: number): ClaudeHistoryModelUsage {
  return {
    model,
    assistantMessages: 1,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens
  };
}

function codexModelUsage(model: string, totalTokens: number): CodexCorrelatedHistoryModelUsage {
  return {
    model,
    assistantMessages: 1,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens
  };
}

function claudeHistoryWithModels(modelUsage: ClaudeHistoryModelUsage[]): ClaudeUsageHistory {
  return {
    available: true,
    rangeLabel: '1M / 30d',
    totalDays: 1,
    activeDays: 1,
    days: [{
      available: true,
      dateKey: '2026-06-04',
      dateLabel: '2026-06-04',
      assistantMessages: modelUsage.reduce((sum, m) => sum + m.assistantMessages, 0),
      inputTokens: modelUsage.reduce((sum, m) => sum + m.inputTokens, 0),
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: modelUsage.reduce((sum, m) => sum + m.totalTokens, 0),
      models: modelUsage.map(m => m.model),
      modelUsage,
      filesFound: 1,
      filesInspected: 1,
      recordsRead: modelUsage.length,
      recordsMatched: modelUsage.length,
      fileReadErrors: 0
    }],
    assistantMessages: modelUsage.reduce((sum, m) => sum + m.assistantMessages, 0),
    inputTokens: modelUsage.reduce((sum, m) => sum + m.inputTokens, 0),
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: modelUsage.reduce((sum, m) => sum + m.totalTokens, 0),
    modelUsage,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: modelUsage.length,
    recordsMatched: modelUsage.length,
    fileReadErrors: 0
  };
}

function codexHistoryWithModels(modelUsage: CodexCorrelatedHistoryModelUsage[]): CodexCorrelatedHistory {
  return {
    available: true,
    rangeLabel: '1M / 30d',
    totalDays: 1,
    activeDays: 1,
    days: [{
      available: true,
      dateKey: '2026-06-04',
      dateLabel: '2026-06-04',
      assistantMessages: modelUsage.reduce((sum, m) => sum + m.assistantMessages, 0),
      inputTokens: modelUsage.reduce((sum, m) => sum + m.inputTokens, 0),
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: modelUsage.reduce((sum, m) => sum + m.totalTokens, 0),
      models: modelUsage.map(m => m.model),
      modelUsage,
      correlatedTurns: modelUsage.length,
      filesFound: 1,
      filesInspected: 1,
      recordsRead: modelUsage.length,
      recordsMatched: modelUsage.length,
      fileReadErrors: 0,
      skippedMissingTokenData: 0,
      skippedMissingModel: 0,
      skippedMissingBaseline: 0,
      skippedNegativeDelta: 0
    }],
    assistantMessages: modelUsage.reduce((sum, m) => sum + m.assistantMessages, 0),
    inputTokens: modelUsage.reduce((sum, m) => sum + m.inputTokens, 0),
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: modelUsage.reduce((sum, m) => sum + m.totalTokens, 0),
    modelUsage,
    filesFound: 1,
    filesInspected: 1,
    recordsRead: modelUsage.length,
    recordsMatched: modelUsage.length,
    fileReadErrors: 0
  } as CodexCorrelatedHistory;
}

describe('model distribution — no automatic Other consolidation', () => {
  it('Codex tab preserves every model as a separate segment, matching the live-UI regression', () => {
    // Mirrors the observed defect: Codex provider tab collapsed gpt-5.4-mini (25.8M) and
    // gpt-5.6-luna (8.6M) into "Other: 34.4M" while five other models stayed named.
    // Grand total (1,814.6M) matches what the provider tab displayed, confirming this is a
    // grouping/presentation bug, not a data-loss bug.
    const history = codexHistoryWithModels([
      codexModelUsage('gpt-5-codex', 900_000_000),
      codexModelUsage('gpt-5-codex-mini', 500_000_000),
      codexModelUsage('gpt-5.2-codex', 200_000_000),
      codexModelUsage('gpt-5.3-codex', 150_000_000),
      codexModelUsage('gpt-5.1-codex', 30_200_000),
      codexModelUsage('gpt-5.4-mini', 25_800_000),
      codexModelUsage('gpt-5.6-luna', 8_600_000)
    ]);

    const distribution = buildCodexModelDistribution(history, undefined, 'Codex');

    assert.equal(distribution.available, true);
    assert.equal(distribution.totalTokens, 1_814_600_000, 'provider grand total is unchanged by the fix');
    assert.equal(distribution.segments.length, 7, 'every model is its own segment; none are dropped or merged');
    assert.ok(
      distribution.segments.every(segment => segment.model !== 'Other'),
      'no synthetic "Other" model entry is produced'
    );

    const mini = distribution.segments.find(segment => segment.model === 'gpt-5.4-mini');
    const luna = distribution.segments.find(segment => segment.model === 'gpt-5.6-luna');
    assert.ok(mini, 'gpt-5.4-mini must appear as its own segment');
    assert.ok(luna, 'gpt-5.6-luna must appear as its own segment');
    assert.equal(mini!.totalTokens, 25_800_000, 'gpt-5.4-mini keeps its own token count instead of being merged');
    assert.equal(luna!.totalTokens, 8_600_000, 'gpt-5.6-luna keeps its own token count instead of being merged');

    const segmentSum = distribution.segments.reduce((sum, segment) => sum + segment.totalTokens, 0);
    assert.equal(segmentSum, distribution.totalTokens, 'sum of per-model segments reconstructs the provider total');
  });

  it('Claude tab preserves every model as a separate segment when more than five are present', () => {
    const history = claudeHistoryWithModels([
      claudeModelUsage('claude-opus-4-8', 400_000),
      claudeModelUsage('claude-sonnet-5', 300_000),
      claudeModelUsage('claude-haiku-4-5', 120_000),
      claudeModelUsage('claude-sonnet-4-20250514', 90_000),
      claudeModelUsage('claude-opus-4-1', 45_000),
      claudeModelUsage('claude-instant-legacy', 12_000),
      claudeModelUsage('claude-experimental-preview', 3_000)
    ]);

    const distribution = buildClaudeModelDistribution(history, undefined, 'Claude');

    assert.equal(distribution.segments.length, 7, 'every Claude model is its own segment');
    assert.ok(
      distribution.segments.every(segment => segment.model !== 'Other'),
      'no synthetic "Other" model entry is produced for Claude either'
    );
    const segmentSum = distribution.segments.reduce((sum, segment) => sum + segment.totalTokens, 0);
    assert.equal(segmentSum, distribution.totalTokens, 'provider total is preserved across all segments');
  });
});
