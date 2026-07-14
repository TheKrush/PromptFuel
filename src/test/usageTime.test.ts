import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

  it('returns minutes for < 1 hour', () => {
    const future = (Date.now() + 5 * 60 * 1000) / 1000;
    const result = formatCountdown(future);
    assert.match(result, /^\d+m$/);
  });

  it('returns hours for < 1 day', () => {
    const future = (Date.now() + 3 * 3600 * 1000) / 1000;
    const result = formatCountdown(future);
    assert.match(result, /^\d+h$/);
  });

  it('returns days for >= 1 day', () => {
    const future = (Date.now() + 2 * 86400 * 1000) / 1000;
    const result = formatCountdown(future);
    assert.match(result, /^\d+d$/);
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
