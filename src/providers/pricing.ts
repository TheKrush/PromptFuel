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

// $5 / $25 tier: Opus 4.7, 4.6, 4.5
export const CLAUDE_OPUS_CURRENT: ModelPricingEntry = {
  inputPerMillion: 5,
  outputPerMillion: 25,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// $15 / $75 tier: Opus 4.1, Opus 4 (deprecated)
export const CLAUDE_OPUS_LEGACY: ModelPricingEntry = {
  inputPerMillion: 15,
  outputPerMillion: 75,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// $3 / $15: Sonnet 4.6, 4.5, 4 (all same price)
export const CLAUDE_SONNET: ModelPricingEntry = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// $1 / $5: Haiku 4.5
export const CLAUDE_HAIKU_CURRENT: ModelPricingEntry = {
  inputPerMillion: 1,
  outputPerMillion: 5,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// $0.80 / $4: Haiku 3.5 (retired except Bedrock/Vertex AI)
export const CLAUDE_HAIKU_LEGACY: ModelPricingEntry = {
  inputPerMillion: 0.80,
  outputPerMillion: 4,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// $15 / $75: Claude 3 Opus
export const CLAUDE_3_OPUS: ModelPricingEntry = {
  inputPerMillion: 15,
  outputPerMillion: 75,
  sourceUrl: CLAUDE_SOURCES.url,
  sourceLabel: CLAUDE_SOURCES.label,
  lastVerifiedDate: CLAUDE_SOURCES.verified
};

// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-05-16)
// Tier: $5/$25 = Opus 4.7/4.6/4.5; $15/$75 = Opus 4.1/4, Claude 3 Opus; $3/$15 = Sonnet all; $1/$5 = Haiku 4.5; $0.80/$4 = Haiku 3.5
export const CLAUDE_MODEL_PRICING: Record<string, ModelPricingEntry> = {
  'claude-opus-4-7':   CLAUDE_OPUS_CURRENT,
  'claude-opus-4-6':   CLAUDE_OPUS_CURRENT,
  'claude-opus-4-5':   CLAUDE_OPUS_CURRENT,
  'claude-opus-4-1':   CLAUDE_OPUS_LEGACY,
  'claude-opus-4':     CLAUDE_OPUS_LEGACY,
  'claude-3-opus':     CLAUDE_3_OPUS,
  'claude-sonnet-4-6': CLAUDE_SONNET,
  'claude-sonnet-4-5': CLAUDE_SONNET,
  'claude-sonnet-4':   CLAUDE_SONNET,
  'claude-3.5-sonnet': CLAUDE_SONNET,
  'claude-haiku-4-5':  CLAUDE_HAIKU_CURRENT,
  'claude-haiku-3-5':  CLAUDE_HAIKU_LEGACY,
};

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

export const GPT_5_5: ModelPricingEntry = {
  inputPerMillion: 5,
  outputPerMillion: 30,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: CODEX_SOURCES.label,
  lastVerifiedDate: CODEX_SOURCES.verified
};

export const GPT_5_4: ModelPricingEntry = {
  inputPerMillion: 2.50,
  outputPerMillion: 15,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: CODEX_SOURCES.label,
  lastVerifiedDate: CODEX_SOURCES.verified
};

export const GPT_5_4_MINI: ModelPricingEntry = {
  inputPerMillion: 0.75,
  outputPerMillion: 4.50,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: CODEX_SOURCES.label,
  lastVerifiedDate: CODEX_SOURCES.verified
};

export const GPT_5_4_NANO: ModelPricingEntry = {
  inputPerMillion: 0.20,
  outputPerMillion: 1.25,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: CODEX_SOURCES.label,
  lastVerifiedDate: CODEX_SOURCES.verified
};

export const GPT_5_3_CODEX: ModelPricingEntry = {
  inputPerMillion: 1.75,
  outputPerMillion: 14,
  sourceUrl: CODEX_SOURCES.url,
  sourceLabel: CODEX_SOURCES.label,
  lastVerifiedDate: CODEX_SOURCES.verified
};

// Source: https://developers.openai.com/api/docs/pricing (verified 2026-05-16)
// Prices: gpt-5.5 $5/$30; gpt-5.4 $2.50/$15; gpt-5.4-mini $0.75/$4.50; gpt-5.4-nano $0.20/$1.25; gpt-5.3-codex $1.75/$14
export const CODEX_MODEL_PRICING: Record<string, ModelPricingEntry> = {
  'gpt-5.5':        GPT_5_5,
  'gpt-5.4':        GPT_5_4,
  'gpt-5.4-mini':   GPT_5_4_MINI,
  'gpt-5.4-nano':   GPT_5_4_NANO,
  'gpt-5.3-codex':  GPT_5_3_CODEX,
  'codex-auto-review': GPT_5_3_CODEX,
};

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
  pricingTable: Record<string, ModelPricingEntry>,
  defaultPricing: ModelPricingEntry
): { pricing: ModelPricingEntry; matchedKey: string | undefined } {
  const normalized = modelName.toLowerCase();
  const keys = Object.keys(pricingTable).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.startsWith(key)) {
      return { pricing: pricingTable[key], matchedKey: key };
    }
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
    ? matchModelPricing(models[0], CLAUDE_MODEL_PRICING, DEFAULT_CLAUDE_PRICING)
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
    ? matchModelPricing(models[0], CODEX_MODEL_PRICING, DEFAULT_CODEX_PRICING)
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
    const table = isClaude ? CLAUDE_MODEL_PRICING : CODEX_MODEL_PRICING;
    const defaultPricing = isClaude ? DEFAULT_CLAUDE_PRICING : DEFAULT_CODEX_PRICING;
    const result = matchModelPricing(usage.model, table, defaultPricing);

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
