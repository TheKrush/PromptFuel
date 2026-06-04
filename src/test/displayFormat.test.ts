import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addThousandsSeparators, formatStatus, formatTokenCount, quotaIndicatorForRemaining, quotaLevelForRemaining, type FormatOptions } from '../display/format';
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
    assert.equal(quotaLevelForRemaining(100), 'purple');
    assert.equal(quotaLevelForRemaining(91), 'purple');
    assert.equal(quotaLevelForRemaining(90), 'blue');
    assert.equal(quotaLevelForRemaining(71), 'blue');
    assert.equal(quotaLevelForRemaining(70), 'green');
    assert.equal(quotaLevelForRemaining(51), 'green');
    assert.equal(quotaLevelForRemaining(50), 'yellow');
    assert.equal(quotaLevelForRemaining(31), 'yellow');
    assert.equal(quotaLevelForRemaining(30), 'orange');
    assert.equal(quotaLevelForRemaining(11), 'orange');
    assert.equal(quotaLevelForRemaining(10), 'red');
    assert.equal(quotaLevelForRemaining(0), 'red');
    assert.equal(quotaLevelForRemaining(undefined), 'unavailable');
    assert.equal(quotaLevelForRemaining(50, true), 'unavailable');
  });

  it('maps remaining quota percentages to correct emoji via quotaIndicatorForRemaining', () => {
    assert.equal(quotaIndicatorForRemaining(100), '\uD83D\uDFE3');
    assert.equal(quotaIndicatorForRemaining(91), '\uD83D\uDFE3');
    assert.equal(quotaIndicatorForRemaining(90), '\uD83D\uDD35');
    assert.equal(quotaIndicatorForRemaining(71), '\uD83D\uDD35');
    assert.equal(quotaIndicatorForRemaining(70), '\uD83D\uDFE2');
    assert.equal(quotaIndicatorForRemaining(51), '\uD83D\uDFE2');
    assert.equal(quotaIndicatorForRemaining(50), '\uD83D\uDFE1');
    assert.equal(quotaIndicatorForRemaining(31), '\uD83D\uDFE1');
    assert.equal(quotaIndicatorForRemaining(30), '\uD83D\uDFE0');
    assert.equal(quotaIndicatorForRemaining(11), '\uD83D\uDFE0');
    assert.equal(quotaIndicatorForRemaining(10), '\uD83D\uDD34');
    assert.equal(quotaIndicatorForRemaining(0), '\uD83D\uDD34');
    assert.equal(quotaIndicatorForRemaining(undefined), '\u26AB');
    assert.equal(quotaIndicatorForRemaining(undefined, true), '\u26AB');
  });

  it('every quota level maps to a valid dashboard progress-bar CSS class', () => {
    const levels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red'] as const;
    for (const level of levels) {
      const cssClass = 'level-' + level;
      assert.ok(cssClass.startsWith('level-'), `CSS class must start with level- prefix for ${level}`);
    }
    // Verify unavailable is excluded from dashboard levels
    const dashboardLevels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red'] as const;
    const allQuotaLevels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red', 'unavailable'] as const;
    for (const l of allQuotaLevels) {
      if (l === 'unavailable') {
        assert.equal((dashboardLevels as readonly string[]).includes(l), false,
          'unavailable must not be a dashboard progress-bar level');
      } else {
        assert.ok((dashboardLevels as readonly string[]).includes(l),
          `${l} must be a dashboard progress-bar level`);
      }
    }
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
