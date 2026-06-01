import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsageHistoryRangeViews,
  type UsageHistoryPoint
} from '../panel/usageHistoryBinning';

function makePoint(dateKey: string, totalTokens: number, model = 'claude-sonnet-4-20250514'): UsageHistoryPoint {
  const inputTokens = Math.floor(totalTokens * 0.5);
  const outputTokens = Math.floor(totalTokens * 0.4);
  const cacheCreationTokens = Math.floor(totalTokens * 0.06);
  const cacheReadTokens = Math.max(0, totalTokens - inputTokens - outputTokens - cacheCreationTokens);
  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens: cacheCreationTokens + cacheReadTokens,
    cacheCreationTokens,
    cacheReadTokens,
    assistantMessages: totalTokens > 0 ? 1 : 0,
    models: totalTokens > 0 ? [{
      label: 'Sonnet 4',
      model,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cacheReadInputTokens: cacheReadTokens,
      assistantMessages: 1
    }] : []
  };
}

function makeMultiModelPoint(dateKey: string, modelTotals: Array<[string, number]>): UsageHistoryPoint {
  const models = modelTotals.map(([model, tokens]) => {
    const inputTokens = Math.floor(tokens * 0.5);
    const outputTokens = Math.floor(tokens * 0.4);
    const cacheCreationInputTokens = Math.floor(tokens * 0.06);
    const cacheReadInputTokens = Math.max(0, tokens - inputTokens - outputTokens - cacheCreationInputTokens);
    return {
      label: model.replace(/^claude-/, ''),
      model,
      totalTokens: tokens,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      assistantMessages: 1
    };
  });

  return {
    dateKey,
    label: dateKey.slice(5),
    totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0),
    inputTokens: models.reduce((sum, model) => sum + model.inputTokens, 0),
    outputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
    cacheTokens: models.reduce((sum, model) => sum + model.cacheCreationInputTokens + model.cacheReadInputTokens, 0),
    cacheCreationTokens: models.reduce((sum, model) => sum + model.cacheCreationInputTokens, 0),
    cacheReadTokens: models.reduce((sum, model) => sum + model.cacheReadInputTokens, 0),
    assistantMessages: modelTotals.length,
    models
  };
}

function sumTokens(points: UsageHistoryPoint[]): number {
  return points.reduce((sum, point) => sum + point.totalTokens, 0);
}

describe('usage history binning', () => {
  it('builds bounded range views with zero-padded empty bins', () => {
    const views = buildUsageHistoryRangeViews([
      makePoint('2026-01-10', 70),
      makePoint('2026-04-30', 30),
      makePoint('2026-05-15', 50),
      makePoint('2026-05-17', 100)
    ], '2026-05-17');

    assert.equal(views['1D'].granularity, 'day');
    assert.match(views['1D'].limitation ?? '', /day-level only/);
    assert.equal(views['1D'].points.length, 1);
    assert.equal(sumTokens(views['1D'].points), 100);

    assert.equal(views['1W'].granularity, 'day');
    assert.equal(views['1W'].points.length, 7);
    assert.equal(sumTokens(views['1W'].points), 150);
    assert.ok(views['1W'].points.some(point => point.dateKey === '2026-05-16' && point.isEmpty));

    assert.equal(views['1M'].granularity, 'day');
    assert.equal(views['1M'].points.length, 30);
    assert.equal(sumTokens(views['1M'].points), 180);

    assert.equal(views['1Y'].granularity, 'week');
    assert.ok(views['1Y'].points.length <= 53);
    assert.equal(sumTokens(views['1Y'].points), 250);
    assert.equal(views['1Y'].activeUnitLabel, 'weeks');

    assert.equal(views.ALL.granularity, 'month');
    assert.equal(views.ALL.points.length, 12);
    assert.equal(sumTokens(views.ALL.points), 250);
    assert.ok(views.ALL.points.some(point => point.label === '2026-02' && point.isEmpty));
    assert.match(views.ALL.limitation ?? '', /12-month history window/);
  });

  it('preserves per-model attribution across source days', () => {
    const views = buildUsageHistoryRangeViews([
      makeMultiModelPoint('2026-05-16', [
        ['claude-sonnet-4-20250514', 700],
        ['claude-opus-4-20250514', 300]
      ]),
      makeMultiModelPoint('2026-05-17', [
        ['claude-sonnet-4-20250514', 200],
        ['claude-haiku-4-20250514', 100]
      ])
    ], '2026-05-17');

    const weekModels = views['1W'].points
      .filter(point => !point.isEmpty)
      .flatMap(point => point.models);
    const sonnetTotal = weekModels
      .filter(model => model.model === 'claude-sonnet-4-20250514')
      .reduce((sum, model) => sum + model.totalTokens, 0);

    assert.equal(sonnetTotal, 900);
    assert.ok(views['1W'].points.some(point => point.isEmpty && point.models.length === 0));
  });

  it('merges same-day local and remote source points without losing provider attribution', () => {
    const remotePoint: UsageHistoryPoint = {
      dateKey: '2026-05-17',
      label: '05-17',
      totalTokens: 7_300,
      inputTokens: 4_000,
      outputTokens: 2_500,
      cacheTokens: 800,
      cacheCreationTokens: 600,
      cacheReadTokens: 200,
      assistantMessages: 0,
      models: [],
      providerSegments: [{
        provider: 'claude',
        label: 'Claude (REMOTE)',
        totalTokens: 7_300,
        inputTokens: 4_000,
        outputTokens: 2_500,
        cacheTokens: 800,
        cacheCreationTokens: 600,
        cacheReadTokens: 200,
        assistantMessages: 0,
        sourceConfidence: 'snapshotOnly'
      }]
    };

    const views = buildUsageHistoryRangeViews([
      makePoint('2026-05-15', 50),
      makePoint('2026-05-17', 100),
      remotePoint
    ], '2026-05-17');
    const may17Bin = views['1W'].points.find(point => point.dateKey === '2026-05-17');

    assert.ok(may17Bin);
    assert.equal(may17Bin.totalTokens, 7_400);
    assert.equal(may17Bin.sourcePointCount, 2);
    assert.equal(may17Bin.providerSegments?.[0]?.sourceConfidence, 'snapshotOnly');
  });
});
