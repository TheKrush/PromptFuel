import { findModelPricing } from '../modelPricing';

export interface ModelPricingEntry {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion?: number;
  cacheReadPerMillion?: number;
  sourceUrl: string;
  sourceLabel: string;
  lastVerifiedDate: string;
}

export interface CostEstimate {
  costUsd: number;
  matchedModel?: string;
  isFallback: boolean;
}

export interface ConfiguredModelPricingRate {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion?: number;
  cacheReadPerMillion?: number;
  currency: string;
  matchedModel: string;
}

export type PricingProvider = 'claude' | 'codex';

export type ConfiguredModelCostEstimate =
  | { available: true; costUsd: number; pricing: ConfiguredModelPricingRate }
  | { available: false; unavailableReason: string; pricing?: ConfiguredModelPricingRate };

export const CLAUDE_SOURCES = {
  url: 'https://platform.claude.com/docs/en/about-claude/pricing',
  label: 'Anthropic Claude API Pricing (official)',
  verified: '2026-06-04'
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
  verified: '2026-06-04'
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
        cacheWritePerMillion: match.row.cacheWrite5mPer1m,
        cacheReadPerMillion: match.row.cacheReadPer1m,
        sourceUrl: sources.url,
        sourceLabel: sources.label,
        lastVerifiedDate: sources.verified
      },
      matchedKey: match.matchedKey
    };
  }

  return { pricing: defaultPricing, matchedKey: undefined };
}

export function findConfiguredModelPricing(
  provider: PricingProvider,
  modelName: string
): ConfiguredModelPricingRate | undefined {
  const match = findModelPricing(provider, modelName);
  if (!match || match.row.inputPer1m === undefined || match.row.outputPer1m === undefined) {
    return undefined;
  }

  return {
    inputPerMillion: match.row.inputPer1m,
    outputPerMillion: match.row.outputPer1m,
    cacheWritePerMillion: match.row.cacheWrite5mPer1m,
    cacheReadPerMillion: match.row.cacheReadPer1m,
    currency: match.row.currency || 'USD',
    matchedModel: match.matchedKey
  };
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
  const cacheReadRate = pricing.cacheReadPerMillion ?? pricing.inputPerMillion * cacheReadMultiplier;
  const cacheWriteRate = pricing.cacheWritePerMillion ?? pricing.inputPerMillion * cacheWriteMultiplier;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * cacheReadRate;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * cacheWriteRate;
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
  const cachedInputRate = pricing.cacheReadPerMillion ?? pricing.inputPerMillion * CODEX_CACHE_READ_MULTIPLIER;
  const inputCost = ((uncachedInputTokens + cacheWriteOnlyTokens) / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = ((cachedInputTokens + cachedOnlyTokens) / 1_000_000) * cachedInputRate;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + cachedInputCost + outputCost;
}

function configuredPricingEntry(provider: PricingProvider, rate: ConfiguredModelPricingRate): ModelPricingEntry {
  const sources = provider === 'claude' ? CLAUDE_SOURCES : CODEX_SOURCES;
  return {
    inputPerMillion: rate.inputPerMillion,
    outputPerMillion: rate.outputPerMillion,
    cacheWritePerMillion: rate.cacheWritePerMillion,
    cacheReadPerMillion: rate.cacheReadPerMillion,
    sourceUrl: sources.url,
    sourceLabel: sources.label,
    lastVerifiedDate: sources.verified
  };
}

function hasUsableTokenComponent(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function estimateConfiguredModelCostUsd(
  provider: PricingProvider,
  modelName: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cacheReadTokens: number | undefined = 0,
  cacheWriteTokens: number | undefined = 0
): ConfiguredModelCostEstimate {
  const pricing = findConfiguredModelPricing(provider, modelName);
  if (!pricing) {
    return { available: false, unavailableReason: 'Pricing unavailable' };
  }

  const input = inputTokens;
  const output = outputTokens;
  const cacheRead = cacheReadTokens;
  const cacheWrite = cacheWriteTokens;

  if (
    !hasUsableTokenComponent(input) ||
    !hasUsableTokenComponent(output) ||
    !hasUsableTokenComponent(cacheRead) ||
    !hasUsableTokenComponent(cacheWrite)
  ) {
    return { available: false, unavailableReason: 'Token components unavailable', pricing };
  }

  const entry = configuredPricingEntry(provider, pricing);
  const costUsd = provider === 'claude'
    ? computeCost(entry, input, output, cacheRead, cacheWrite,
      CLAUDE_CACHE_READ_MULTIPLIER, CLAUDE_CACHE_WRITE_MULTIPLIER)
    : computeOpenAiCost(entry, input, output, cacheRead, cacheWrite);

  return { available: true, costUsd, pricing };
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
