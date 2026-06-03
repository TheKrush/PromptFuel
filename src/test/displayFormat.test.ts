import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addThousandsSeparators, formatStatus, formatTokenCount, quotaLevelForRemaining, type FormatOptions } from '../display/format';
import { normalizeThresholds } from '../configThresholds';
import type { ProviderUsageState } from '../types';

function makeState(usedPercentSevenDay: number, usedPercentFiveHour = usedPercentSevenDay): ProviderUsageState[] {
  const reset = Math.floor(Date.now() / 1000) + 86_400;
  return [{
    provider: 'claude',
    source: 'threshold unit fixture',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    sevenDay: { usedPercentage: usedPercentSevenDay, resetsAtEpochSeconds: reset },
    fiveHour: { usedPercentage: usedPercentFiveHour, resetsAtEpochSeconds: reset }
  }];
}

function baseOptions(): FormatOptions {
  return {
    displayMode: 'compact',
    statusMode: 'remaining',
    lowRemainingPercent: 50,
    warnRemainingPercent: 30,
    criticalRemainingPercent: 10,
    emptyRemainingPercent: 1
  };
}

describe('display formatting', () => {
  it('adds thousands separators without changing decimals', () => {
    assert.equal(addThousandsSeparators('8133.4'), '8,133.4');
    assert.equal(addThousandsSeparators('6137.0'), '6,137.0');
    assert.equal(addThousandsSeparators('14651'), '14,651');
    assert.equal(addThousandsSeparators('0.39'), '0.39');
    assert.equal(addThousandsSeparators('999'), '999');
    assert.equal(addThousandsSeparators('1000'), '1,000');
    assert.equal(addThousandsSeparators('1234567'), '1,234,567');
  });

  it('formats token counts with K/M abbreviations', () => {
    assert.equal(formatTokenCount(0), '0');
    assert.equal(formatTokenCount(5), '5');
    assert.equal(formatTokenCount(999), '999');
    assert.equal(formatTokenCount(1000), '1.0K');
    assert.equal(formatTokenCount(1500), '1.5K');
    assert.equal(formatTokenCount(999999), '1,000.0K');
    assert.equal(formatTokenCount(1000000), '1.0M');
    assert.equal(formatTokenCount(1500000), '1.5M');
    assert.equal(formatTokenCount(9999999), '10.0M');
    assert.equal(formatTokenCount(1234567), '1.2M');
    assert.equal(formatTokenCount(123456), '123.5K');
  });

  it('maps remaining quota levels to dashboard color buckets', () => {
    assert.equal(quotaLevelForRemaining(90), 'blue');
    assert.equal(quotaLevelForRemaining(70), 'green');
    assert.equal(quotaLevelForRemaining(40), 'yellow');
    assert.equal(quotaLevelForRemaining(20), 'orange');
    assert.equal(quotaLevelForRemaining(5), 'red');
    assert.equal(quotaLevelForRemaining(undefined), 'unavailable');
    assert.equal(quotaLevelForRemaining(50, true), 'unavailable');
  });

  it('applies threshold ordering to formatted status severity', () => {
    const opts = baseOptions();
    assert.equal(formatStatus(makeState(25), opts).severity, 'normal');
    assert.equal(formatStatus(makeState(60), opts).severity, 'low');
    assert.equal(formatStatus(makeState(80), opts).severity, 'warning');
    assert.equal(formatStatus(makeState(95), opts).severity, 'critical');

    const safe = normalizeThresholds(10, 50, 30, 1);
    assert.equal(formatStatus(makeState(25), { ...opts, ...safe }).severity, 'normal');
    assert.equal(formatStatus(makeState(60), { ...opts, ...safe }).severity, 'low');
    assert.equal(formatStatus(makeState(80), { ...opts, ...safe }).severity, 'warning');
    assert.equal(formatStatus(makeState(95), { ...opts, ...safe }).severity, 'critical');
  });
});
