#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const webviewScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  const instrumentedScript = webviewScript.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__modelDistributionTest = { aggregateModelDistribution: aggregateModelDistribution, aggregateCombinedModelDistribution: aggregateCombinedModelDistribution }; })();'
  );
  const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      body: { appendChild: () => undefined },
      documentElement: { clientWidth: 320, clientHeight: 240 },
      createElement: () => ({ style: {}, setAttribute: () => undefined, appendChild: () => undefined }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: {
      innerWidth: 320,
      innerHeight: 240,
      addEventListener: () => undefined
    },
    setTimeout: () => undefined
  };
  vm.runInNewContext(instrumentedScript, sandbox);

  const { aggregateModelDistribution, aggregateCombinedModelDistribution } = sandbox.__modelDistributionTest;

  // Mirrors the observed live-UI regression: the Codex provider tab collapsed
  // gpt-5.4-mini (25.8M) and gpt-5.6-luna (8.6M) into "Other: 34.4M" while the
  // Overview tab showed all seven Codex models separately with the same 1,814.6M total.
  const codexPoints = [{
    dateKey: '2026-06-04',
    models: [
      { model: 'gpt-5-codex', provider: 'codex', providerLabel: 'Codex', totalTokens: 900_000_000, inputTokens: 900_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 10 },
      { model: 'gpt-5-codex-mini', provider: 'codex', providerLabel: 'Codex', totalTokens: 500_000_000, inputTokens: 500_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 9 },
      { model: 'gpt-5.2-codex', provider: 'codex', providerLabel: 'Codex', totalTokens: 200_000_000, inputTokens: 200_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 8 },
      { model: 'gpt-5.3-codex', provider: 'codex', providerLabel: 'Codex', totalTokens: 150_000_000, inputTokens: 150_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 7 },
      { model: 'gpt-5.1-codex', provider: 'codex', providerLabel: 'Codex', totalTokens: 30_200_000, inputTokens: 30_200_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 6 },
      { model: 'gpt-5.4-mini', provider: 'codex', providerLabel: 'Codex', totalTokens: 25_800_000, inputTokens: 25_800_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 5 },
      { model: 'gpt-5.6-luna', provider: 'codex', providerLabel: 'Codex', totalTokens: 8_600_000, inputTokens: 8_600_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, assistantMessages: 4 }
    ]
  }];

  const providerTabResult = aggregateModelDistribution(codexPoints);
  const overviewResult = aggregateCombinedModelDistribution(codexPoints);

  assert.equal(providerTabResult.length, 7, 'Codex provider tab must show all 7 models separately, not 5 + Other');
  assert.ok(
    providerTabResult.every(entry => entry.model !== 'Other'),
    'provider tab must not synthesize an "Other" bucket'
  );

  const mini = providerTabResult.find(entry => entry.model === 'gpt-5.4-mini');
  const luna = providerTabResult.find(entry => entry.model === 'gpt-5.6-luna');
  assert.ok(mini, 'gpt-5.4-mini must appear as its own entry on the provider tab');
  assert.ok(luna, 'gpt-5.6-luna must appear as its own entry on the provider tab');
  assert.equal(mini.totalTokens, 25_800_000, 'gpt-5.4-mini keeps its own token total');
  assert.equal(luna.totalTokens, 8_600_000, 'gpt-5.6-luna keeps its own token total');

  const providerTotal = providerTabResult.reduce((sum, entry) => sum + entry.totalTokens, 0);
  assert.equal(providerTotal, 1_814_600_000, 'provider tab grand total is unchanged (1,814.6M)');

  // Overview and the provider tab must now derive matching per-model values for the same
  // provider, since both route through the same canonical aggregation.
  assert.deepEqual(
    providerTabResult.map(entry => ({ model: entry.model, totalTokens: entry.totalTokens })),
    overviewResult.map(entry => ({ model: entry.model, totalTokens: entry.totalTokens })),
    'Overview and provider tab must derive matching per-model values for the same provider'
  );

  console.log('smoke-model-distribution-no-other: OK (7 Codex models preserved, no Other bucket, Overview matches provider tab)');
}

main();
