import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayTotalTokens,
  hasTokenData,
  normalizeTokenComponents,
  sumTokens
} from '../snapshot/tokenMath';

describe('tokenMath', () => {
  it('displayTotalTokens includes input, output, cache creation, and cache read', () => {
    assert.equal(displayTotalTokens({
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 50,
      cacheReadTokens: 10
    }), 185);
  });

  it('displayTotalTokens excludes reasoningOutputTokens', () => {
    assert.equal(displayTotalTokens({
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 50,
      cacheReadTokens: 10,
      reasoningOutputTokens: 999
    }), 185);
  });

  it('normalizes local cache input aliases to canonical snapshot cache fields', () => {
    assert.deepEqual(normalizeTokenComponents({
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 10,
      reasoningOutputTokens: 9
    }), {
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 50,
      cacheReadTokens: 10,
      reasoningOutputTokens: 9
    });
  });

  it('sumTokens merges displayed components and preserves reasoning separately', () => {
    const merged = sumTokens(
      { inputTokens: 100, outputTokens: 25, cacheCreationTokens: 50, cacheReadTokens: 10, reasoningOutputTokens: 7 },
      { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 2, cacheReadInputTokens: 1, reasoningOutputTokens: 11 }
    );
    assert.equal(displayTotalTokens(merged), 196);
    assert.equal(merged.reasoningOutputTokens, 18);
  });

  it('hasTokenData recognizes reasoning-only rows without adding them to display totals', () => {
    const row = { reasoningOutputTokens: 42 };
    assert.equal(hasTokenData(row), true);
    assert.equal(displayTotalTokens(row), 0);
  });
});
