import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekdayActivityBreakdown } from '../panel/dashboard/weekdayActivity';
import { buildUsageHistoryRangeViews } from '../panel/usageHistoryBinning';
import type { UsageDashboardHistoryChartPoint } from '../panel/usageDashboardModel';
import type { UsageHistoryPoint } from '../panel/usageHistoryBinning';

function makeHistoryPoint(dateKey: string, totalTokens: number): UsageHistoryPoint {
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens: Math.floor(totalTokens * 0.5),
    outputTokens: Math.floor(totalTokens * 0.4),
    cacheTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    models: []
  };
}

function makePoint(dateKey: string, totalTokens: number, assistantMessages = 1): UsageDashboardHistoryChartPoint {
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens: Math.floor(totalTokens * 0.5),
    outputTokens: Math.floor(totalTokens * 0.4),
    cacheTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    assistantMessages: totalTokens > 0 ? assistantMessages : 0,
    models: []
  };
}

describe('buildWeekdayActivityBreakdown', () => {
  describe('empty/unavailable cases', () => {
    it('returns available:false for undefined input', () => {
      const result = buildWeekdayActivityBreakdown(undefined);
      assert.equal(result.available, false);
      assert.equal(result.entries.length, 7);
      assert.equal(result.grandTotalTokens, 0);
      assert.equal(result.busiestWeekday, undefined);
    });

    it('returns available:false for empty array', () => {
      const result = buildWeekdayActivityBreakdown([]);
      assert.equal(result.available, false);
      assert.equal(result.entries.length, 7);
      assert.equal(result.grandTotalTokens, 0);
    });

    it('always returns exactly 7 entries in canonical Sun..Sat order', () => {
      const result = buildWeekdayActivityBreakdown([]);
      assert.equal(result.entries.length, 7);
      for (let i = 0; i < 7; i++) {
        assert.equal(result.entries[i].weekday, i);
      }
    });

    it('returns available:false when all points have zero tokens', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-28', 0)]);
      assert.equal(result.available, false);
    });
  });

  describe('weekday assignment', () => {
    it('assigns 2026-06-28 (Sunday) to weekday 0', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-28', 100)]);
      assert.equal(result.entries[0].totalTokens, 100);  // index 0 = Sunday
    });

    it('assigns 2026-06-29 (Monday) to weekday 1', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-29', 200)]);
      assert.equal(result.entries[1].totalTokens, 200);
    });

    it('assigns 2026-07-04 (Saturday) to weekday 6', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-07-04', 300)]);
      assert.equal(result.entries[6].totalTokens, 300);
    });

    it('ignores points with invalid dateKey', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('bad-date', 500),
        makePoint('2026-06-28', 100)
      ]);
      assert.equal(result.grandTotalTokens, 100);  // only valid point counted
    });
  });

  describe('aggregation', () => {
    it('sums tokens from two days on the same weekday', () => {
      // 2026-06-28 and 2026-07-05 are both Sundays
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),
        makePoint('2026-07-05', 150)
      ]);
      assert.equal(result.entries[0].totalTokens, 250);  // Sunday total
      assert.equal(result.entries[0].activeDays, 2);
    });

    it('computes grandTotalTokens as sum across all weekdays', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),  // Sun
        makePoint('2026-06-29', 200),  // Mon
        makePoint('2026-06-30', 300)   // Tue
      ]);
      assert.equal(result.grandTotalTokens, 600);
    });

    it('percent values sum to approximately 1 (within floating-point rounding)', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),
        makePoint('2026-06-29', 200),
        makePoint('2026-06-30', 300),
        makePoint('2026-07-01', 400)
      ]);
      const total = result.entries.reduce((sum, e) => sum + e.percent, 0);
      assert.ok(Math.abs(total - 1) < 0.001, 'percents should sum to ~1');
    });

    it('identifies the busiest weekday correctly', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),  // Sun (weekday 0)
        makePoint('2026-06-29', 999),  // Mon (weekday 1) - busiest
        makePoint('2026-06-30', 200)   // Tue (weekday 2)
      ]);
      assert.equal(result.busiestWeekday, 1);
    });
  });

  describe('reset/negative delta safety', () => {
    it('clamps negative totalTokens to 0 and does not inflate any weekday', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),
        makePoint('2026-06-29', -50)   // negative delta artifact
      ]);
      assert.equal(result.grandTotalTokens, 100);
      assert.equal(result.entries[1].totalTokens, 0);  // Monday gets 0, not -50
    });

    it('does not set busiestWeekday when a negative point would be the only data', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-29', -50)
      ]);
      assert.equal(result.available, false);
      assert.equal(result.busiestWeekday, undefined);
    });
  });

  describe('labels', () => {
    it('entries have correct short labels in canonical order', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-28', 100)]);
      const labels = result.entries.map(e => e.label);
      assert.deepEqual(labels, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });

    it('entries have correct long labels', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-28', 100)]);
      const labels = result.entries.map(e => e.longLabel);
      assert.deepEqual(labels, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    });

    it('percentLabel for the only active weekday is 100%', () => {
      const result = buildWeekdayActivityBreakdown([makePoint('2026-06-28', 500)]);
      assert.equal(result.entries[0].percentLabel, '100%');
    });
  });

  describe('activeDays counting', () => {
    it('counts distinct days with activity', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),
        makePoint('2026-07-05', 0),   // same weekday but no tokens
        makePoint('2026-07-12', 200)
      ]);
      assert.equal(result.entries[0].activeDays, 2);
    });

    it('counts duplicate source rows on the same active date once', () => {
      const result = buildWeekdayActivityBreakdown([
        makePoint('2026-06-28', 100),
        makePoint('2026-06-28', 250, 2),
        makePoint('2026-07-05', 125)
      ]);
      assert.equal(result.entries[0].totalTokens, 475);
      assert.equal(result.entries[0].activeDays, 2);
    });
  });
});

