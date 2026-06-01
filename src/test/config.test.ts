import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeThresholds, DEFAULT_LOW_REMAINING_PERCENT, DEFAULT_WARN_REMAINING_PERCENT, DEFAULT_CRITICAL_REMAINING_PERCENT, DEFAULT_EMPTY_REMAINING_PERCENT } from '../configThresholds';

describe('config thresholds', () => {
  it('valid ordering passes through unchanged', () => {
    const result = normalizeThresholds(50, 30, 10, 1);
    assert.equal(result.lowRemainingPercent, 50);
    assert.equal(result.warnRemainingPercent, 30);
    assert.equal(result.criticalRemainingPercent, 10);
    assert.equal(result.emptyRemainingPercent, 1);
  });

  it('invalid ordering falls back to defaults', () => {
    const result = normalizeThresholds(10, 30, 50, 1);
    assert.equal(result.lowRemainingPercent, DEFAULT_LOW_REMAINING_PERCENT);
    assert.equal(result.warnRemainingPercent, DEFAULT_WARN_REMAINING_PERCENT);
    assert.equal(result.criticalRemainingPercent, DEFAULT_CRITICAL_REMAINING_PERCENT);
    assert.equal(result.emptyRemainingPercent, DEFAULT_EMPTY_REMAINING_PERCENT);
  });
});
