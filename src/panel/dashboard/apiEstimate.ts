import { formatUsd } from './format';

export interface ApiEquivalentEstimateContribution {
  label: string;
  active: boolean;
  costUsd?: number;
  fallbackPricingUsed?: boolean;
  unavailableReason?: string;
}

export interface ApiEquivalentEstimateOptions {
  label: string;
  unavailableDetail: string;
  unavailableReason: string;
  includeContributionDetailLines?: boolean;
}

export interface ApiEquivalentEstimateResult {
  costUsd?: number;
  value: string;
  detail: string;
  detailLines?: string[];
  detailTooltip: string;
  available: boolean;
  complete: boolean;
  partial: boolean;
  fallbackPricingUsed: boolean;
  unavailableLabels: string[];
}

export interface ApiEstimateTooltipOptions {
  label: string;
  fallbackPricingUsed?: boolean;
  unavailableReason?: string;
  partialUnavailableReason?: string;
}

export function formatApiEstimateTooltip(options: ApiEstimateTooltipOptions): string {
  const prefix = `${options.label} estimate`;
  if (options.unavailableReason) {
    return `${prefix} unavailable: ${options.unavailableReason}. Not actual billing.`;
  }
  if (options.partialUnavailableReason) {
    return `${prefix} partial: unavailable from ${options.partialUnavailableReason}. ${options.fallbackPricingUsed ? 'Fallback pricing used; ' : ''}not actual billing.`;
  }
  return `${prefix}; ${options.fallbackPricingUsed ? 'fallback pricing used; ' : ''}not actual billing.`;
}

function hasUsableCost(
  contribution: ApiEquivalentEstimateContribution
): contribution is ApiEquivalentEstimateContribution & { costUsd: number } {
  return typeof contribution.costUsd === 'number' &&
    Number.isFinite(contribution.costUsd) &&
    contribution.costUsd >= 0;
}

function unavailableReasonFor(contribution: ApiEquivalentEstimateContribution): string {
  return contribution.unavailableReason?.trim() || 'model/token data unavailable';
}

// Partial-tolerant by design: returns a result object that can carry partial/
// unavailableLabels/disclosure text, so a partial sum here is safe to show — a missing
// contribution is named in unavailableLabels/detail rather than silently dropped. Call
// sites choose this when they can afford to disclose a gap instead of hiding it. Contrast
// with sumCostIfComplete (display/apiEquivalentCost.ts), which returns a bare number with
// no disclosure channel, so it is all-or-nothing: any missing row voids the whole sum
// rather than risk an undisclosed partial total.
export function buildApiEquivalentEstimateResult(
  contributions: ApiEquivalentEstimateContribution[],
  options: ApiEquivalentEstimateOptions
): ApiEquivalentEstimateResult {
  const relevant = contributions.filter(contribution => contribution.active);
  const valid = relevant.filter(hasUsableCost);
  const unavailable = relevant.filter(contribution => !hasUsableCost(contribution));
  const unavailableLabels = unavailable.map(contribution => contribution.label);
  const fallbackPricingUsed = valid.some(contribution => contribution.fallbackPricingUsed);

  if (valid.length === 0) {
    return {
      value: 'Unavailable',
      detail: options.unavailableDetail,
      detailTooltip: formatApiEstimateTooltip({ label: options.label, unavailableReason: options.unavailableReason }),
      available: false,
      complete: false,
      partial: false,
      fallbackPricingUsed: false,
      unavailableLabels
    };
  }

  const totalCostUsd = valid.reduce((sum, contribution) => sum + contribution.costUsd, 0);
  if (!Number.isFinite(totalCostUsd)) {
    return {
      value: 'Unavailable',
      detail: options.unavailableDetail,
      detailTooltip: formatApiEstimateTooltip({ label: options.label, unavailableReason: options.unavailableReason }),
      available: false,
      complete: false,
      partial: false,
      fallbackPricingUsed: false,
      unavailableLabels
    };
  }

  if (unavailable.length === 0) {
    const detailLines = valid.length >= 2 || options.includeContributionDetailLines
      ? valid.map(contribution => `${contribution.label}: ${formatUsd(contribution.costUsd)}`)
      : undefined;
    return {
      costUsd: totalCostUsd,
      value: formatUsd(totalCostUsd),
      detail: valid.map(contribution => `${contribution.label} ${formatUsd(contribution.costUsd)}`).join(' | '),
      ...(detailLines ? { detailLines } : {}),
      detailTooltip: formatApiEstimateTooltip({ label: options.label, fallbackPricingUsed }),
      available: true,
      complete: true,
      partial: false,
      fallbackPricingUsed,
      unavailableLabels: []
    };
  }

  const unavailableSummary = unavailable
    .map(contribution => `${contribution.label}: ${unavailableReasonFor(contribution)}`)
    .join('; ');
  return {
    costUsd: totalCostUsd,
    value: formatUsd(totalCostUsd),
    detail: `Partial estimate · unavailable: ${unavailableLabels.join(', ')}`,
    detailLines: [
      `Partial estimate · unavailable: ${unavailableLabels.join(', ')}`,
      ...valid.map(contribution => `${contribution.label}: ${formatUsd(contribution.costUsd)}`)
    ],
    detailTooltip: formatApiEstimateTooltip({
      label: options.label,
      fallbackPricingUsed,
      partialUnavailableReason: unavailableSummary
    }),
    available: true,
    complete: false,
    partial: true,
    fallbackPricingUsed,
    unavailableLabels
  };
}
