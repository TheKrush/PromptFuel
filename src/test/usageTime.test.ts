import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const FIXED_NOW_MS = 2_000_000_000_000;

function countdownFromNow(diffMs: number, expiredLabel?: string): string {
  const epochSeconds = (FIXED_NOW_MS + diffMs) / 1000;
  return expiredLabel === undefined
    ? formatCountdown(epochSeconds)
    : formatCountdown(epochSeconds, expiredLabel);
}
import {
  formatCountdown,
  formatRelativeTime,
  formatAgeLabel,
  formatDetailedAgeLabel,
  formatCoarseAgeLabel,
  formatEpochToIso,
  formatEpochSecondsToIso,
  isStale,
  STALE_USAGE_THRESHOLD_MS
} from '../usageTime';

describe('formatCountdown', () => {
  it('returns ? for undefined', () => {
    assert.equal(formatCountdown(undefined), '?');
  });

  it('returns ? for expired timestamps', () => {
    assert.equal(formatCountdown(1), '?');
  });

  it('can return a caller-specific expired label', () => {
    assert.equal(formatCountdown(1, 'now'), 'now');
  });

  it('returns minutes only under one hour', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(5 * 60 * 1000), '5m');
    assert.equal(countdownFromNow(59 * 60 * 1000), '59m');
  });

  it('formats hours with zero-padded minutes', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(1 * 3600 * 1000), '1h');
    assert.equal(countdownFromNow((1 * 3600 + 5 * 60) * 1000), '1h05m');
    assert.equal(countdownFromNow((1 * 3600 + 55 * 60) * 1000), '1h55m');
    assert.equal(countdownFromNow((23 * 3600 + 59 * 60) * 1000), '23h59m');
  });

  it('formats days with remaining hours and no minutes', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(1 * 86400 * 1000), '1d');
    assert.equal(countdownFromNow((1 * 86400 + 5 * 3600) * 1000), '1d5h');
    assert.equal(countdownFromNow((1 * 86400 + 23 * 3600) * 1000), '1d23h');
    assert.equal(countdownFromNow((2 * 86400 + 5 * 3600) * 1000), '2d5h');
  });

  it('rounds a remaining partial minute upward', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(4 * 60 * 1000 + 30 * 1000), '5m');
    assert.equal(countdownFromNow((1 * 3600 + 5 * 60) * 1000 + 30 * 1000), '1h06m');
    assert.equal(countdownFromNow((1 * 86400 + 4 * 3600 + 59 * 60) * 1000 + 30 * 1000), '1d5h');
  });

  it('never emits a zero-valued lower-order unit when a larger unit is present', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow((5 * 86400 + 4 * 3600 + 32 * 60) * 1000), '5d4h');
    assert.equal(countdownFromNow((5 * 86400 + 27 * 60) * 1000), '5d27m');
    assert.equal(countdownFromNow(5 * 86400 * 1000), '5d');
    assert.equal(countdownFromNow((4 * 3600 + 18 * 60) * 1000), '4h18m');
    assert.equal(countdownFromNow(4 * 3600 * 1000), '4h');
    assert.equal(countdownFromNow(37 * 60 * 1000), '37m');
  });

  it('returns <1m for a positive duration under one minute', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(1), '<1m');
    assert.equal(countdownFromNow(59 * 1000), '<1m');
  });

  it('clamps expired or negative durations without going negative', (t) => {
    t.mock.method(Date, 'now', () => FIXED_NOW_MS);
    assert.equal(countdownFromNow(0), '?');
    assert.equal(countdownFromNow(-1), '?');
    assert.equal(countdownFromNow(-1, 'now'), 'now');
  });
});

describe('formatRelativeTime', () => {
  it('returns undefined for undefined', () => {
    assert.equal(formatRelativeTime(undefined), undefined);
  });

  it('returns undefined for zero', () => {
    assert.equal(formatRelativeTime(0), undefined);
  });

  it('returns now for expired timestamps', () => {
    assert.equal(formatRelativeTime(1), 'now');
  });

  it('formats minutes', () => {
    const future = (Date.now() + 5 * 60 * 1000) / 1000;
    assert.match(formatRelativeTime(future) ?? '', /^in \d+m$/);
  });

  it('formats hours and minutes', () => {
    const future = (Date.now() + 3 * 3600 * 1000 + 15 * 60 * 1000) / 1000;
    assert.match(formatRelativeTime(future) ?? '', /^in \d+h\d{2}m$/);
  });

  it('formats days and hours', () => {
    const future = (Date.now() + 2 * 86400 * 1000 + 5 * 3600 * 1000) / 1000;
    assert.match(formatRelativeTime(future) ?? '', /^in \d+d\d+h$/);
  });
});