describe('weekdayBreakdown range scoping via buildUsageHistoryRangeViews', () => {
  // anchor = 2026-06-28; 1M = last 30 days = 2026-05-29..2026-06-28
  // a point from 2025-12-15 is inside ALL (12M window) but outside 1M
  const anchorDateKey = '2026-06-28';

  it('1M breakdown excludes points older than 30 days', () => {
    const points = [
      makeHistoryPoint('2025-12-15', 5000),  // ~195 days ago — outside 1M, inside ALL
      makeHistoryPoint('2026-06-20', 1000),  // 8 days ago — inside 1M
    ];
    const views = buildUsageHistoryRangeViews(points, anchorDateKey);
    assert.equal(views['1M'].weekdayBreakdown?.grandTotalTokens, 1000);
  });

  it('ALL breakdown includes points within the 12M window', () => {
    const points = [
      makeHistoryPoint('2025-12-15', 5000),  // inside ALL (12M)
      makeHistoryPoint('2026-06-20', 1000),  // inside both 1M and ALL
    ];
    const views = buildUsageHistoryRangeViews(points, anchorDateKey);
    assert.equal(views['ALL'].weekdayBreakdown?.grandTotalTokens, 6000);
  });

  it('1M and ALL totals differ when older history exists', () => {
    const points = [
      makeHistoryPoint('2025-12-15', 5000),
      makeHistoryPoint('2026-06-20', 1000),
    ];
    const views = buildUsageHistoryRangeViews(points, anchorDateKey);
    const total1M = views['1M'].weekdayBreakdown?.grandTotalTokens ?? 0;
    const totalALL = views['ALL'].weekdayBreakdown?.grandTotalTokens ?? 0;
    assert.ok(totalALL > total1M, `ALL (${totalALL}) should exceed 1M (${total1M}) when older history exists`);
  });

  it('1W breakdown only covers 7 days', () => {
    const points = [
      makeHistoryPoint('2026-06-10', 2000),  // 18 days ago — outside 1W, inside 1M
      makeHistoryPoint('2026-06-25', 800),   // 3 days ago — inside 1W
    ];
    const views = buildUsageHistoryRangeViews(points, anchorDateKey);
    assert.equal(views['1W'].weekdayBreakdown?.grandTotalTokens, 800);
    assert.ok((views['1M'].weekdayBreakdown?.grandTotalTokens ?? 0) > 800, '1M includes both points');
  });

  it('weekdayBreakdown available:false when range has no data', () => {
    const points = [
      makeHistoryPoint('2025-12-15', 5000),  // only outside 1W range
    ];
    const views = buildUsageHistoryRangeViews(points, anchorDateKey);
    assert.equal(views['1W'].weekdayBreakdown?.available, false);
  });
});
