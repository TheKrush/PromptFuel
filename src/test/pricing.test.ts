import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initModelPricingFromCsv } from '../modelPricing';
import {
  estimateAggregateCostUsd,
  estimateClaudeCostUsd,
  estimateCodexCostUsd
} from '../providers/pricing';

before(() => {
  const csvPath = path.join(__dirname, '..', '..', 'data', 'model-pricing-estimates.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  initModelPricingFromCsv(csvContent);
});

function assertApprox(actual: number, expected: number, tolerance = 0.000001): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

describe('pricing estimates', () => {
  it('estimates known Claude model costs with cache multipliers', () => {
    const sonnet = estimateClaudeCostUsd(30_000, 20_000, 500, 1_000, ['claude-sonnet-4-20250514']);
    assertApprox(sonnet.costUsd, 0.3939);
    assert.equal(sonnet.matchedModel, 'claude-sonnet-4');
    assert.equal(sonnet.isFallback, false);

    const opus = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-opus-4-20251001']);
    assertApprox(opus.costUsd, 0.525);
    assert.equal(opus.matchedModel, 'claude-opus-4');
    assert.equal(opus.isFallback, false);

    const opus48Fast = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-opus-4-8-fast']);
    assertApprox(opus48Fast.costUsd, 0.35);
    assert.equal(opus48Fast.matchedModel, 'claude-opus-4-8-fast');
    assert.equal(opus48Fast.isFallback, false);
  });

  it('falls back for unknown or missing Claude models', () => {
    const unknown = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-unknown-model']);
    assertApprox(unknown.costUsd, 0.105);
    assert.equal(unknown.matchedModel, undefined);
    assert.equal(unknown.isFallback, true);

    const empty = estimateClaudeCostUsd(10_000, 5_000);
    assert.equal(empty.costUsd, unknown.costUsd);
    assert.equal(empty.isFallback, true);
  });

  it('estimates known Codex model costs with cache multipliers', () => {
    const gpt54 = estimateCodexCostUsd(3_000, 5_000, 0, 500, ['gpt-5.4-2026-05-13']);
    assertApprox(gpt54.costUsd, 0.0825);
    assert.equal(gpt54.matchedModel, 'gpt-5.4');
    assert.equal(gpt54.isFallback, false);

    const codingModel = estimateCodexCostUsd(2_000, 3_000, 0, 300, ['gpt-5.3-codex-20260513']);
    assertApprox(codingModel.costUsd, 0.0455);
    assert.equal(codingModel.matchedModel, 'gpt-5.3-codex');
    assert.equal(codingModel.isFallback, false);

    const nano = estimateCodexCostUsd(5_000, 10_000, 0, 0, ['gpt-5.4-nano']);
    assertApprox(nano.costUsd, 0.0135);
    assert.equal(nano.matchedModel, 'gpt-5.4-nano');
    assert.equal(nano.isFallback, false);
  });

  it('prices OpenAI cached input as a discounted part of input tokens', () => {
    const estimate = estimateCodexCostUsd(10_000, 0, 4_000, 0, ['gpt-5.4']);
    assertApprox(estimate.costUsd, 0.016);
    assert.equal(estimate.isFallback, false);
  });

  it('does not double-count Codex cache-write tokens when input is present', () => {
    const withCacheWrite = estimateCodexCostUsd(1_000, 0, 0, 1_000, ['gpt-5.3-codex']);
    const withoutCacheWrite = estimateCodexCostUsd(1_000, 0, 0, 0, ['gpt-5.3-codex']);
    assertApprox(withCacheWrite.costUsd, withoutCacheWrite.costUsd);
    assertApprox(withCacheWrite.costUsd, 0.00175);

    const writeOnlySnapshot = estimateCodexCostUsd(0, 0, 0, 1_000, ['gpt-5.3-codex']);
    assertApprox(writeOnlySnapshot.costUsd, 0.00175);
  });

  it('maps codex-auto-review to Codex pricing without fallback', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 0, 0, ['codex-auto-review']);
    assertApprox(estimate.costUsd, 0.02975);
    assert.equal(estimate.matchedModel, 'codex-auto-review');
    assert.equal(estimate.isFallback, false);
  });

  it('keeps screenshot-like Codex cache writes out of duplicate input charges', () => {
    const estimate = estimateCodexCostUsd(62_100_000, 237_400, 0, 57_800_000, ['gpt-5.3-codex']);
    assertApprox(estimate.costUsd, 111.9986);
    assert.equal(estimate.isFallback, false);
  });

  it('falls back for synthetic Codex models', () => {
    const synthetic = estimateCodexCostUsd(1_000, 2_000, 0, 0, ['<synthetic>:o3-20260513']);
    assertApprox(synthetic.costUsd, 0.0325);
    assert.equal(synthetic.matchedModel, undefined);
    assert.equal(synthetic.isFallback, true);
  });

  it('aggregates per-model Claude usage', () => {
    const estimate = estimateAggregateCostUsd([
      {
        model: 'claude-sonnet-4-20250514',
        inputTokens: 20_000,
        outputTokens: 15_000,
        cacheCreationInputTokens: 500,
        cacheReadInputTokens: 200
      },
      {
        model: 'claude-opus-4-20251001',
        inputTokens: 5_000,
        outputTokens: 3_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      }
    ], true);

    assertApprox(estimate.costUsd, 0.586935);
    assert.equal(estimate.fallbackCount, 0);
    assert.equal(estimate.totalCount, 2);
  });

  it('aggregates per-model Codex usage and reports fallbacks', () => {
    const estimate = estimateAggregateCostUsd([
      {
        model: 'gpt-5.4-2026-05-13',
        inputTokens: 1_000,
        outputTokens: 2_000,
        cacheCreationInputTokens: 200,
        cacheReadInputTokens: 0
      },
      {
        model: '<synthetic>:o3-20260513',
        inputTokens: 2_000,
        outputTokens: 3_000,
        cacheCreationInputTokens: 300,
        cacheReadInputTokens: 0
      }
    ], false);

    assertApprox(estimate.costUsd, 0.0825);
    assert.equal(estimate.fallbackCount, 1);
    assert.equal(estimate.totalCount, 2);
  });

  it('returns zero cost for zero-token estimates', () => {
    const claude = estimateClaudeCostUsd(0, 0, 0, 0, ['claude-sonnet-4-20250514']);
    assert.equal(claude.costUsd, 0);
    assert.equal(claude.isFallback, false);

    const codex = estimateCodexCostUsd(0, 0, 0, 0, []);
    assert.equal(codex.costUsd, 0);
    assert.equal(codex.isFallback, true);
  });
});
