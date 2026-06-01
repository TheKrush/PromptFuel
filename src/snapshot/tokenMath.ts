export interface TokenComponentInput {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
  reasoningOutputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

export interface NormalizedTokenComponents {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
}

function nonNegativeNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeTokenComponents(row: TokenComponentInput | undefined): NormalizedTokenComponents {
  return {
    inputTokens: nonNegativeNumber(row?.inputTokens),
    outputTokens: nonNegativeNumber(row?.outputTokens),
    cacheCreationTokens: nonNegativeNumber(row?.cacheCreationTokens ?? row?.cacheCreationInputTokens),
    cacheReadTokens: nonNegativeNumber(row?.cacheReadTokens ?? row?.cacheReadInputTokens),
    reasoningOutputTokens: nonNegativeNumber(row?.reasoningOutputTokens)
  };
}

export function displayTotalTokens(row: TokenComponentInput | undefined): number {
  const t = normalizeTokenComponents(row);
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

export function hasTokenData(row: TokenComponentInput | undefined): boolean {
  const t = normalizeTokenComponents(row);
  return t.inputTokens > 0 ||
    t.outputTokens > 0 ||
    t.cacheCreationTokens > 0 ||
    t.cacheReadTokens > 0 ||
    t.reasoningOutputTokens > 0;
}

export function sumTokens(a: TokenComponentInput | undefined, b: TokenComponentInput | undefined): NormalizedTokenComponents {
  const left = normalizeTokenComponents(a);
  const right = normalizeTokenComponents(b);
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens
  };
}
