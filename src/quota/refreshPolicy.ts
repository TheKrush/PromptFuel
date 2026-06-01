export interface AuthenticatedRefreshGateOptions {
  manual?: boolean;
  bypassPollDelay?: boolean;
  bypassBackoff?: boolean;
  nowEpochMs: number;
  backoffUntilEpochMs?: number;
  nextPollEpochMs?: number;
  lastBypassBackoffAttemptEpochMs?: number;
  minBypassBackoffIntervalMs?: number;
}

export type AuthenticatedRefreshGate =
  | { action: 'fetch'; bypassedBackoff?: true; backoffUntilEpochMs?: number }
  | { action: 'backoff'; backoffUntilEpochMs: number }
  | { action: 'nextPoll'; nextPollEpochMs: number };

const DEFAULT_MIN_BYPASS_BACKOFF_INTERVAL_MS = 60_000;
const BACKOFF_BASE_INTERVAL_S = 30;
const BACKOFF_MAX_MULTIPLIER = 6;
const BACKOFF_CEILING_S = 30 * 60;

export function getAuthenticatedRefreshGate(options: AuthenticatedRefreshGateOptions): AuthenticatedRefreshGate {
  const backoffUntil = options.backoffUntilEpochMs ?? 0;
  if (backoffUntil > options.nowEpochMs) {
    if (options.bypassBackoff) {
      const lastAttempt = options.lastBypassBackoffAttemptEpochMs ?? 0;
      const cooldown = options.minBypassBackoffIntervalMs ?? DEFAULT_MIN_BYPASS_BACKOFF_INTERVAL_MS;
      if (lastAttempt === 0 || options.nowEpochMs - lastAttempt >= cooldown) {
        return { action: 'fetch', bypassedBackoff: true, backoffUntilEpochMs: backoffUntil };
      }
    }
    return { action: 'backoff', backoffUntilEpochMs: backoffUntil };
  }

  const nextPoll = options.nextPollEpochMs ?? 0;
  if (!options.manual && !options.bypassPollDelay && nextPoll > options.nowEpochMs) {
    return { action: 'nextPoll', nextPollEpochMs: nextPoll };
  }

  return { action: 'fetch' };
}

export function calculateAuthenticatedBackoffSeconds(failures: number, retryAfterSeconds?: number): number {
  const multiplier = Math.min(Math.pow(2, failures), BACKOFF_MAX_MULTIPLIER);
  const calculatedBackoffS = multiplier * BACKOFF_BASE_INTERVAL_S;
  const retryAfterS = retryAfterSeconds ?? 0;
  return Math.min(Math.max(calculatedBackoffS, retryAfterS), BACKOFF_CEILING_S);
}
