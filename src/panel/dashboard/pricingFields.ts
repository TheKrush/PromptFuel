import { estimateConfiguredModelCostUsd, findConfiguredModelPricing, type PricingProvider } from '../../providers/pricing';

export interface ModelPricingTokenComponents {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface DashboardModelPricingFields {
  pricingModel: string;
  apiEquivalentCostUsd?: number;
  apiEquivalentCostUnavailableReason?: string;
  pricingMatchedModel?: string;
  pricingCurrency?: string;
  inputRatePerMillionUsd?: number;
  outputRatePerMillionUsd?: number;
  cacheReadRatePerMillionUsd?: number;
  cacheWriteRatePerMillionUsd?: number;
}

export function modelPricingFields(
  provider: PricingProvider,
  modelName: string,
  tokens: ModelPricingTokenComponents
): DashboardModelPricingFields {
  const pricingModel = modelName || 'model';
  const pricing = findConfiguredModelPricing(provider, pricingModel);
  const rateFields = pricing ? {
    pricingMatchedModel: pricing.matchedModel,
    pricingCurrency: pricing.currency,
    inputRatePerMillionUsd: pricing.inputPerMillion,
    outputRatePerMillionUsd: pricing.outputPerMillion,
    cacheReadRatePerMillionUsd: pricing.cacheReadPerMillion,
    cacheWriteRatePerMillionUsd: pricing.cacheWritePerMillion
  } : {};

  const estimate = estimateConfiguredModelCostUsd(
    provider,
    pricingModel,
    tokens.inputTokens,
    tokens.outputTokens,
    tokens.cacheReadInputTokens,
    tokens.cacheCreationInputTokens
  );

  return {
    pricingModel,
    ...rateFields,
    ...(estimate.available
      ? { apiEquivalentCostUsd: estimate.costUsd }
      : { apiEquivalentCostUnavailableReason: estimate.unavailableReason })
  };
}
