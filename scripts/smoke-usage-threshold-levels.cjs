#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function makeState(usedPercentage) {
  return {
    provider: 'claude',
    source: 'fixture quota state',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    sevenDay: { usedPercentage },
    fiveHour: { usedPercentage: 50 }
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { quotaLevelForRemaining } = require(path.join(repoRoot, 'out', 'display', 'format.js'));
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));

  const cases = [
    { remaining: 95, level: 'purple' },
    { remaining: 91, level: 'purple' },
    { remaining: 90, level: 'blue' },
    { remaining: 71, level: 'blue' },
    { remaining: 70, level: 'green' },
    { remaining: 51, level: 'green' },
    { remaining: 50, level: 'yellow' },
    { remaining: 31, level: 'yellow' },
    { remaining: 30, level: 'orange' },
    { remaining: 11, level: 'orange' },
    { remaining: 10, level: 'red' },
    { remaining: 0, level: 'red' }
  ];

  for (const testCase of cases) {
    const model = buildUsageDashboardModel({ states: [makeState(100 - testCase.remaining)] });
    const window = model.providers[0].windows.find(w => w.key === 'sevenDay');
    assert.equal(quotaLevelForRemaining(testCase.remaining), testCase.level, `${testCase.remaining}% remaining resolves expected dot level`);
    assert.equal(window.level, testCase.level, `${testCase.remaining}% remaining dashboard window reuses dot level`);
  }

  const panelScript = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.js'), 'utf8');
  assert.match(panelScript, /var levelClass = window\.level \? ' level-' \+ window\.level : '';/, 'quota window renderer derives level-* class from model level');
  assert.match(panelScript, /usage-progress-fill' \+ levelClass/, 'usage progress fill receives the resolved level class');

  // Snapshot-derived providers use the same level scale
  const { snapshotProviderToDashboardProvider } = require(path.join(repoRoot, 'out', 'snapshot', 'readMachineSnapshots.js'));
  for (const testCase of cases) {
    const dp = snapshotProviderToDashboardProvider({
      provider: 'claude',
      sourceLabel: 'Claude',
      stale: false,
      source: 'authenticated',
      sourceConfidence: 'quotaState',
      sevenDayUsedPercent: 100 - testCase.remaining,
      fiveHourUsedPercent: 0,
      fiveHourResetAtEpochSeconds: 1_800_000_000,
      sevenDayResetAtEpochSeconds: 1_900_000_000,
      lastUpdatedEpochMs: Date.now()
    }, 'fixture');
    const sevenDayWindow = dp.windows.find(w => w.key === 'sevenDay');
    assert.equal(sevenDayWindow.level, testCase.level, `snapshot provider: ${testCase.remaining}% remaining → level=${testCase.level}`);
  }

  const styles = fs.readFileSync(path.join(repoRoot, 'media', 'promptFuelPanel.css'), 'utf8');
  for (const level of cases.map(testCase => testCase.level)) {
    assert.match(styles, new RegExp(`\\.usage-progress-fill\\.level-${level}\\s*\\{`), `usage progress fill has level-${level} styling`);
  }

  assert.match(
    fs.readFileSync(path.join(repoRoot, 'src', 'display', 'format.ts'), 'utf8'),
    /function quotaIndicatorForRemaining[\s\S]*quotaLevelForRemaining\(remainingPercent, unavailable\)/,
    'dot indicator uses the shared quota level resolver'
  );

  console.log('PASS: Usage dashboard quota bar levels match quota dot levels.');
}

main();
