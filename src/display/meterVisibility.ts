import type { UsageMeter } from '../types';
import { normalizeUsageMeterId } from '../providers/authenticatedQuota';

// Re-exported so vscode-free consumers (e.g. meterDiscovery.ts) can normalize
// meter IDs without importing directly from the providers layer.
export { normalizeUsageMeterId };

export const EXTRA_USAGE_METER_ID = 'extra-usage';
export const EXTRA_USAGE_METER_LABEL = 'extra usage';
export const ALL_GENERIC_USAGE_METERS = '*';

/** Minimal shape shared by UsageMeter and SnapshotUsageMeter. */
export interface SelectableMeter { id: string; label: string; }

export interface MeterVisibilityPolicy {
  showExtraUsage: boolean;
  visibleUsageMeters: string[];
}

export const DEFAULT_METER_VISIBILITY: MeterVisibilityPolicy = {
  showExtraUsage: true,
  visibleUsageMeters: []
};

export function normalizeVisibleUsageMeters(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed === ALL_GENERIC_USAGE_METERS ? ALL_GENERIC_USAGE_METERS : normalizeUsageMeterId(trimmed);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeShowExtraUsage(raw: unknown): boolean {
  return raw === false ? false : true;
}

// Deliberately provider-agnostic: any provider's meter whose normalized ID or label
// is "extra usage" is governed by promptFuel.showExtraUsage rather than falling into
// the opt-in generic bucket. This preserves the pre-existing behavior that a non-Claude
// extra usage meter is displayed. Note this is a different axis from the value-based
// zero/exhausted hiding in format.ts, which stays Claude-only and is unchanged.
export function isExtraUsageMeter(meter: SelectableMeter): boolean {
  const id = normalizeUsageMeterId(meter.id);
  const label = meter.label.trim().toLowerCase().replace(/\s+/g, ' ');
  return id === EXTRA_USAGE_METER_ID || label === EXTRA_USAGE_METER_LABEL;
}

export function isMeterSelected(
  meter: SelectableMeter,
  policy: MeterVisibilityPolicy = DEFAULT_METER_VISIBILITY
): boolean {
  if (isExtraUsageMeter(meter)) {
    return policy.showExtraUsage;
  }
  // Normalize the selection list here as well as at config read time: the policy
  // type is a plain string[], so a caller can hand us raw user-shaped IDs
  // ("meter_id", "Meter ID") that must still match a normalized meter ID.
  const selected = normalizeVisibleUsageMeters(policy.visibleUsageMeters);
  return selected.includes(ALL_GENERIC_USAGE_METERS)
    || selected.includes(normalizeUsageMeterId(meter.id));
}

export function selectVisibleMeters<T extends SelectableMeter>(
  meters: T[] | undefined,
  policy?: MeterVisibilityPolicy
): T[] {
  return (meters ?? []).filter(m => isMeterSelected(m, policy ?? DEFAULT_METER_VISIBILITY));
}

export function applyMeterVisibility<T extends { meters?: UsageMeter[] }>(
  state: T,
  policy?: MeterVisibilityPolicy
): T {
  if (!state.meters) {
    return state;
  }
  return { ...state, meters: selectVisibleMeters(state.meters, policy) };
}
