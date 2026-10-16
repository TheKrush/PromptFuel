import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findModelPricing, initModelPricingFromCsv } from '../modelPricing';
import {
  estimateAggregateCostUsd,
  estimateClaudeCostUsd,
  estimateCodexCostUsd,
  findConfiguredModelPricing
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

  it('estimates Claude Fable 5 costs including cache read and write rates', () => {
    const fable = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['claude-fable-5']);
    assertApprox(fable.costUsd, 0.253);
    assert.equal(fable.matchedModel, 'claude-fable-5');
    assert.equal(fable.isFallback, false);

    const openRouterAlias = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['anthropic/claude-fable-5']);
    assertApprox(openRouterAlias.costUsd, 0.253);
    assert.equal(openRouterAlias.matchedModel, 'anthropic/claude-fable-5');
    assert.equal(openRouterAlias.isFallback, false);
  });

  it('estimates Claude Fable 5.1 with its 0.025x cache-read rate and distinct model id', () => {
    // 10,000 in x $10 + 2,000 out x $50 + 3,000 cache-read x $0.25 + 4,000 cache-write x $12.50, per 1M.
    const fable51 = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['claude-fable-5-1'], '2026-09-01');
    assertApprox(fable51.costUsd, 0.25075);
    assert.equal(fable51.matchedModel, 'claude-fable-5-1');
    assert.equal(fable51.isFallback, false);

    // Fable 5 keeps the 0.1x cache-read rate ($1) and must not resolve to the 5.1 row.
    const fable5 = findConfiguredModelPricing('claude', 'claude-fable-5', '2026-09-01');
    assert.ok(fable5);
    assert.equal(fable5.matchedModel, 'claude-fable-5');
    assert.equal(fable5.cacheReadPerMillion, 1);

    const before = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['claude-fable-5-1'], '2026-08-31');
    assert.equal(before.matchedModel, undefined);
    assert.equal(before.isFallback, true);
  });

  it('estimates Claude Sonnet 5.5 from its 2026-09-28 effective date without matching Sonnet 5', () => {
    const sonnet55 = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-sonnet-5-5'], '2026-09-28');
    assertApprox(sonnet55.costUsd, 0.07);
    assert.equal(sonnet55.matchedModel, 'claude-sonnet-5-5');
    assert.equal(sonnet55.isFallback, false);

    const before = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-sonnet-5-5'], '2026-09-27');
    assert.equal(before.matchedModel, undefined);
    assert.equal(before.isFallback, true);
  });

  it('applies the Sonnet 5.5 cache-read reduction from 2026-10-07 and preserves the earlier rate', () => {
    // 10,000 in x $2 + 5,000 out x $10 + 100,000 cache-read x cache-read rate + 4,000 cache-write x $2.50, per 1M.
    const before = estimateClaudeCostUsd(10_000, 5_000, 100_000, 4_000, ['claude-sonnet-5-5'], '2026-10-06');
    assertApprox(before.costUsd, 0.1);
    assert.equal(before.matchedModel, 'claude-sonnet-5-5');
    assert.equal(before.isFallback, false);

    const onDate = estimateClaudeCostUsd(10_000, 5_000, 100_000, 4_000, ['claude-sonnet-5-5'], '2026-10-07');
    assertApprox(onDate.costUsd, 0.09);
    assert.equal(onDate.matchedModel, 'claude-sonnet-5-5');
    assert.equal(onDate.isFallback, false);

    const rate = findConfiguredModelPricing('claude', 'claude-sonnet-5-5-20261007', '2026-10-15');
    assert.ok(rate);
    assert.equal(rate.inputPerMillion, 2);
    assert.equal(rate.outputPerMillion, 10);
    assert.equal(rate.cacheWritePerMillion, 2.5);
    assert.equal(rate.cacheReadPerMillion, 0.1);

    // Sonnet 5 keeps its own $0.20 cache-read rate and does not inherit the 5.5 change.
    const sonnet5 = findConfiguredModelPricing('claude', 'claude-sonnet-5', '2026-10-15');
    assert.ok(sonnet5);
    assert.equal(sonnet5.cacheReadPerMillion, 0.2);
  });

  it('estimates Claude Haiku 5.5 at its lower prompt-size band from 2026-10-07', () => {
    // 10,000 in x $0.10 + 2,000 out x $0.50 + 3,000 cache-read x $0.01 + 4,000 cache-write x $0.125, per 1M.
    const haiku = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['claude-haiku-5-5'], '2026-10-07');
    assertApprox(haiku.costUsd, 0.00253);
    assert.equal(haiku.matchedModel, 'claude-haiku-5-5');
    assert.equal(haiku.isFallback, false);

    const rate = findConfiguredModelPricing('claude', 'claude-haiku-5-5', '2026-10-15');
    assert.ok(rate);
    assert.equal(rate.inputPerMillion, 0.1);
    assert.equal(rate.outputPerMillion, 0.5);
    assert.equal(rate.cacheWritePerMillion, 0.125);
    assert.equal(rate.cacheReadPerMillion, 0.01);

    // Dated variants resolve to the same row; Haiku 4.5 keeps its own rates.
    const dated = findConfiguredModelPricing('claude', 'claude-haiku-5-5-20261007', '2026-10-15');
    assert.ok(dated);
    assert.equal(dated.matchedModel, 'claude-haiku-5-5');
    const haiku45 = findConfiguredModelPricing('claude', 'claude-haiku-4-5-20251001', '2026-10-15');
    assert.ok(haiku45);
    assert.equal(haiku45.matchedModel, 'claude-haiku-4-5');
    assert.equal(haiku45.inputPerMillion, 1);

    const before = estimateClaudeCostUsd(10_000, 2_000, 3_000, 4_000, ['claude-haiku-5-5'], '2026-10-06');
    assert.equal(before.matchedModel, undefined);
    assert.equal(before.isFallback, true);
  });

  it('prices Claude Haiku 5.5 with the lower band regardless of token volume (long-prompt limitation)', () => {
    // The estimator only sees aggregated token totals, so it cannot tell whether any single request's
    // prompt exceeded 100K tokens. Official >100K-prompt rates ($0.50 in / $2.50 out) are NOT applied,
    // and the Haiku 5.5 row's notes must say so rather than imply long-prompt accuracy.
    const aggregate = estimateClaudeCostUsd(500_000, 100_000, 0, 0, ['claude-haiku-5-5'], '2026-10-15');
    assertApprox(aggregate.costUsd, 0.1);
    assert.equal(aggregate.isFallback, false);

    const match = findModelPricing('claude', 'claude-haiku-5-5', '2026-10-15');
    assert.ok(match);
    assert.match(match.row.notes, /100K/);
    assert.match(match.row.notes, /underestimated/);
  });

  it('does not let new Claude model ids inherit unrelated rates', () => {
    for (const unknown of ['claude-haiku-5-6', 'claude-haiku-5', 'claude-sonnet-5-6', 'claude-haiku-5-5-fast']) {
      assert.equal(findConfiguredModelPricing('claude', unknown, '2026-10-15'), undefined, unknown);
    }
  });

  it('aggregates mixed Haiku 5.5, Sonnet 5.5, and Sonnet 4.6 usage with as-of-date rates', () => {
    const usage = [
      { model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 },
      { model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 },
      { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 }
    ];

    // Haiku 5.5: 0.10 + 0.50 + 0.125 + 0.01 = 0.735
    // Sonnet 5.5 (cache read $0.10): 2 + 10 + 2.50 + 0.10 = 14.60
    // Sonnet 4.6: 3 + 15 + 3.75 + 0.30 = 22.05
    const after = estimateAggregateCostUsd(usage, true, '2026-10-07');
    assertApprox(after.costUsd, 0.735 + 14.6 + 22.05);
    assert.equal(after.fallbackCount, 0);
    assert.equal(after.totalCount, 3);

    // Day before: Haiku 5.5 is not yet priced (fallback to the default Claude rate) and Sonnet 5.5 cache read is $0.20.
    const beforeCutover = estimateAggregateCostUsd(usage, true, '2026-10-06');
    assert.equal(beforeCutover.fallbackCount, 1);
    assertApprox(beforeCutover.costUsd, (3 + 15 + 3.75 + 0.3) + 14.7 + 22.05);
  });

  it('keeps Claude Sonnet 5 at its permanent $2/$10 rate across the cancelled 2026-09-01 increase', () => {
    for (const asOf of ['2026-08-31', '2026-09-01', '2026-10-01']) {
      const rate = findConfiguredModelPricing('claude', 'claude-sonnet-5', asOf);
      assert.ok(rate);
      assert.equal(rate.inputPerMillion, 2);
      assert.equal(rate.outputPerMillion, 10);
      assert.equal(rate.cacheReadPerMillion, 0.2);
      assert.equal(rate.matchedModel, 'claude-sonnet-5');
    }
  });

  it('keeps future-only scheduled rows unavailable and preserves fallback behavior', () => {
    const configured = findConfiguredModelPricing('claude', 'claude-sonnet-5', '2026-06-29');
    assert.equal(configured, undefined);

    const fallback = estimateClaudeCostUsd(10_000, 5_000, 0, 0, ['claude-sonnet-5'], '2026-06-29');
    assertApprox(fallback.costUsd, 0.105);
    assert.equal(fallback.matchedModel, undefined);
    assert.equal(fallback.isFallback, true);
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

  it('prices OpenAI cached input at the discounted cache-read rate', () => {
    // Disjoint components: 6,000 uncached input + 4,000 cache-read input (10,000 logical input total).
    const estimate = estimateCodexCostUsd(6_000, 0, 4_000, 0, ['gpt-5.4']);
    assertApprox(estimate.costUsd, 0.016);
    assert.equal(estimate.isFallback, false);
  });

  it('uses explicit GPT-5.6 OpenAI cache-write pricing (pre-promotion)', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-sol'], '2026-08-20');
    assertApprox(estimate.costUsd, 0.0915);
    assert.equal(estimate.matchedModel, 'gpt-5.6-sol');
    assert.equal(estimate.isFallback, false);
  });

  it('uses promotional GPT-5.6 Sol pricing on and after 2026-08-21', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-sol'], '2026-08-21');
    assertApprox(estimate.costUsd, 0.0652);
    assert.equal(estimate.matchedModel, 'gpt-5.6-sol');
    assert.equal(estimate.isFallback, false);
  });

  it('selects GPT-5.6 Sol promotional rates via findConfiguredModelPricing', () => {
    const before = findConfiguredModelPricing('codex', 'gpt-5.6-sol', '2026-08-20');
    assert.ok(before);
    assert.equal(before.inputPerMillion, 5);
    assert.equal(before.outputPerMillion, 30);

    const after = findConfiguredModelPricing('codex', 'gpt-5.6-sol', '2026-08-21');
    assert.ok(after);
    assert.equal(after.inputPerMillion, 4);
    assert.equal(after.outputPerMillion, 20);
    assert.equal(after.cacheWritePerMillion, 5);
    assert.equal(after.cacheReadPerMillion, 0.40);
  });

  it('estimates GPT-5.6 Terra at reduced rates effective 2026-07-30', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-terra'], '2026-07-30');
    assertApprox(estimate.costUsd, 0.0366);
    assert.equal(estimate.matchedModel, 'gpt-5.6-terra');
    assert.equal(estimate.isFallback, false);
  });

  it('uses pre-reduction GPT-5.6 Terra pricing before 2026-07-30', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-terra'], '2026-07-29');
    assertApprox(estimate.costUsd, 0.04575);
    assert.equal(estimate.matchedModel, 'gpt-5.6-terra');
    assert.equal(estimate.isFallback, false);
  });

  it('selects GPT-5.6 Terra reduction rates via findConfiguredModelPricing', () => {
    const before = findConfiguredModelPricing('codex', 'gpt-5.6-terra', '2026-07-29');
    assert.ok(before);
    assert.equal(before.inputPerMillion, 2.50);
    assert.equal(before.outputPerMillion, 15);

    const after = findConfiguredModelPricing('codex', 'gpt-5.6-terra', '2026-07-30');
    assert.ok(after);
    assert.equal(after.inputPerMillion, 2);
    assert.equal(after.outputPerMillion, 12);
    assert.equal(after.cacheWritePerMillion, 2.5);
    assert.equal(after.cacheReadPerMillion, 0.20);
  });

  it('estimates GPT-5.6 Luna at reduced rates effective 2026-07-30', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-luna'], '2026-07-30');
    assertApprox(estimate.costUsd, 0.00366);
    assert.equal(estimate.matchedModel, 'gpt-5.6-luna');
    assert.equal(estimate.isFallback, false);
  });

  it('uses pre-reduction GPT-5.6 Luna pricing before 2026-07-30', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-5.6-luna'], '2026-07-29');
    assertApprox(estimate.costUsd, 0.0183);
    assert.equal(estimate.matchedModel, 'gpt-5.6-luna');
    assert.equal(estimate.isFallback, false);
  });

  it('selects GPT-5.6 Luna reduction rates via findConfiguredModelPricing', () => {
    const before = findConfiguredModelPricing('codex', 'gpt-5.6-luna', '2026-07-29');
    assert.ok(before);
    assert.equal(before.inputPerMillion, 1);
    assert.equal(before.outputPerMillion, 6);

    const after = findConfiguredModelPricing('codex', 'gpt-5.6-luna', '2026-07-30');
    assert.ok(after);
    assert.equal(after.inputPerMillion, 0.20);
    assert.equal(after.outputPerMillion, 1.20);
    assert.equal(after.cacheWritePerMillion, 0.25);
    assert.equal(after.cacheReadPerMillion, 0.02);
  });

  it('falls back for GPT-6 Astra before its effective date', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-6-astra'], '2026-09-02');
    assert.equal(estimate.matchedModel, undefined);
    assert.equal(estimate.isFallback, true);
  });

  it('estimates GPT-6 Astra costs on and after its effective date', () => {
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-6-astra'], '2026-09-03');
    assertApprox(estimate.costUsd, 0.163);
    assert.equal(estimate.matchedModel, 'gpt-6-astra');
    assert.equal(estimate.isFallback, false);
  });

  it('selects GPT-6 Astra rates via findConfiguredModelPricing', () => {
    const result = findConfiguredModelPricing('codex', 'gpt-6-astra', '2026-09-03');
    assert.ok(result);
    assert.equal(result.inputPerMillion, 10);
    assert.equal(result.outputPerMillion, 50);
    assert.equal(result.cacheWritePerMillion, 12.5);
    assert.equal(result.cacheReadPerMillion, 1);
  });

  it('prices an all-cache-read turn with zero uncached input tokens', () => {
    const estimate = estimateCodexCostUsd(0, 0, 4_000, 0, ['gpt-5.4']);
    assertApprox(estimate.costUsd, 0.001);
    assert.equal(estimate.isFallback, false);
  });

  it('estimates GPT-6.1 Sol costs on and after its 2026-09-29 effective date', () => {
    // 1,000 in x $2 + 2,000 out x $10 + 3,000 cached x $0.10 + 4,000 cache-write x $2.50, per 1M.
    const estimate = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-6.1-sol'], '2026-09-29');
    assertApprox(estimate.costUsd, 0.0323);
    assert.equal(estimate.matchedModel, 'gpt-6.1-sol');
    assert.equal(estimate.isFallback, false);

    const before = estimateCodexCostUsd(1_000, 2_000, 3_000, 4_000, ['gpt-6.1-sol'], '2026-09-28');
    assert.equal(before.matchedModel, undefined);
    assert.equal(before.isFallback, true);
  });

  it('keeps GPT-6.1 Sol and GPT-6 Sol as distinct rows with different cached-input rates', () => {
    const sol61 = findConfiguredModelPricing('codex', 'gpt-6.1-sol', '2026-09-29');
    assert.ok(sol61);
    assert.equal(sol61.inputPerMillion, 2);
    assert.equal(sol61.outputPerMillion, 10);
    assert.equal(sol61.cacheWritePerMillion, 2.5);
    assert.equal(sol61.cacheReadPerMillion, 0.1);

    const sol6 = findConfiguredModelPricing('codex', 'gpt-6-sol', '2026-09-29');
    assert.ok(sol6);
    assert.equal(sol6.matchedModel, 'gpt-6-sol');
    assert.equal(sol6.cacheReadPerMillion, 0.2);
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
