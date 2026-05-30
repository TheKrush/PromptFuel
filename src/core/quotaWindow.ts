import type { QuotaWindowId } from './quotaTypes';

export const QUOTA_WINDOW_DURATIONS_MS: Record<QuotaWindowId, number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function getWindowDurationMs(windowId: QuotaWindowId): number {
  return QUOTA_WINDOW_DURATIONS_MS[windowId];
}

export function computeWindowResetEpochMs(
  windowId: QuotaWindowId,
  nowMs: number = Date.now(),
): number {
  const duration = getWindowDurationMs(windowId);
  return Math.ceil(nowMs / duration) * duration;
}

export function isWindowNearReset(
  windowId: QuotaWindowId,
  resetEpochMs: number,
  nowMs: number = Date.now(),
  thresholdMs: number = 5 * 60 * 1000,
): boolean {
  const remaining = resetEpochMs - nowMs;
  return remaining >= 0 && remaining <= thresholdMs;
}