describe('formatAgeLabel', () => {
  it('returns unknown for undefined', () => {
    assert.equal(formatAgeLabel(undefined), 'unknown');
  });

  it('returns under 1m for recent', () => {
    assert.equal(formatAgeLabel(Date.now()), 'under 1m');
  });

  it('returns compact just now', () => {
    assert.equal(formatAgeLabel(Date.now(), true), 'just now');
  });

  it('returns minutes', () => {
    assert.equal(formatAgeLabel(Date.now() - 5 * 60 * 1000), '5m');
  });

  it('returns hours and minutes', () => {
    assert.equal(formatAgeLabel(Date.now() - 3 * 3600 * 1000 - 15 * 60 * 1000), '3h15m');
  });

  it('keeps hours and minutes in compact mode before one day', () => {
    assert.equal(formatAgeLabel(Date.now() - 3 * 3600 * 1000 - 15 * 60 * 1000, true), '3h15m');
  });

  it('returns days and hours', () => {
    assert.equal(formatAgeLabel(Date.now() - 2 * 86400 * 1000 - 5 * 3600 * 1000), '2d5h');
  });

  it('returns compact days only', () => {
    assert.match(formatAgeLabel(Date.now() - 2 * 86400 * 1000, true), /^\d+d$/);
  });
});

describe('formatDetailedAgeLabel', () => {
  it('returns undefined without a trustworthy timestamp', () => {
    assert.equal(formatDetailedAgeLabel(undefined), undefined);
  });

  it('uses natural words without an ago suffix', () => {
    assert.equal(formatDetailedAgeLabel(Date.now()), 'just now');
    assert.equal(formatDetailedAgeLabel(Date.now() - 5 * 60 * 1000), '5 minutes');
    assert.equal(formatDetailedAgeLabel(Date.now() - 3 * 3600 * 1000), '3 hours');
    assert.equal(formatDetailedAgeLabel(Date.now() - 5 * 86400 * 1000), '5 days');
  });
});

describe('formatCoarseAgeLabel', () => {
  it('returns undefined for undefined', () => {
    assert.equal(formatCoarseAgeLabel(undefined), undefined);
  });

  it('returns just now for recent timestamps', () => {
    assert.equal(formatCoarseAgeLabel(Date.now()), 'just now');
  });

  it('returns rounded minutes', () => {
    assert.equal(formatCoarseAgeLabel(Date.now() - 5 * 60 * 1000), '5m');
  });

  it('returns hours without minutes', () => {
    assert.equal(formatCoarseAgeLabel(Date.now() - 3 * 3600 * 1000 - 15 * 60 * 1000), '3h');
  });
});

describe('formatEpochToIso', () => {
  it('returns undefined for undefined', () => {
    assert.equal(formatEpochToIso(undefined), undefined);
  });

  it('returns ISO string for valid ms', () => {
    const result = formatEpochToIso(1720000000000);
    assert.ok(result?.includes('T'));
    assert.ok(result?.endsWith('Z') || result?.endsWith('Z'));
  });

  it('returns undefined for zero', () => {
    assert.equal(formatEpochToIso(0), undefined);
  });
});

describe('formatEpochSecondsToIso', () => {
  it('returns undefined for undefined', () => {
    assert.equal(formatEpochSecondsToIso(undefined), undefined);
  });

  it('returns ISO string for valid seconds', () => {
    const result = formatEpochSecondsToIso(1720000000);
    assert.ok(result?.includes('T'));
  });

  it('returns undefined for zero', () => {
    assert.equal(formatEpochSecondsToIso(0), undefined);
  });
});

describe('isStale', () => {
  it('returns true for undefined', () => {
    assert.equal(isStale(undefined), true);
  });

  it('returns true for old timestamps', () => {
    assert.equal(isStale(Date.now() - 30 * 60 * 1000), true);
  });

  it('returns false for recent timestamps', () => {
    assert.equal(isStale(Date.now()), false);
  });

  it('uses an inclusive 20-minute freshness boundary', () => {
    const fixedNow = 2_000_000_000_000;

    assert.equal(isStale(fixedNow - STALE_USAGE_THRESHOLD_MS, fixedNow), false);
    assert.equal(isStale(fixedNow - STALE_USAGE_THRESHOLD_MS - 1, fixedNow), true);
  });
});
