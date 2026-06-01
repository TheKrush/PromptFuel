export const RESET_EXPIRY_GRACE_MS = 15_000;
export const STALE_USAGE_THRESHOLD_MS = 20 * 60 * 1000;

export function isStale(epochMs: number | undefined, nowEpochMs = Date.now()): boolean {
  return typeof epochMs !== 'number' || nowEpochMs - epochMs > STALE_USAGE_THRESHOLD_MS;
}

function computeCountdownParts(diffMs: number): { days: number; hours: number; minutes: number } {
  const totalMinutes = Math.ceil(diffMs / 60000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60
  };
}

export function formatCountdown(epochSeconds: number | undefined, expiredLabel = '?'): string {
  if (!epochSeconds) return '?';
  const diffMs = epochSeconds * 1000 - Date.now();
  if (!Number.isFinite(diffMs)) return '?';
  if (diffMs <= 0) return expiredLabel;
  const { days, hours, minutes } = computeCountdownParts(diffMs);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatRelativeTime(epochSeconds: number | undefined): string | undefined {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) return undefined;
  const diffMs = epochSeconds * 1000 - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'now';
  const { days, hours, minutes } = computeCountdownParts(diffMs);
  if (days > 0) return `in ${days}d${hours}h`;
  if (hours > 0) return `in ${hours}h${minutes.toString().padStart(2, '0')}m`;
  return `in ${minutes}m`;
}

export function formatAgeLabel(epochMs: number | undefined, compact?: boolean): string {
  if (!epochMs) return 'unknown';
  const ageMs = Math.max(0, Date.now() - epochMs);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return compact ? 'just now' : 'under 1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const mins = (minutes % 60).toString().padStart(2, '0') + 'm';
    return `${hours}h${mins}`;
  }
  const days = Math.floor(hours / 24);
  if (compact) return `${days}d`;
  return `${days}d${hours % 24}h`;
}

export function formatCoarseAgeLabel(epochMs: number | undefined): string | undefined {
  if (!epochMs) return undefined;
  const diffMin = Math.round((Date.now() - epochMs) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  return `${hours}h`;
}

export function formatEpochToIso(epochMs: number | undefined): string | undefined {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs <= 0) return undefined;
  return new Date(epochMs).toISOString();
}

export function formatEpochSecondsToIso(epochSeconds: number | undefined): string | undefined {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) return undefined;
  return new Date(epochSeconds * 1000).toISOString();
}
