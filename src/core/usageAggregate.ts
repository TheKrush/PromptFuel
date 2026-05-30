export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface AggregateUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCacheReadInputTokens: number;
  totalTokens: number;
  totalAssistantMessages: number;
}

export function createEmptyAggregate(): AggregateUsage {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalTokens: 0,
    totalAssistantMessages: 0,
  };
}

export function tokenUsageTotal(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

export function mergeTokenUsage(
  aggregate: AggregateUsage,
  usage: TokenUsage,
): void {
  aggregate.totalAssistantMessages += 1;
  aggregate.totalInputTokens += usage.inputTokens;
  aggregate.totalOutputTokens += usage.outputTokens;
  aggregate.totalCacheCreationInputTokens += usage.cacheCreationInputTokens;
  aggregate.totalCacheReadInputTokens += usage.cacheReadInputTokens;
  aggregate.totalTokens += tokenUsageTotal(usage);
}
