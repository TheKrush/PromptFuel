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

export function sumCostIfComplete(rows: ReadonlyArray<ApiEquivalentCostRow>): number | undefined {
  if (!hasCompleteCostData(rows)) {
    return undefined;
  }
  return rows.reduce((sum, row) => sum + normalizeCost(row.costUsd)!, 0);
}
