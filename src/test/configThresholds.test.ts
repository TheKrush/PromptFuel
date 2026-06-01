import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThresholds,
  DEFAULT_LOW_REMAINING_PERCENT,
  DEFAULT_WARN_REMAINING_PERCENT,
  DEFAULT_CRITICAL_REMAINING_PERCENT,
  DEFAULT_EMPTY_REMAINING_PERCENT
} from '../configThresholds';

describe('configThresholds', () => {
  describe('normalizeThresholds', () => {
    it('returns valid thresholds unchanged', () => {
      const result = normalizeThresholds(50, 30, 10, 1);
      assert.equal(result.lowRemainingPercent, 50);
      assert.equal(result.warnRemainingPercent, 30);
      assert.equal(result.criticalRemainingPercent, 10);
      assert.equal(result.emptyRemainingPercent, 1);
    });

    it('returns defaults when low < warn', () => {
      const result = normalizeThresholds(10, 30, 10, 1);
      assert.equal(result.lowRemainingPercent, DEFAULT_LOW_REMAINING_PERCENT);
      assert.equal(result.warnRemainingPercent, DEFAULT_WARN_REMAINING_PERCENT);
      assert.equal(result.criticalRemainingPercent, DEFAULT_CRITICAL_REMAINING_PERCENT);
      assert.equal(result.emptyRemainingPercent, DEFAULT_EMPTY_REMAINING_PERCENT);
    });

    it('returns defaults when warn < critical', () => {
      const result = normalizeThresholds(50, 10, 30, 1);
      assert.equal(result.lowRemainingPercent, DEFAULT_LOW_REMAINING_PERCENT);
      assert.equal(result.warnRemainingPercent, DEFAULT_WARN_REMAINING_PERCENT);
      assert.equal(result.criticalRemainingPercent, DEFAULT_CRITICAL_REMAINING_PERCENT);
      assert.equal(result.emptyRemainingPercent, DEFAULT_EMPTY_REMAINING_PERCENT);
    });

    it('returns defaults when critical < empty', () => {
      const result = normalizeThresholds(50, 30, 1, 10);
      assert.equal(result.lowRemainingPercent, DEFAULT_LOW_REMAINING_PERCENT);
      assert.equal(result.warnRemainingPercent, DEFAULT_WARN_REMAINING_PERCENT);
      assert.equal(result.criticalRemainingPercent, DEFAULT_CRITICAL_REMAINING_PERCENT);
      assert.equal(result.emptyRemainingPercent, DEFAULT_EMPTY_REMAINING_PERCENT);
    });

    it('allows equal values at descending boundary', () => {
      const result = normalizeThresholds(50, 50, 10, 1);
      assert.equal(result.lowRemainingPercent, 50);
      assert.equal(result.warnRemainingPercent, 50);
      assert.equal(result.criticalRemainingPercent, 10);
      assert.equal(result.emptyRemainingPercent, 1);
    });

    it('allows all equal values', () => {
      const result = normalizeThresholds(10, 10, 10, 10);
      assert.equal(result.lowRemainingPercent, 10);
      assert.equal(result.warnRemainingPercent, 10);
      assert.equal(result.criticalRemainingPercent, 10);
      assert.equal(result.emptyRemainingPercent, 10);
    });
  });
});
