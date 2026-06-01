import { ProviderUsageState } from '../types';

export interface ResetRefreshPlan {
  key: string;
  provider: ProviderUsageState['provider'];
  windowLabel: '5h' | '7d';
  resetEpochSeconds: number;
  scheduledEpochMs: number;
}

export interface ResetRefreshPlannerOptions {
  nowEpochMs?: number;
  delayMs?: number;
  immediateDelayMs?: number;
  recentPastWindowMs?: number;
  stalePastWindowMs?: number;
  retryCooldownMs?: number;
  lastAttemptEpochMsByKey?: ReadonlyMap<string, number>;
}

const DEFAULT_DELAY_MS = 10_000;
const DEFAULT_IMMEDIATE_DELAY_MS = 5_000;
const DEFAULT_RECENT_PAST_WINDOW_MS = 2 * 60_000;
const DEFAULT_STALE_PAST_WINDOW_MS = 30 * 60_000;
const DEFAULT_RETRY_COOLDOWN_MS = 2 * 60_000;

export function getNextResetRefreshPlan(
  states: ProviderUsageState[],
  options: ResetRefreshPlannerOptions = {}
): ResetRefreshPlan | undefined {
  const nowEpochMs = options.nowEpochMs ?? Date.now();
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const immediateDelayMs = options.immediateDelayMs ?? DEFAULT_IMMEDIATE_DELAY_MS;
  const recentPastWindowMs = options.recentPastWindowMs ?? DEFAULT_RECENT_PAST_WINDOW_MS;
  const stalePastWindowMs = options.stalePastWindowMs ?? DEFAULT_STALE_PAST_WINDOW_MS;
  const retryCooldownMs = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;

  const plans = states.flatMap(state =>
    collectWindowPlans(state, nowEpochMs, delayMs, immediateDelayMs, recentPastWindowMs, stalePastWindowMs, retryCooldownMs, options.lastAttemptEpochMsByKey)
  );

  if (plans.length === 0) {
    return undefined;
  }

  plans.sort((left, right) => {
    if (left.scheduledEpochMs !== right.scheduledEpochMs) {
      return left.scheduledEpochMs - right.scheduledEpochMs;
    }
    if (left.resetEpochSeconds !== right.resetEpochSeconds) {
      return left.resetEpochSeconds - right.resetEpochSeconds;
    }
    return left.key.localeCompare(right.key);
  });

  return plans[0];
}

function collectWindowPlans(
  state: ProviderUsageState,
  nowEpochMs: number,
  delayMs: number,
  immediateDelayMs: number,
  recentPastWindowMs: number,
  stalePastWindowMs: number,
  retryCooldownMs: number,
  lastAttemptEpochMsByKey: ReadonlyMap<string, number> | undefined
): ResetRefreshPlan[] {
  const windows = [
    { label: '5h' as const, resetEpochSeconds: state.fiveHour?.resetsAtEpochSeconds },
    { label: '7d' as const, resetEpochSeconds: state.sevenDay?.resetsAtEpochSeconds }
  ];

  const plans: ResetRefreshPlan[] = [];
  for (const window of windows) {
    const resetEpochSeconds = normalizeResetEpochSeconds(window.resetEpochSeconds);
    if (!resetEpochSeconds) {
      continue;
    }

    const key = `${state.provider}:${window.label}:${resetEpochSeconds}`;
    const scheduledEpochMs = getScheduledEpochMs(
      resetEpochSeconds,
      nowEpochMs,
      delayMs,
      immediateDelayMs,
      recentPastWindowMs,
      stalePastWindowMs,
      retryCooldownMs,
      lastAttemptEpochMsByKey?.get(key)
    );
    if (scheduledEpochMs === undefined) {
      continue;
    }

    plans.push({
      key,
      provider: state.provider,
      windowLabel: window.label,
      resetEpochSeconds,
      scheduledEpochMs
    });
  }

  return plans;
}

function normalizeResetEpochSeconds(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function getScheduledEpochMs(
  resetEpochSeconds: number,
  nowEpochMs: number,
  delayMs: number,
  immediateDelayMs: number,
  recentPastWindowMs: number,
  stalePastWindowMs: number,
  retryCooldownMs: number,
  lastAttemptEpochMs: number | undefined
): number | undefined {
  const targetEpochMs = resetEpochSeconds * 1000 + delayMs;
  if (!Number.isFinite(targetEpochMs)) {
    return undefined;
  }

  if (targetEpochMs >= nowEpochMs) {
    return targetEpochMs;
  }

  const overdueMs = nowEpochMs - targetEpochMs;
  if (overdueMs > stalePastWindowMs) {
    return undefined;
  }
  if (overdueMs > recentPastWindowMs) {
    return undefined;
  }
  if (lastAttemptEpochMs !== undefined && nowEpochMs - lastAttemptEpochMs < retryCooldownMs) {
    return undefined;
  }

  return nowEpochMs + immediateDelayMs;
}
