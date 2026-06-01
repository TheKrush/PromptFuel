import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAuthenticatedBackoffSeconds, getAuthenticatedRefreshGate } from '../quota/refreshPolicy';

describe('authenticated refresh policy', () => {
  it('honors poll delay unless manually bypassed', () => {
    const now = 1_800_000_000_000;

    assert.deepEqual(getAuthenticatedRefreshGate({ nowEpochMs: now, nextPollEpochMs: now + 60_000 }), {
      action: 'nextPoll',
      nextPollEpochMs: now + 60_000
    });
    assert.deepEqual(getAuthenticatedRefreshGate({ nowEpochMs: now, bypassPollDelay: true, nextPollEpochMs: now + 60_000 }), { action: 'fetch' });
    assert.deepEqual(getAuthenticatedRefreshGate({ nowEpochMs: now, manual: true, nextPollEpochMs: now + 60_000 }), { action: 'fetch' });
  });

  it('keeps backoff ahead of poll delay unless bypass cooldown allows a retry', () => {
    const now = 1_800_000_000_000;

    assert.deepEqual(getAuthenticatedRefreshGate({
      nowEpochMs: now,
      manual: true,
      backoffUntilEpochMs: now + 60_000,
      nextPollEpochMs: now + 60_000
    }), { action: 'backoff', backoffUntilEpochMs: now + 60_000 });

    assert.deepEqual(getAuthenticatedRefreshGate({
      nowEpochMs: now,
      bypassBackoff: true,
      backoffUntilEpochMs: now + 60_000,
      nextPollEpochMs: now + 60_000
    }), { action: 'fetch', bypassedBackoff: true, backoffUntilEpochMs: now + 60_000 });

    assert.deepEqual(getAuthenticatedRefreshGate({
      nowEpochMs: now,
      bypassBackoff: true,
      backoffUntilEpochMs: now + 60_000,
      nextPollEpochMs: now + 60_000,
      lastBypassBackoffAttemptEpochMs: now - 10_000,
      minBypassBackoffIntervalMs: 60_000
    }), { action: 'backoff', backoffUntilEpochMs: now + 60_000 });

    assert.deepEqual(getAuthenticatedRefreshGate({
      nowEpochMs: now,
      bypassBackoff: true,
      backoffUntilEpochMs: now + 60_000,
      nextPollEpochMs: now + 60_000,
      lastBypassBackoffAttemptEpochMs: now - 120_000,
      minBypassBackoffIntervalMs: 60_000
    }), { action: 'fetch', bypassedBackoff: true, backoffUntilEpochMs: now + 60_000 });
  });

  it('calculates bounded exponential backoff and honors Retry-After as a floor', () => {
    assert.equal(calculateAuthenticatedBackoffSeconds(1), 60);
    assert.equal(calculateAuthenticatedBackoffSeconds(2), 120);
    assert.equal(calculateAuthenticatedBackoffSeconds(3), 180);
    assert.equal(calculateAuthenticatedBackoffSeconds(10), 180);
    assert.equal(calculateAuthenticatedBackoffSeconds(1, 90), 90);
    assert.equal(calculateAuthenticatedBackoffSeconds(1, 30), 60);
    assert.equal(calculateAuthenticatedBackoffSeconds(2, 200), 200);
    assert.equal(calculateAuthenticatedBackoffSeconds(1, 2000), 1800);
    assert.equal(calculateAuthenticatedBackoffSeconds(100, 5000), 1800);
    assert.equal(calculateAuthenticatedBackoffSeconds(0), 30);
  });
});
