export const DEFAULT_LOW_REMAINING_PERCENT = 50;
export const DEFAULT_WARN_REMAINING_PERCENT = 30;
export const DEFAULT_CRITICAL_REMAINING_PERCENT = 10;
export const DEFAULT_EMPTY_REMAINING_PERCENT = 1;

export interface NormalizedThresholds {
  lowRemainingPercent: number;
  warnRemainingPercent: number;
  criticalRemainingPercent: number;
  emptyRemainingPercent: number;
}

export function normalizeThresholds(
  low: number,
  warn: number,
  critical: number,
  empty: number
): NormalizedThresholds {
  if (low >= warn && warn >= critical && critical >= empty) {
    return { lowRemainingPercent: low, warnRemainingPercent: warn, criticalRemainingPercent: critical, emptyRemainingPercent: empty };
  }
  console.warn(
    `PromptFuel: quota threshold ordering invalid (low=${low}, warn=${warn}, critical=${critical}, empty=${empty}). ` +
    `Expected empty <= critical <= warning <= low. Falling back to defaults.`
  );
  return {
    lowRemainingPercent: DEFAULT_LOW_REMAINING_PERCENT,
    warnRemainingPercent: DEFAULT_WARN_REMAINING_PERCENT,
    criticalRemainingPercent: DEFAULT_CRITICAL_REMAINING_PERCENT,
    emptyRemainingPercent: DEFAULT_EMPTY_REMAINING_PERCENT
  };
}
