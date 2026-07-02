import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNextResetRefreshPlan } from '../quota/resetRefresh';

const NOW = 1_800_000_000_000;
const DELAY_MS = 10_000;
const IMMEDIATE_DELAY_MS = 5_000;

describe('reset refresh planning', () => {
  it('schedules a future reset refresh after the reset plus delay', () => {
    const nearFiveHour = Math.floor((NOW + 3 * 60_000) / 1000);
    const plan = getNextResetRefreshPlan(
      [{ provider: 'claude', fiveHour: { usedPercentage: 75, resetsAtEpochSeconds: nearFiveHour } }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS }
    );

    assert.equal(plan?.provider, 'claude');
    assert.equal(plan?.windowLabel, '5h');
    assert.equal(plan?.scheduledEpochMs, nearFiveHour * 1000 + DELAY_MS);
  });

  it('chooses the earliest eligible window across a provider', () => {
    const nearFiveHour = Math.floor((NOW + 3 * 60_000) / 1000);
    const soonerSevenDay = Math.floor((NOW + 2 * 60_000) / 1000);
    const plan = getNextResetRefreshPlan(
      [{
        provider: 'claude',
        fiveHour: { usedPercentage: 50, resetsAtEpochSeconds: nearFiveHour },
        sevenDay: { usedPercentage: 60, resetsAtEpochSeconds: soonerSevenDay }
      }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS }
    );

    assert.equal(plan?.windowLabel, '7d');
    assert.equal(plan?.scheduledEpochMs, soonerSevenDay * 1000 + DELAY_MS);
  });

  it('includes generic meter resets in the same planner', () => {
    const meterReset = Math.floor((NOW + 90_000) / 1000);
    const plan = getNextResetRefreshPlan(
      [{
        provider: 'claude',
        meters: [{
          id: 'fake-scoped-meter',
          label: 'preview 1d',
          scope: 'model',
          windowSeconds: 86_400,
          window: { usedPercentage: 20, resetsAtEpochSeconds: meterReset }
        }]
      }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS }
    );

    assert.equal(plan?.windowLabel, 'preview 1d');
    assert.equal(plan?.scheduledEpochMs, meterReset * 1000 + DELAY_MS);
  });

  it('retries recent past resets immediately unless retry cooldown blocks the key', () => {
    const recentPastReset = Math.floor((NOW - 20_000) / 1000);
    const plan = getNextResetRefreshPlan(
      [{ provider: 'codex', fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: recentPastReset } }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS }
    );

    assert.equal(plan?.scheduledEpochMs, NOW + IMMEDIATE_DELAY_MS);

    const cooledDownPlan = getNextResetRefreshPlan(
      [{ provider: 'codex', fiveHour: { usedPercentage: 100, resetsAtEpochSeconds: recentPastReset } }],
      {
        nowEpochMs: NOW,
        delayMs: DELAY_MS,
        immediateDelayMs: IMMEDIATE_DELAY_MS,
        retryCooldownMs: 120_000,
        lastAttemptEpochMsByKey: new Map([[`codex:5h:${recentPastReset}`, NOW - 30_000]])
      }
    );

    assert.equal(cooledDownPlan, undefined);
  });

  it('ignores missing and stale-past reset metadata', () => {
    const stalePastReset = Math.floor((NOW - 10 * 60_000) / 1000);

    assert.equal(getNextResetRefreshPlan(
      [{ provider: 'claude', fiveHour: { usedPercentage: 20 } }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS }
    ), undefined);

    assert.equal(getNextResetRefreshPlan(
      [{ provider: 'codex', sevenDay: { usedPercentage: 80, resetsAtEpochSeconds: stalePastReset } }],
      { nowEpochMs: NOW, delayMs: DELAY_MS, immediateDelayMs: IMMEDIATE_DELAY_MS, recentPastWindowMs: 60_000 }
    ), undefined);
  });
});
