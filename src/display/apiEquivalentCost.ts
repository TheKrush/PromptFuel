export interface ApiEquivalentCostRow {
  costUsd?: number;
}

function normalizeCost(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

export function hasCompleteCostData(rows: ReadonlyArray<ApiEquivalentCostRow>): boolean {
  return rows.length > 0 && rows.every(row => normalizeCost(row.costUsd) !== undefined);
}

// All-or-nothing by design: returns undefined unless every row has a usable cost, then
// sums a bare number with no channel to disclose what's missing. Call sites choose this
// when a partial sum would misrepresent the total as complete and there is no way to name
// the gap in the result itself (e.g. combining across providers, per usageDashboardModel.ts).
// Contrast with buildApiEquivalentEstimateResult (panel/dashboard/apiEstimate.ts), which
// returns a result object carrying partial/unavailableLabels/disclosure text, so a partial
// total is safe to show because the gap is named to the user.
export function sumCostIfComplete(rows: ReadonlyArray<ApiEquivalentCostRow>): number | undefined {
  if (!hasCompleteCostData(rows)) {
    return undefined;
  }
  return rows.reduce((sum, row) => sum + normalizeCost(row.costUsd)!, 0);
}
