import { findModelPricing } from '../modelPricing';

export interface ModelPricingEntry {
  inputPerMillion: number;
  outputPerMillion: number;
  sourceUrl: string;
  sourceLabel: string;
  lastVerifiedDate: string;
}

export interface CostEstimate {
  costUsd: number;
  matchedModel?: string;
  isFallback: boolean;
}

export const CLAUDE_SOURCES = {
  url: 'https://platform.claude.com/docs/en/about-claude/pricing',
  label: 'Anthropic Claude API Pricing (official)',
  verified: '2026-05-16'
} as const;

// Fallback rate used when model name does not match any known Claude entry
export const DEFAULT_CLAUDE_PRICING: ModelPricingEntry = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: `${CLAUDE_SOURCES.label} (Sonnet 4.6 rate, fallback for unrecognized Claude models)`,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

export const CODEX_SOURCES = {
  url: 'https://developers.openai.com/api/docs/pricing',
  label: 'OpenAI API Pricing (official)',
  verified: '2026-05-16'
} as const;

// Fallback rate used when model name does not match any known Codex entry
export const DEFAULT_CODEX_PRICING: ModelPricingEntry = {
  inputPerMillion: 2.50,
  outputPerMillion: 15,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: `${CODEX_SOURCES.label} (gpt-5.4 rate, fallback for unrecognized Codex models)`,
  lastVerifiedDate: CODEX_SOURCES.verified
};

const CLAUDE_CACHE_READ_MULTIPLIER = 0.1;
const CLAUDE_CACHE_WRITE_MULTIPLIER = 1.25;
const CODEX_CACHE_READ_MULTIPLIER = 0.1;

function matchModelPricing(
  modelName: string,
  provider: 'claude' | 'codex'
): { pricing: ModelPricingEntry; matchedKey: string | undefined } {
  const sources = provider === 'claude' ? CLAUDE_SOURCES : CODEX_SOURCES;
  const defaultPricing = provider === 'claude' ? DEFAULT_CLAUDE_PRICING : DEFAULT_CODEX_PRICING;

  const match = findModelPricing(provider, modelName);
  if (match && match.row.inputPer1m !== undefined && match.row.outputPer1m !== undefined) {
    return {
      pricing: {
        inputPerMillion: match.row.inputPer1m,
        outputPerMillion: match.row.outputPer1m,
        sourceUrl: sources.url,
        sourceLabel: sources.label,
        lastVerifiedDate: sources.verified
      },
      matchedKey: match.matchedKey
    };
  }

  return { pricing: defaultPricing, matchedKey: undefined };
}

function computeCost(
  pricing: ModelPricingEntry,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  cacheReadMultiplier: number,
  cacheWriteMultiplier: number
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.inputPerMillion * cacheReadMultiplier;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.inputPerMillion * cacheWriteMultiplier;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function computeOpenAiCost(
  pricing: ModelPricingEntry,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number {
  const cachedInputTokens = Math.min(inputTokens, cacheReadTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const cachedOnlyTokens = Math.max(0, cacheReadTokens - inputTokens);
  // Codex cache-creation counters come from cached_input_tokens deltas. In OpenAI-style
  // pricing they are prompt input already represented by inputTokens, not an extra
  // Anthropic-style cache-write surcharge. If a snapshot has only cache write data,
  // treat it as ordinary input so the API-equivalent estimate remains conservative.
  const cacheWriteOnlyTokens = inputTokens > 0 ? 0 : cacheWriteTokens;
  const inputCost = ((uncachedInputTokens + cacheWriteOnlyTokens) / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = ((cachedInputTokens + cachedOnlyTokens) / 1_000_000) * pricing.inputPerMillion * CODEX_CACHE_READ_MULTIPLIER;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + cachedInputCost + outputCost;
}

export function estimateClaudeCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
  models: string[] = []
): CostEstimate {
  const result = models.length > 0
    ? matchModelPricing(models[0], 'claude')
    : { pricing: DEFAULT_CLAUDE_PRICING, matchedKey: undefined };

  const costUsd = computeCost(result.pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    CLAUDE_CACHE_READ_MULTIPLIER, CLAUDE_CACHE_WRITE_MULTIPLIER);

  return {
    costUsd,
    matchedModel: result.matchedKey,
    isFallback: !result.matchedKey
  };
}

export function estimateCodexCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
  models: string[] = []
): CostEstimate {
  const result = models.length > 0
    ? matchModelPricing(models[0], 'codex')
    : { pricing: DEFAULT_CODEX_PRICING, matchedKey: undefined };

  const costUsd = computeOpenAiCost(result.pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);

  return {
    costUsd,
    matchedModel: result.matchedKey,
    isFallback: !result.matchedKey
  };
}

export function estimateAggregateCostUsd(
  modelUsage: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  }>,
  isClaude: boolean
): { costUsd: number; fallbackCount: number; totalCount: number } {
  let total = 0;
  let fallbackCount = 0;

  for (const usage of modelUsage) {
    const result = matchModelPricing(usage.model, isClaude ? 'claude' : 'codex');

    if (!result.matchedKey) {
      fallbackCount++;
    }

    total += isClaude
      ? computeCost(
        result.pricing,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens,
        CLAUDE_CACHE_READ_MULTIPLIER,
        CLAUDE_CACHE_WRITE_MULTIPLIER
      )
      : computeOpenAiCost(
        result.pricing,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens
      );
  }

  return { costUsd: total, fallbackCount, totalCount: modelUsage.length };
}
