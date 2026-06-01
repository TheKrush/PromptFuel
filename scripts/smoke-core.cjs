'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const OUT = path.resolve(__dirname, '../out');
const REPO = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    fail++;
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');

// --- providers ---
const { KNOWN_PROVIDERS, PROVIDER_LABELS, isKnownProvider } = require(path.join(OUT, 'core/providers'));

test('KNOWN_PROVIDERS includes claude', () => {
  assert.ok(KNOWN_PROVIDERS.includes('claude'), 'expected claude in KNOWN_PROVIDERS');
});

test('KNOWN_PROVIDERS includes codex', () => {
  assert.ok(KNOWN_PROVIDERS.includes('codex'), 'expected codex in KNOWN_PROVIDERS');
});

test('isKnownProvider accepts claude', () => {
  assert.strictEqual(isKnownProvider('claude'), true);
});

test('isKnownProvider accepts codex', () => {
  assert.strictEqual(isKnownProvider('codex'), true);
});

test('isKnownProvider rejects unknown string', () => {
  assert.strictEqual(isKnownProvider('openai'), false);
});

test('isKnownProvider rejects empty string', () => {
  assert.strictEqual(isKnownProvider(''), false);
});

test('PROVIDER_LABELS.claude is Claude', () => {
  assert.strictEqual(PROVIDER_LABELS.claude, 'Claude');
});

test('PROVIDER_LABELS.codex is Codex', () => {
  assert.strictEqual(PROVIDER_LABELS.codex, 'Codex');
});

// --- quotaTypes ---
const { QUOTA_WINDOWS, QUOTA_WINDOW_LABELS } = require(path.join(OUT, 'core/quotaTypes'));

test('QUOTA_WINDOWS includes 5h', () => {
  assert.ok(QUOTA_WINDOWS.includes('5h'), 'expected 5h in QUOTA_WINDOWS');
});

test('QUOTA_WINDOWS includes 7d', () => {
  assert.ok(QUOTA_WINDOWS.includes('7d'), 'expected 7d in QUOTA_WINDOWS');
});

test('QUOTA_WINDOW_LABELS 5h label', () => {
  assert.strictEqual(QUOTA_WINDOW_LABELS['5h'], '5h');
});

test('QUOTA_WINDOW_LABELS 7d label', () => {
  assert.strictEqual(QUOTA_WINDOW_LABELS['7d'], '7d');
});

// --- configDefaults ---
const { CONFIG_DEFAULTS } = require(path.join(OUT, 'core/configDefaults'));

test('CONFIG_DEFAULTS.enabledProviders default', () => {
  assert.deepStrictEqual(CONFIG_DEFAULTS.enabledProviders, ['claude', 'codex']);
});

test('CONFIG_DEFAULTS.refreshIntervalMinutes default', () => {
  assert.strictEqual(CONFIG_DEFAULTS.refreshIntervalMinutes, 5);
});

test('CONFIG_DEFAULTS.refreshIntervalMinutes is number', () => {
  assert.strictEqual(typeof CONFIG_DEFAULTS.refreshIntervalMinutes, 'number');
});

test('CONFIG_DEFAULTS.liveQuotaEnabled default is true', () => {
  assert.strictEqual(CONFIG_DEFAULTS.liveQuotaEnabled, true);
});

test('CONFIG_DEFAULTS snapshot paths default to empty strings', () => {
  assert.strictEqual(CONFIG_DEFAULTS.snapshotImportPath, '');
  assert.strictEqual(CONFIG_DEFAULTS.snapshotExportPath, '');
});

// === Config: interface shape ===

test('CONFIG_DEFAULTS has expected keys', () => {
  const keys = Object.keys(CONFIG_DEFAULTS).sort();
  assert.deepStrictEqual(keys, ['dashboardUsageSource', 'enabledProviders', 'liveQuotaEnabled', 'localMachineLabel', 'refreshIntervalMinutes', 'snapshotExportPath', 'snapshotImportPath', 'snapshotImportLabels'].sort());
  assert.strictEqual(CONFIG_DEFAULTS.dashboardUsageSource, 'combined');
});

// --- manifest and docs ---

test('package.json contributes snapshot imports folder command', () => {
  const commands = packageJson.contributes.commands;
  assert.ok(commands.some(cmd =>
    cmd.command === 'promptFuel.openSnapshotImportsFolder'
    && cmd.title === 'PromptFuel: Open Snapshot Imports Folder',
  ));
  assert.ok(commands.some(cmd =>
    cmd.command === 'promptFuel.exportUsageSnapshot'
    && cmd.title === 'PromptFuel: Export Usage Snapshot',
  ));
});

test('package.json does not contribute promptFuel.displayMode', () => {
  const properties = packageJson.contributes.configuration.properties;
  assert.ok(!Object.hasOwn(properties, 'promptFuel.displayMode'), 'displayMode setting should be removed');
});

test('README documents snapshot import command and dashboard source modes', () => {
  assert.ok(readme.includes('PromptFuel: Open Snapshot Imports Folder'), 'expected snapshot import command in README');
  assert.ok(readme.includes('Local only'), 'expected Local only source mode in README');
  assert.ok(readme.includes('Snapshots only'), 'expected Snapshots only source mode in README');
  assert.ok(readme.includes('Combined'), 'expected Combined source mode in README');
  assert.ok(readme.includes('compatible aggregate snapshot'), 'expected compatible snapshot import docs in README');
  assert.ok(readme.includes('promptFuel.snapshotImportPath'), 'expected snapshot import path setting in README');
  assert.ok(readme.includes('promptFuel.snapshotExportPath'), 'expected snapshot export path setting in README');
  assert.ok(/live quota remains separate/i.test(readme), 'expected live quota separation in README');
});

test('product command text does not include private/internal labels', () => {
  const commandText = packageJson.contributes.commands.map(cmd => `${cmd.command} ${cmd.title}`).join('\n');
  for (const forbidden of ['AgentBridge', 'PHOENIX', 'WATCHER', 'CEREBRO', 'X-23', 'D:\\', 'keith']) {
    assert.ok(!commandText.includes(forbidden), `commands should not include ${forbidden}`);
  }
});

test('README documents safe source labels without local paths or private labels', () => {
  assert.ok(readme.includes('safe source labels'), 'expected safe source label behavior in README');
  assert.ok(readme.includes('unsafe labels are replaced'), 'expected unsafe label fallback in README');
  for (const forbidden of ['CEREBRO', 'X-23', 'D:\\', 'keith']) {
    assert.ok(!readme.includes(forbidden), `README should not include ${forbidden}`);
  }
});

// --- formatQuota ---
const { formatStatusBarText, formatRefreshSummary, formatTokenCount } = require(path.join(OUT, 'core/formatQuota'));
const { formatTooltip } = require(path.join(OUT, 'core/statusTooltip'));
const { createInitialStatus, applyRefreshResults, applySnapshotReadResults } = require(path.join(OUT, 'core/statusModel'));

// === Status bar text: all no-data ===

test('formatStatusBarText: explicit opt-out returns live quota disabled', () => {
  const status = createInitialStatus([], false);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota disabled');
});

test('formatStatusBarText: default no-data returns live quota loading', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
});

// === Status bar text: loaded states ===

test('formatStatusBarText: loaded state includes PromptFuel prefix', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.startsWith('PromptFuel:'), `expected "PromptFuel:" prefix in "${t}"`);
});

test('formatStatusBarText: local history does not mask loading live quota', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
  assert.ok(!t.includes('5.0K'), `local totals should not mask live state "${t}"`);
});

test('formatStatusBarText: local read error does not mask loading live quota', () => {
  const status = applyRefreshResults(
    createInitialStatus(['codex']),
    [{ providerId: 'codex', status: 'error' }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
});

test('formatStatusBarText: explicit opt-out does not show local history as primary', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex'], false),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'not-found' },
    ],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota disabled');
  assert.ok(!t.includes('5.0K'), `local totals should not be primary when opted out "${t}"`);
});

// === Status bar text: both loaded ===

test('formatStatusBarText: local history does not mask default live quota', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3100, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
  assert.ok(!t.includes('15.5K'), `local totals should not mask live state "${t}"`);
});

// === Status bar text: large token formatting ===

test('formatStatusBarText: large local token counts stay secondary', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 2500000, totalAssistantMessages: 10, filesFound: 5 }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
});

test('formatStatusBarText: billion local token counts stay secondary', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 6700000000, totalAssistantMessages: 10, filesFound: 5 }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
});

test('formatStatusBarText: small local token counts stay secondary', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
});

// === Disabled provider omitted ===

test('formatStatusBarText: disabled provider omitted from bar', () => {
  const status = createInitialStatus(['claude']);
  status.providerStates[0].status = 'disabled';
  const t = formatStatusBarText(status);
  assert.ok(!t.includes('Claude'), `disabled provider should be omitted from "${t}"`);
});

// === Tooltip: parse errors summarized safely ===

test('formatTooltip: loaded state with parse errors shows count', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1, parseErrors: 3 }],
  );
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Skipped local-history lines: 3'), `expected skipped-line count in tooltip`);
});

test('formatTooltip: no parse errors when clean', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const tooltip = formatTooltip(status);
  assert.ok(!tooltip.includes('Skipped local-history lines'), `should not show skipped-line count when 0`);
});

test('formatTooltip: usage history totals are omitted', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const tooltip = formatTooltip(status);
  assert.ok(!tooltip.includes('## Usage history'), `usage history section should be omitted`);
  assert.ok(!tooltip.includes('Total:'), `usage history totals should be omitted`);
  assert.ok(!tooltip.includes('15.0K'), `token totals should be omitted`);
  assert.ok(!tooltip.includes('5 messages'), `message totals should be omitted`);
});

// === Tooltip: local history disclaimers ===

test('formatTooltip: default does not lead with local history only', () => {
  const status = createInitialStatus(['claude']);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('State: LOADING'), `expected LOADING state in tooltip`);
  assert.ok(tooltip.includes('Live quota loading'), `expected "Live quota loading" in tooltip`);
  assert.ok(!tooltip.includes('Local history only'), `should not lead with local history only`);
});

test('formatTooltip: no enabled providers shows no live quota data', () => {
  const status = createInitialStatus([]);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('State: NO DATA'), `expected NO DATA state in tooltip`);
  assert.ok(tooltip.includes('No live quota data.'), `expected calm no-data state in tooltip`);
});

test('formatTooltip: explicit opt-out shows Live quota disabled', () => {
  const status = createInitialStatus(['claude'], false);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Live quota disabled'), `expected "Live quota disabled" in tooltip`);
});

test('formatTooltip: reports snapshot state before first snapshot read', () => {
  const status = createInitialStatus(['claude']);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Snapshots: not checked'), `expected not-checked snapshot state in tooltip`);
});

test('formatTooltip: reports no imported snapshots after snapshot read', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([], 0));
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Snapshots: none'), `expected empty snapshot state in tooltip`);
});

test('formatTooltip: reports imported aggregate snapshot state', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
  }]));
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Snapshots: available'), `expected imported snapshot state in tooltip`);
});

test('formatTooltip: reports safe imported snapshot source labels compactly', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude', 'codex']), snapshotStateFixture([
    {
      providerId: 'claude',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(500, 5),
      sourceLabel: 'PHOENIX',
    },
    {
      providerId: 'codex',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(400, 4),
      sourceLabel: 'WATCHER',
    },
  ]));
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Snapshots: PHOENIX, WATCHER'), `expected safe snapshot source labels in tooltip`);
});

test('formatTooltip: model breakdown appears below quota/details without API estimates', () => {
  const local = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 2,
      filesFound: 1,
      modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
    }],
  );
  const status = applySnapshotReadResults(local, snapshotStateFixture([{
    providerId: 'codex',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 1),
    modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 500, totalAssistantMessages: 1 }],
  }]));
  const tooltip = formatTooltip(status);

  assert.ok(tooltip.includes('## Quota'), `expected quota to remain first-class`);
  assert.ok(tooltip.includes('## Details'), `expected details section`);
  assert.ok(tooltip.includes('## Models'), `expected model section`);
  assert.ok(tooltip.indexOf('## Models') > tooltip.indexOf('## Details'), `models should render below details`);
  assert.ok(tooltip.includes('| Provider | Model | Tokens | Msgs/Turns |'), `expected compact model table`);
  assert.ok(tooltip.includes('claude-sonnet-4-20250514'), `expected local model row`);
  assert.ok(tooltip.includes('gpt-5.4-codex'), `expected snapshot model row`);
  assert.ok(!tooltip.includes('API est.'), `API estimates should be skipped`);
});

// === Tooltip: local usage details omitted ===

test('formatTooltip: provider token splits omitted', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Claude'), `expected "Claude" quota row in tooltip`);
  assert.ok(tooltip.includes('Codex'), `expected "Codex" quota row in tooltip`);
  assert.ok(!tooltip.includes('10.0K'), `should omit "10.0K" local usage from tooltip`);
  assert.ok(!tooltip.includes('5.0K'), `should omit "5.0K" local usage from tooltip`);
});

// === formatTokenCount ===

test('formatTokenCount: M suffix for >= 1M', () => {
  assert.strictEqual(formatTokenCount(2_500_000), '2.5M tokens');
});

test('formatTokenCount: K suffix for >= 1K', () => {
  assert.strictEqual(formatTokenCount(12_400), '12.4K tokens');
});

test('formatTokenCount: raw number for < 1K', () => {
  assert.strictEqual(formatTokenCount(500), '500 tokens');
});

// === formatRefreshSummary ===

test('formatRefreshSummary: ok includes messages and tokens, no file paths', () => {
  const s = formatRefreshSummary([{
    providerId: 'claude',
    status: 'ok',
    filesFound: 3,
    totalAssistantMessages: 5,
    totalTokens: 15000,
  }]);
  assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
  assert.ok(s.includes('5'), `expected message count "5" in "${s}"`);
  assert.ok(s.includes('K tokens'), `expected "K tokens" in "${s}"`);
  assert.ok(!s.includes('.jsonl'), `should not include file extensions in "${s}"`);
  assert.ok(!s.includes('\\'), `should not include backslashes in "${s}"`);
  assert.ok(!s.includes('/'), `should not include slashes in "${s}"`);
});

test('formatRefreshSummary: no-data shows no local usage history', () => {
  const s = formatRefreshSummary([{ providerId: 'codex', status: 'no-data' }]);
  assert.ok(s.includes('no local usage history'), `expected "no local usage history" in "${s}"`);
});

test('formatRefreshSummary: parse errors shown in summary', () => {
  const s = formatRefreshSummary([{
    providerId: 'claude',
    status: 'ok',
    totalAssistantMessages: 1,
    totalTokens: 500,
    parseErrors: 3,
  }]);
  assert.ok(s.includes('Parse errors: 3 lines skipped'), `expected parse error skipped wording in "${s}"`);
});

test('formatRefreshSummary: single parse error uses singular', () => {
  const s = formatRefreshSummary([{
    providerId: 'claude',
    status: 'ok',
    totalAssistantMessages: 1,
    totalTokens: 200,
    parseErrors: 1,
  }]);
  assert.ok(s.includes('Parse errors: 1 line skipped'), `expected singular parse error skipped wording in "${s}"`);
  assert.ok(!s.includes('1 lines skipped'), `expected singular "line" in "${s}"`);
});

// === Live quota: quotaWindow ===

const {
  QUOTA_WINDOW_DURATIONS_MS,
  getWindowDurationMs,
  computeWindowResetEpochMs,
  isWindowNearReset,
} = require(path.join(OUT, 'core/quotaWindow'));

test('QUOTA_WINDOW_DURATIONS_MS: 5h is 5 hours', () => {
  assert.strictEqual(QUOTA_WINDOW_DURATIONS_MS['5h'], 5 * 60 * 60 * 1000);
});

test('QUOTA_WINDOW_DURATIONS_MS: 7d is 7 days', () => {
  assert.strictEqual(QUOTA_WINDOW_DURATIONS_MS['7d'], 7 * 24 * 60 * 60 * 1000);
});

test('getWindowDurationMs: returns correct duration for 5h', () => {
  assert.strictEqual(getWindowDurationMs('5h'), 5 * 60 * 60 * 1000);
});

test('getWindowDurationMs: returns correct duration for 7d', () => {
  assert.strictEqual(getWindowDurationMs('7d'), 7 * 24 * 60 * 60 * 1000);
});

test('computeWindowResetEpochMs: returns future timestamp', () => {
  const now = Date.now();
  const reset = computeWindowResetEpochMs('5h', now);
  assert.ok(reset > now, 'reset should be in the future');
});

test('computeWindowResetEpochMs: divides evenly by window duration', () => {
  const now = Date.now();
  const reset = computeWindowResetEpochMs('5h', now);
  assert.strictEqual(reset % QUOTA_WINDOW_DURATIONS_MS['5h'], 0, 'reset should divide evenly');
});

test('isWindowNearReset: true when within threshold', () => {
  const reset = Date.now() + 100000;
  assert.strictEqual(isWindowNearReset('5h', reset, Date.now(), 5 * 60 * 1000), true);
});

test('isWindowNearReset: false when far from reset', () => {
  const reset = Date.now() + 10 * 60 * 60 * 1000;
  assert.strictEqual(isWindowNearReset('5h', reset, Date.now(), 5 * 60 * 1000), false);
});

// === Live quota: liveQuotaReader stub ===

const { createStubReader } = require(path.join(OUT, 'providers/liveQuotaReader'));

test('createStubReader: returns reader with correct providerId', () => {
  const reader = createStubReader('claude');
  assert.strictEqual(reader.providerId, 'claude');
});

test('createStubReader: read returns unavailable freshness', async () => {
  const reader = createStubReader('codex');
  const result = await reader.read();
  assert.strictEqual(result.providerId, 'codex');
  assert.strictEqual(result.freshness, 'unavailable');
  assert.strictEqual(result.windows.length, 0);
});

// === Live quota: statusModel integration ===

const {
  applyLiveQuotaResults,
  getLiveQuotaState,
} = require(path.join(OUT, 'core/statusModel'));
const {
  validatePromptFuelSnapshotPayload,
} = require(path.join(OUT, 'snapshots/snapshotReader'));

const syntheticLiveQuota = {
  providerId: 'claude',
  windows: [
    {
      windowId: '5h',
      usedPercentage: 45,
      remainingPercentage: 55,
      resetsAtEpochMs: Date.now() + 5 * 60 * 60 * 1000,
      sourceKind: 'localSession',
      sourceUpdatedEpochMs: Date.now(),
      sourceAuthorityRank: 200,
    },
    {
      windowId: '7d',
      usedPercentage: 62,
      remainingPercentage: 38,
      resetsAtEpochMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
      sourceKind: 'localSession',
      sourceUpdatedEpochMs: Date.now(),
      sourceAuthorityRank: 200,
    },
  ],
  freshness: 'live',
  lastUpdatedEpochMs: Date.now(),
};

test('applyLiveQuotaResults: applies synthetic live quota to status', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  assert.strictEqual(updated.liveQuotaStates.length, 1);
  assert.strictEqual(updated.liveQuotaStates[0].providerId, 'claude');
  assert.strictEqual(updated.liveQuotaStates[0].freshness, 'live');
  assert.strictEqual(updated.liveQuotaStates[0].windows.length, 2);
});

test('applyLiveQuotaResults: filters unknown providerId', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    { ...syntheticLiveQuota, providerId: 'openai' },
  ]);
  assert.strictEqual(updated.liveQuotaStates.length, 0);
});

test('getLiveQuotaState: returns state for matching provider', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const state = getLiveQuotaState(updated, 'claude');
  assert.ok(state !== undefined, 'expected live quota state for claude');
  assert.strictEqual(state.freshness, 'live');
});

test('getLiveQuotaState: returns undefined for missing provider', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const state = getLiveQuotaState(updated, 'codex');
  assert.strictEqual(state, undefined);
});

test('live quota window: 5h has correct shape', () => {
  const w5h = syntheticLiveQuota.windows.find(w => w.windowId === '5h');
  assert.ok(w5h !== undefined, 'expected 5h window');
  assert.ok(typeof w5h.usedPercentage === 'number', 'expected usedPercentage');
  assert.ok(typeof w5h.remainingPercentage === 'number', 'expected remainingPercentage');
  assert.ok(typeof w5h.resetsAtEpochMs === 'number', 'expected resetsAtEpochMs');
  assert.ok(typeof w5h.sourceAuthorityRank === 'number', 'expected sourceAuthorityRank');
});

test('live quota window: 7d has correct shape', () => {
  const w7d = syntheticLiveQuota.windows.find(w => w.windowId === '7d');
  assert.ok(w7d !== undefined, 'expected 7d window');
  assert.ok(typeof w7d.usedPercentage === 'number', 'expected usedPercentage');
  assert.ok(typeof w7d.remainingPercentage === 'number', 'expected remainingPercentage');
});

// === Compiled artifacts ===

test('compiled refreshScheduler.js exists', () => {
  const schedulerPath = path.join(OUT, 'core/refreshScheduler.js');
  assert.ok(fs.existsSync(schedulerPath), `expected ${schedulerPath} to exist`);
});

test('compiled extension.js exists', () => {
  const extPath = path.join(OUT, 'extension.js');
  assert.ok(fs.existsSync(extPath), `expected ${extPath} to exist`);
});

// === Scheduler: overlap prevention (pure status model) ===

test('applyRefreshResults: sets lastRefreshedMs on each refresh', () => {
  const status = createInitialStatus(['claude']);
  const before = Date.now() - 1000;
  const updated = applyRefreshResults(status, [
    { providerId: 'claude', status: 'ok', totalTokens: 100, totalAssistantMessages: 1, filesFound: 1 },
  ]);
  assert.ok(updated.lastRefreshedMs >= before, 'lastRefreshedMs should be recent');
  assert.ok(updated.localHistoryLastRefreshedMs >= before, 'localHistoryLastRefreshedMs should be recent');
});

test('applyRefreshResults: second refresh updates lastRefreshedMs', () => {
  let status = createInitialStatus(['claude']);
  status = applyRefreshResults(status, [
    { providerId: 'claude', status: 'ok', totalTokens: 100, totalAssistantMessages: 1, filesFound: 1 },
  ]);
  const firstRefresh = status.lastRefreshedMs;
  const updated = applyRefreshResults(status, [
    { providerId: 'claude', status: 'ok', totalTokens: 200, totalAssistantMessages: 2, filesFound: 1 },
  ]);
  assert.ok(updated.lastRefreshedMs >= firstRefresh, 'second refresh should update timestamp');
  assert.ok(updated.localHistoryLastRefreshedMs >= firstRefresh, 'second refresh should update local timestamp');
});

test('applyRefreshResults: preserves enabledProviderIds', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyRefreshResults(status, [
    { providerId: 'claude', status: 'ok', totalTokens: 100, totalAssistantMessages: 1, filesFound: 1 },
    { providerId: 'codex', status: 'not-found' },
  ]);
  assert.deepStrictEqual(updated.enabledProviderIds, ['claude', 'codex']);
});

// === Safety: no paths in formatted output ===

test('formatStatusBarText: no file paths in output', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3000, totalAssistantMessages: 1, filesFound: 2 },
    ],
  );
  const text = formatStatusBarText(status);
  assert.ok(!text.includes('.jsonl'), `should not include file extensions in "${text}"`);
  assert.ok(!text.includes('/'), `should not include forward slashes in "${text}"`);
  assert.ok(!text.includes('\\'), `should not include backslashes in "${text}"`);
  assert.ok(!text.includes('projects'), `should not include path segments in "${text}"`);
  assert.ok(!text.includes('sessions'), `should not include path segments in "${text}"`);
});

test('formatTooltip: no file paths in output', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 3 }],
  );
  const tooltip = formatTooltip(status);
  assert.ok(!tooltip.includes('.jsonl'), `should not include file extensions in tooltip`);
  assert.ok(!tooltip.includes('projects'), `should not include path segments in tooltip`);
  assert.ok(!tooltip.includes('sessions'), `should not include path segments in tooltip`);
});

// === Dashboard model ===

const {
  buildDashboardModel,
  hasDashboardProviderUsageData,
} = require(path.join(OUT, 'panel/dashboardModel'));
const {
  createEmptyLocalHistoryWindowAggregateMap,
  mergeTokenUsageIntoLocalHistoryWindows,
  parseTimestampEpochMs,
} = require(path.join(OUT, 'core/usageAggregate'));

function aggregateFixture(tokens, messages) {
  return {
    totalInputTokens: tokens,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalTokens: tokens,
    totalAssistantMessages: messages,
  };
}

function localHistoryWindowsFixture({ today, last5h, last7d, all }) {
  return {
    today: aggregateFixture(today.tokens, today.messages),
    last5h: aggregateFixture(last5h.tokens, last5h.messages),
    last7d: aggregateFixture(last7d.tokens, last7d.messages),
    all: aggregateFixture(all.tokens, all.messages),
  };
}

function sourceTotals(model, sourceMode) {
  const totals = model.sourceModeTotals.find(t => t.sourceMode === sourceMode);
  assert.ok(totals, `expected ${sourceMode} source totals`);
  return totals;
}

function providerSourceTotals(model, sourceMode, providerId) {
  const totals = sourceTotals(model, sourceMode);
  const provider = totals.providers.find(p => p.providerId === providerId);
  assert.ok(provider, `expected ${providerId} provider totals for ${sourceMode}`);
  return provider;
}

function snapshotStateFixture(providers, snapshotCount = 1) {
  return {
    providers,
    snapshotCount,
    lastReadEpochMs: new Date('2026-05-31T20:00:00.000Z').getTime(),
  };
}

function snapshotQuotaProvider(overrides = {}) {
  return {
    providerId: overrides.providerId ?? 'codex',
    generatedAtEpochMs: overrides.generatedAtEpochMs ?? Date.now(),
    aggregate: aggregateFixture(100, 1),
    ...overrides,
  };
}

function dashboardTabPanel(html, tabId) {
  const marker = `data-dashboard-tab-panel="${tabId}"`;
  const markerIndex = html.indexOf(marker);
  assert.ok(markerIndex >= 0, `expected ${tabId} tab panel`);
  const sectionStart = html.lastIndexOf('<section', markerIndex);
  const sectionEnd = html.indexOf('</section>', markerIndex);
  assert.ok(sectionStart >= 0 && sectionEnd >= 0, `expected complete ${tabId} tab panel`);
  return html.slice(sectionStart, sectionEnd + '</section>'.length);
}

function openingTagByAttribute(html, attr, value) {
  const marker = `${attr}="${value}"`;
  const markerIndex = html.indexOf(marker);
  assert.ok(markerIndex >= 0, `expected ${marker}`);
  const tagStart = html.lastIndexOf('<div', markerIndex);
  const tagEnd = html.indexOf('>', markerIndex);
  assert.ok(tagStart >= 0 && tagEnd >= markerIndex, `expected opening tag for ${marker}`);
  return html.slice(tagStart, tagEnd + 1);
}

test('local history windows: aggregates Today, Last 5h, Last 7d, and all history', () => {
  const now = new Date('2026-05-31T20:00:00.000Z').getTime();
  const windows = createEmptyLocalHistoryWindowAggregateMap();
  const usage = (tokens) => ({
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });

  mergeTokenUsageIntoLocalHistoryWindows(windows, usage(100), now - (2 * 60 * 60 * 1000), now);
  mergeTokenUsageIntoLocalHistoryWindows(windows, usage(200), now - (6 * 60 * 60 * 1000), now);
  mergeTokenUsageIntoLocalHistoryWindows(windows, usage(300), now - (2 * 24 * 60 * 60 * 1000), now);
  mergeTokenUsageIntoLocalHistoryWindows(windows, usage(400), now - (8 * 24 * 60 * 60 * 1000), now);

  assert.strictEqual(windows.today.totalTokens, 300, 'expected Today to include same-day records');
  assert.strictEqual(windows.last5h.totalTokens, 100, 'expected Last 5h to include only recent records');
  assert.strictEqual(windows.last7d.totalTokens, 600, 'expected Last 7d to include last-week records');
  assert.strictEqual(windows.all.totalTokens, 1000, 'expected all history to remain unchanged');
});

test('local history windows: missing, invalid, and future timestamps stay out of recent windows', () => {
  const now = new Date('2026-05-31T20:00:00.000Z').getTime();
  const windows = createEmptyLocalHistoryWindowAggregateMap();
  const usage = {
    inputTokens: 100,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  mergeTokenUsageIntoLocalHistoryWindows(windows, usage, undefined, now);
  mergeTokenUsageIntoLocalHistoryWindows(windows, usage, parseTimestampEpochMs('not a timestamp'), now);
  mergeTokenUsageIntoLocalHistoryWindows(windows, usage, now + 60 * 1000, now);

  assert.strictEqual(windows.today.totalTokens, 0, 'expected no guessed Today records');
  assert.strictEqual(windows.last5h.totalTokens, 0, 'expected no guessed Last 5h records');
  assert.strictEqual(windows.last7d.totalTokens, 0, 'expected no guessed Last 7d records');
  assert.strictEqual(windows.all.totalTokens, 300, 'expected all history to retain records');
});

test('dashboard: provider labels match expected', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 3000, totalAssistantMessages: 1, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const labels = model.providers.map(p => p.label);
  assert.strictEqual(model.liveQuotaEnabled, true);
  assert.ok(labels.includes('Claude'), `expected "Claude" label`);
  assert.ok(labels.includes('Codex'), `expected "Codex" label`);
});

test('dashboard: aggregate tokens sum loaded providers', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 3000, totalAssistantMessages: 1, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  assert.strictEqual(model.totalTokens, 8000, 'expected 8000 total tokens');
  assert.strictEqual(model.totalAssistantMessages, 3, 'expected 3 total messages');
});

test('dashboard: no-data provider excluded from totals', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'no-data' },
    ],
  );
  const model = buildDashboardModel(status);
  assert.strictEqual(model.totalTokens, 5000, 'expected only claude tokens');
  assert.strictEqual(model.totalAssistantMessages, 2, 'expected only claude messages');
});

test('dashboard: local history windows combine loaded providers and default to Today', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 10,
        filesFound: 1,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 100, messages: 1 },
          last5h: { tokens: 80, messages: 1 },
          last7d: { tokens: 300, messages: 3 },
          all: { tokens: 1000, messages: 10 },
        }),
      },
      {
        providerId: 'codex',
        status: 'ok',
        totalTokens: 2000,
        totalAssistantMessages: 20,
        filesFound: 1,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 50, messages: 1 },
          last5h: { tokens: 50, messages: 1 },
          last7d: { tokens: 400, messages: 4 },
          all: { tokens: 2000, messages: 20 },
        }),
      },
    ],
  );
  const model = buildDashboardModel(status);
  const today = model.localHistoryWindows.find(w => w.windowId === 'today');
  const all = model.localHistoryWindows.find(w => w.windowId === 'all');
  const claude = model.providers.find(p => p.providerId === 'claude');

  assert.strictEqual(model.defaultLocalHistoryWindowId, 'today');
  assert.strictEqual(model.totalTokens, 3000, 'expected all-history aggregate to remain unchanged');
  assert.strictEqual(model.totalAssistantMessages, 30, 'expected all-history message aggregate to remain unchanged');
  assert.strictEqual(today.totalTokens, 150, 'expected combined Today tokens');
  assert.strictEqual(today.totalAssistantMessages, 2, 'expected combined Today messages');
  assert.strictEqual(all.totalTokens, 3000, 'expected combined all-history tokens');
  assert.strictEqual(claude.localHistoryWindows.find(w => w.windowId === 'last7d').totalTokens, 300);
});

test('dashboard source modes: no snapshots default to Combined while snapshots-only stays unavailable', () => {
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  assert.strictEqual(model.defaultSourceMode, 'combined');
  assert.strictEqual(model.sourceModes.find(m => m.sourceMode === 'local').available, true);
  assert.strictEqual(model.sourceModes.find(m => m.sourceMode === 'snapshots').available, false);
  assert.strictEqual(model.sourceModes.find(m => m.sourceMode === 'combined').available, true);
  assert.strictEqual(buildDashboardModel(createInitialStatus(['claude']), 'snapshots').defaultSourceMode, 'snapshots');
});

test('dashboard source modes: snapshots present default to Combined', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(1500, 3),
  }]));
  const model = buildDashboardModel(status);
  assert.strictEqual(model.defaultSourceMode, 'combined');
  assert.strictEqual(model.sourceModes.find(m => m.sourceMode === 'snapshots').available, true);
  assert.strictEqual(model.sourceModes.find(m => m.sourceMode === 'combined').available, true);
});

test('dashboard source modes: Local only, Snapshots only, and Combined totals are pure aggregates', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 10,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 100, messages: 1 },
        last5h: { tokens: 80, messages: 1 },
        last7d: { tokens: 300, messages: 3 },
        all: { tokens: 1000, messages: 10 },
      }),
    }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
    windowTotals: {
      today: aggregateFixture(50, 1),
      all: aggregateFixture(500, 5),
    },
  }]));
  const model = buildDashboardModel(status);

  assert.strictEqual(sourceTotals(model, 'local').windows.find(w => w.windowId === 'all').totalTokens, 1000);
  assert.strictEqual(sourceTotals(model, 'snapshots').windows.find(w => w.windowId === 'all').totalTokens, 500);
  assert.strictEqual(sourceTotals(model, 'combined').windows.find(w => w.windowId === 'all').totalTokens, 1500);
  assert.strictEqual(sourceTotals(model, 'combined').windows.find(w => w.windowId === 'today').totalTokens, 150);
});

test('dashboard source modes: provider tabs filter source totals by provider', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([
    {
      providerId: 'claude',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(300, 3),
    },
    {
      providerId: 'codex',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(700, 7),
    },
  ]));
  const model = buildDashboardModel(status);

  assert.strictEqual(providerSourceTotals(model, 'combined', 'claude').totalTokens, 1300);
  assert.strictEqual(providerSourceTotals(model, 'combined', 'codex').totalTokens, 2700);
  assert.strictEqual(providerSourceTotals(model, 'snapshots', 'claude').totalAssistantMessages, 3);
  assert.strictEqual(providerSourceTotals(model, 'snapshots', 'codex').totalAssistantMessages, 7);
});

test('dashboard provider availability: local source only shows providers with local usage data', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'no-data' },
    ],
  );
  const model = buildDashboardModel(status, 'local');

  assert.deepStrictEqual(model.providerTabs.map(tab => tab.providerId), ['claude']);
  assert.strictEqual(providerSourceTotals(model, 'local', 'claude').hasUsageData, true);
  assert.strictEqual(providerSourceTotals(model, 'local', 'codex').hasUsageData, false);
});

test('dashboard provider availability: snapshots source only shows providers with imported usage data', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'codex',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(700, 7),
  }]));
  const model = buildDashboardModel(status, 'snapshots');

  assert.deepStrictEqual(model.providerTabs.map(tab => tab.providerId), ['codex']);
  assert.strictEqual(providerSourceTotals(model, 'snapshots', 'codex').hasUsageData, true);
  assert.strictEqual(providerSourceTotals(model, 'snapshots', 'claude').hasUsageData, false);
});

test('dashboard provider availability: combined source includes local and imported provider lanes', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'codex',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(700, 7),
    sourceLabel: 'WATCHER',
  }]));
  const model = buildDashboardModel(status, 'combined');

  assert.deepStrictEqual(model.providerTabs.map(tab => tab.providerId), ['claude', 'codex']);
  assert.deepStrictEqual(model.providerTabs.find(tab => tab.providerId === 'codex').sourceLabels, ['WATCHER']);
});

test('dashboard provider availability: live quota alone does not create provider usage tabs', () => {
  const status = applyLiveQuotaResults(createInitialStatus(['claude', 'codex']), [
    {
      providerId: 'claude',
      windows: [{ windowId: '5h', usedPercentage: 25, remainingPercentage: 75 }],
      freshness: 'live',
      lastUpdatedEpochMs: Date.now(),
    },
  ]);
  const model = buildDashboardModel(status);

  assert.deepStrictEqual(model.providerTabs, []);
  assert.strictEqual(hasDashboardProviderUsageData(providerSourceTotals(model, 'combined', 'claude')), false);
});

test('dashboard source modes: recent windows do not invent snapshot data when windows are missing', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 10,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 100, messages: 1 },
        last5h: { tokens: 80, messages: 1 },
        last7d: { tokens: 300, messages: 3 },
        all: { tokens: 1000, messages: 10 },
      }),
    }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
  }]));
  const model = buildDashboardModel(status);

  assert.strictEqual(sourceTotals(model, 'snapshots').windows.find(w => w.windowId === 'today').totalTokens, 0);
  assert.strictEqual(sourceTotals(model, 'combined').windows.find(w => w.windowId === 'today').totalTokens, 100);
  assert.deepStrictEqual(sourceTotals(model, 'combined').missingSnapshotWindowIds, ['today', 'last5h', 'last7d']);
});

test('dashboard source modes: explicit zero snapshot windows count as provided', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
    windowTotals: {
      today: aggregateFixture(0, 0),
    },
  }]));
  const model = buildDashboardModel(status);
  assert.strictEqual(sourceTotals(model, 'snapshots').windows.find(w => w.windowId === 'today').totalTokens, 0);
  assert.deepStrictEqual(sourceTotals(model, 'snapshots').missingSnapshotWindowIds, ['last5h', 'last7d']);
});

test('dashboard source modes: All local history combines local all-history and snapshot aggregate totals', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 2500, totalAssistantMessages: 4, filesFound: 1 }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(750, 2),
  }]));
  const model = buildDashboardModel(status);
  const all = sourceTotals(model, 'combined').windows.find(w => w.windowId === 'all');
  assert.strictEqual(all.totalTokens, 3250);
  assert.strictEqual(all.totalAssistantMessages, 6);
});

test('dashboard source modes: model aggregates follow Local, Snapshots, and Combined', () => {
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 2,
      filesFound: 1,
      modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
      localHistoryModelWindows: {
        today: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 100, totalAssistantMessages: 1 }],
        last5h: [],
        last7d: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 300, totalAssistantMessages: 1 }],
        all: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 2 }],
      },
    }, {
      providerId: 'codex',
      status: 'ok',
      totalTokens: 2000,
      totalAssistantMessages: 3,
      filesFound: 1,
      modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 2000, totalAssistantMessages: 3 }],
      localHistoryModelWindows: {
        today: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 200, totalAssistantMessages: 1 }],
        last5h: [],
        last7d: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 600, totalAssistantMessages: 2 }],
        all: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 2000, totalAssistantMessages: 3 }],
      },
    }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 1),
    modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-opus-4-20250514', totalTokens: 500, totalAssistantMessages: 1 }],
    modelWindowTotals: {
      today: [{ providerId: 'claude', modelLabel: 'claude-opus-4-20250514', totalTokens: 50, totalAssistantMessages: 1 }],
      all: [{ providerId: 'claude', modelLabel: 'claude-opus-4-20250514', totalTokens: 500, totalAssistantMessages: 1 }],
    },
  }]));
  const model = buildDashboardModel(status);

  assert.strictEqual(sourceTotals(model, 'local').modelWindows.all.length, 2);
  assert.strictEqual(sourceTotals(model, 'snapshots').modelWindows.all[0].modelLabel, 'claude-opus-4-20250514');
  assert.strictEqual(sourceTotals(model, 'combined').modelWindows.all.find(row => row.modelLabel === 'claude-sonnet-4-20250514').totalTokens, 1000);
  assert.strictEqual(sourceTotals(model, 'combined').modelWindows.all.find(row => row.modelLabel === 'claude-opus-4-20250514').totalTokens, 500);
  assert.strictEqual(sourceTotals(model, 'combined').modelWindows.today.find(row => row.modelLabel === 'claude-opus-4-20250514').totalTokens, 50);
  assert.strictEqual(sourceTotals(model, 'snapshots').modelWindows.last7d.length, 0, 'snapshot all-time model totals must not be invented for recent windows');
});

test('dashboard: uses local history wording, not subscription', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('Live quota first, usage history second'), `expected live quota/local history subtitle`);
  assert.ok(html.includes('History chart'), `expected history chart section`);
  assert.ok(!html.includes('Usage history (secondary)'), `dashboard should not include removed summary section`);
  assert.ok(!html.includes('subscription'), `should not include "subscription"`);
});

test('dashboard: History range selector drives historical values', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 5000,
        totalAssistantMessages: 5,
        filesFound: 1,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 125, messages: 1 },
          last5h: { tokens: 75, messages: 1 },
          last7d: { tokens: 1200, messages: 3 },
          all: { tokens: 5000, messages: 5 },
        }),
      },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('data-history-range="1W"'), `expected 1W history range label`);
  assert.ok(html.includes('data-history-range="1M"'), `expected 1M history range label`);
  assert.ok(html.includes('data-history-range="1Y"'), `expected 1Y history range label`);
  assert.ok(html.includes('data-history-range="ALL"'), `expected ALL history range label`);
  assert.ok(html.includes('125 tokens'), `expected Today default tokens`);
  assert.ok(html.includes('data-history-total-label-combined-1M="125 tokens"'), `expected history summary to carry selected range tokens`);
  assert.ok(html.includes('data-model-empty-combined-1M='), `expected model distribution to carry selected range data`);
  assert.ok(!html.includes('data-local-window='), `local history window selector should not render`);
});

test('dashboard: uses full-width dashboard canvas', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('max-width: none;'), `expected dashboard to avoid a fixed width cap`);
  assert.ok(html.includes('padding: 16px 20px;'), `expected dashboard body padding`);
  assert.ok(!html.includes('max-width: 920px'), `dashboard should not cap content at the old PromptFuel width`);
  assert.ok(!html.includes('margin: 0 auto;'), `dashboard should not center a narrow fixed-width column`);
});

test('dashboard: renders history chart and provider colors', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 10,
        filesFound: 1,
        modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 10 }],
        localHistoryModelWindows: {
          today: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 400, totalAssistantMessages: 4 }],
          last5h: [], last7d: [], all: [],
        },
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 400, messages: 4 },
          last5h: { tokens: 150, messages: 2 },
          last7d: { tokens: 700, messages: 7 },
          all: { tokens: 1000, messages: 10 },
        }),
      },
      {
        providerId: 'codex',
        status: 'ok',
        totalTokens: 2000,
        totalAssistantMessages: 20,
        filesFound: 1,
        modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 2000, totalAssistantMessages: 20 }],
        localHistoryModelWindows: {
          today: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 600, totalAssistantMessages: 6 }],
          last5h: [], last7d: [], all: [],
        },
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 600, messages: 6 },
          last5h: { tokens: 300, messages: 3 },
          last7d: { tokens: 1600, messages: 16 },
          all: { tokens: 2000, messages: 20 },
        }),
      },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('class="usage-history-chart"'), `expected aggregate history chart`);
  assert.ok(html.includes('data-history-chart="overview"'), `expected overview history chart scope`);
  assert.ok(html.includes('data-history-range="1W"'), `expected 1W history range control`);
  assert.ok(html.includes('data-history-range="1M"'), `expected 1M history range control`);
  assert.ok(html.includes('data-history-range="1Y"'), `expected 1Y history range control`);
  assert.ok(html.includes('data-history-range="ALL"'), `expected ALL history range control`);
  assert.ok(html.includes('data-history-range-group="local-1M"'), `expected daily history range bins`);
  assert.ok(html.includes('class="usage-history-bar-segment"'), `expected model-stacked chart segments`);
  assert.ok(!html.includes('usage-history-bar-segment claude'), `provider-class segments should be replaced by model-color segments`);
  assert.ok(!html.includes('usage-history-bar-segment codex'), `provider-class segments should be replaced by model-color segments`);
  assert.ok(html.includes('--pf-provider-claude: var(--vscode-charts-blue'), `expected Claude blue provider color`);
  assert.ok(html.includes('--pf-provider-codex: var(--vscode-charts-purple'), `expected Codex purple provider color`);
  assert.ok(html.includes('--pf-model-0:'), `expected model color palette variables`);
  assert.ok(html.includes("querySelectorAll('[data-history-chart]')"), `expected source/window changes to update charts`);
});

test('dashboard: renders model breakdown rows from safe aggregates', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 10,
        filesFound: 1,
        modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 10 }],
        localHistoryModelWindows: {
          today: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 100, totalAssistantMessages: 1 }],
          last5h: [],
          last7d: [],
          all: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 10 }],
        },
      },
      {
        providerId: 'codex',
        status: 'ok',
        totalTokens: 2000,
        totalAssistantMessages: 20,
        filesFound: 1,
        modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 2000, totalAssistantMessages: 20 }],
        localHistoryModelWindows: {
          today: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 200, totalAssistantMessages: 2 }],
          last5h: [],
          last7d: [],
          all: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 2000, totalAssistantMessages: 20 }],
        },
      },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(html.includes('data-model-breakdown="overview"'), `expected overview model breakdown card`);
  assert.ok(html.includes('class="usage-model-distribution"'), `expected model distribution surface`);
  assert.ok(html.includes('class="usage-model-donut"'), `expected model breakdown donut`);
  assert.ok(html.includes('claude-sonnet-4-20250514'), `expected Claude model label`);
  assert.ok(html.includes('gpt-5.4-codex'), `expected Codex model label`);
  assert.ok(html.includes('data-model-value-combined-1M="1.0K tokens"'), `expected range-filtered model data`);
  assert.ok(html.includes('data-model-width-combined-1M'), `expected compact model bars`);
  assert.ok(html.includes('No model breakdown available.'), `expected calm empty state copy`);
  assert.ok(claudePanel.includes('data-model-breakdown="claude"'), `expected provider tab model breakdown`);
  assert.ok(claudePanel.includes('claude-sonnet-4-20250514'), `expected Claude tab model row`);
  assert.ok(!claudePanel.includes('gpt-5.4-codex'), `Claude tab should not include Codex model row`);
  assert.ok(codexPanel.includes('gpt-5.4-codex'), `Codex tab should include Codex model row`);
  assert.ok(!html.includes('API est.'), `PromptFuel dashboard should not include API estimates in this pass`);
});

test('dashboard source modes: source mode is config-driven, not a main dashboard selector', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude']));
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(!html.includes('data-source-mode="local"'), `source selector buttons should be removed`);
  assert.ok(!html.includes('data-source-mode="snapshots"'), `source selector buttons should be removed`);
  assert.ok(!html.includes('data-source-mode="combined"'), `source selector buttons should be removed`);
  assert.ok(!html.includes('class="source-selector"'), `source selector should not render`);
  assert.ok(html.includes('data-state-chip="combined"'), `expected Combined source chip`);
  assert.ok(html.includes('Imported snapshots: 0'), `expected compact no-snapshot summary`);
  assert.ok(html.includes('Dashboard usage source: Combined'), `expected configured source copy`);
});

test('dashboard source modes: snapshot copy, summary, and data attributes render when snapshots exist', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
    sourceLabel: 'snapshot import',
    snapshotLaneLabel: 'Remote Claude',
    sevenDayUsedPercent: 27,
    fiveHourUsedPercent: 92,
  }]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('data-state-chip="combined"'), `expected Combined configured source chip`);
  assert.ok(html.includes('Imported snapshots: 1'), `expected compact snapshot summary`);
  assert.ok(html.includes('Providers: Claude'), `expected compact provider coverage summary`);
  assert.ok(!html.includes('data-state-chip="aggregate-only"'), `snapshot card section should not render`);
  assert.ok(!html.includes('class="snapshot-provider-list"'), `snapshot provider list should not render`);
  assert.ok(!html.includes('class="card-grid snapshot-grid"'), `snapshot section should not render repeated provider cards`);
  assert.ok(html.includes('data-today-source-group="local"'), `expected Today local source group`);
  assert.ok(html.includes('data-today-source-group="snapshots"'), `expected Today snapshot source group`);
  assert.ok(html.includes('data-today-source-group="combined"'), `expected Today combined source group`);
  assert.ok(html.includes('function updateTodaySections()'), `expected Today section to update with selected source mode`);
  assert.ok(html.includes('data-history-range="1M"'), `expected history range controls`);
  assert.ok(html.includes('snapshot import'), `expected safe source label`);
  assert.ok(html.includes('Snapshot quota: snapshot import Remote Claude: 7d 73% remaining / 5h 8% remaining'), `expected imported quota remaining in dashboard summary`);
});

test('dashboard source modes: safe snapshot source labels appear in summary, contribution, and model sections', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['codex']),
    [{
      providerId: 'codex',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 3,
      filesFound: 1,
      modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 1000, totalAssistantMessages: 3 }],
      localHistoryModelWindows: {
        today: [],
        last5h: [],
        last7d: [],
        all: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 1000, totalAssistantMessages: 3 }],
      },
    }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'codex',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 2),
    sourceLabel: 'WATCHER',
    modelAggregates: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 500, totalAssistantMessages: 2, source: 'snapshot', sourceLabels: ['WATCHER'] }],
    modelWindowTotals: {
      all: [{ providerId: 'codex', modelLabel: 'gpt-5.4-codex', totalTokens: 500, totalAssistantMessages: 2, source: 'snapshot', sourceLabels: ['WATCHER'] }],
    },
  }]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('Snapshot sources'), `expected snapshot source summary label`);
  assert.ok(html.includes('WATCHER'), `expected safe source label in dashboard footer/summary`);
  assert.ok(!html.includes('Codex + Codex (WATCHER)'), `machine source labels should not appear in model provider column`);
  assert.ok(!html.includes('Imported snapshots (WATCHER)'), `source contribution card with snapshot label should not render`);
});

test('dashboard visuals: Usage distribution section is not rendered', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(!html.includes('data-usage-distribution="overview"'), `Usage distribution section should not render`);
  assert.ok(!html.includes('data-distribution-card="provider-overview"'), `provider distribution card should not render`);
  assert.ok(!html.includes('Provider distribution'), `provider distribution title should not render`);
  assert.ok(!html.includes('data-source-contribution='), `source contribution card should not render`);
  assert.ok(!html.includes('Source contribution'), `source contribution title should not render`);
  assert.ok(html.includes('role="meter"'), `expected usage bars to still expose accessible meter semantics`);
});

test('dashboard visuals: selected source mode affects historical distribution only', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const now = Date.now();
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 10,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 100, messages: 1 },
        last5h: { tokens: 80, messages: 1 },
        last7d: { tokens: 300, messages: 3 },
        all: { tokens: 1000, messages: 10 },
      }),
    }],
  );
  const withSnapshots = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(400, 4),
    windowTotals: {
      today: aggregateFixture(40, 1),
      all: aggregateFixture(400, 4),
    },
  }]));
  const status = applyLiveQuotaResults(withSnapshots, [{
    providerId: 'claude',
    windows: [{ windowId: '5h', usedPercentage: 20, remainingPercentage: 80, resetsAtEpochMs: now + 1000 }],
    freshness: 'live',
    lastUpdatedEpochMs: now,
  }]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('data-history-total-label-local-1M="100 tokens"'), `expected Local only history range total`);
  assert.ok(html.includes('data-history-total-label-snapshots-1M="40 tokens"'), `expected Snapshots only history range total`);
  assert.ok(html.includes('data-history-total-label-combined-1M="140 tokens"'), `expected Combined history range total`);
  assert.ok(html.includes('data-live-quota-card="claude"'), `expected live quota card to remain separate`);
  assert.ok(html.includes('80% remaining'), `expected live quota value to remain unchanged by historical visuals`);
});

test('dashboard visuals: combined mode history chart shows local and snapshot contribution', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 1000,
      totalAssistantMessages: 10,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 100, messages: 1 },
        last5h: { tokens: 80, messages: 1 },
        last7d: { tokens: 300, messages: 3 },
        all: { tokens: 1000, messages: 10 },
      }),
    }],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
    windowTotals: {
      today: aggregateFixture(50, 1),
      all: aggregateFixture(500, 5),
    },
  }]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('data-history-total-label-combined-1M="150 tokens"'), `expected combined range history total`);
  assert.ok(html.includes('data-history-total-label-local-1M="100 tokens"'), `expected local range history total`);
  assert.ok(html.includes('data-history-total-label-snapshots-1M="50 tokens"'), `expected snapshots range history total`);
  assert.ok(!html.includes('data-source-contribution='), `source contribution card should not render`);
});

test('dashboard visuals: no snapshot mode handles missing snapshots calmly', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('Imported snapshots: 0'), `expected compact no-snapshot state`);
  assert.ok(!html.includes('data-source-mode="snapshots"'), `expected dashboard source selector to be absent`);
  assert.ok(!html.includes('data-source-mode="combined"'), `expected dashboard source selector to be absent`);
  assert.ok(!html.includes('data-source-contribution='), `source contribution card should not render without snapshots`);
  assert.ok(html.includes('data-history-total-label-local-1M'), `expected local history range data to exist`);
});

test('dashboard visuals: provider tabs isolate provider-specific visual sections', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 10,
        filesFound: 1,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 100, messages: 1 },
          last5h: { tokens: 80, messages: 1 },
          last7d: { tokens: 300, messages: 3 },
          all: { tokens: 1000, messages: 10 },
        }),
      },
      {
        providerId: 'codex',
        status: 'ok',
        totalTokens: 2000,
        totalAssistantMessages: 20,
        filesFound: 1,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 200, messages: 2 },
          last5h: { tokens: 150, messages: 2 },
          last7d: { tokens: 600, messages: 6 },
          all: { tokens: 2000, messages: 20 },
        }),
      },
    ],
  );
  const status = applySnapshotReadResults(localStatus, snapshotStateFixture([
    {
      providerId: 'claude',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(500, 5),
      windowTotals: { today: aggregateFixture(50, 1), all: aggregateFixture(500, 5) },
    },
    {
      providerId: 'codex',
      generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
      aggregate: aggregateFixture(700, 7),
      windowTotals: { today: aggregateFixture(70, 1), all: aggregateFixture(700, 7) },
    },
  ]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(!claudePanel.includes('data-source-contribution='), `Claude panel should not include source contribution card`);
  assert.ok(!codexPanel.includes('data-source-contribution='), `Codex panel should not include source contribution card`);
  assert.ok(claudePanel.includes('data-model-breakdown="claude"'), `expected Claude model breakdown in Claude tab`);
  assert.ok(codexPanel.includes('data-model-breakdown="codex"'), `expected Codex model breakdown in Codex tab`);
  assert.ok(!claudePanel.includes('data-model-breakdown="codex"'), `Claude panel should not include Codex model breakdown`);
  assert.ok(!codexPanel.includes('data-model-breakdown="claude"'), `Codex panel should not include Claude model breakdown`);
});

test('dashboard source modes: missing snapshot recent windows do not create prominent dashboard notes', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
  }]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(!html.includes('data-source-window-note="snapshots"'), `snapshot missing-window notes should not render as dashboard controls`);
  assert.ok(!html.includes('data-missing-windows="today,last5h,last7d"'), `missing snapshot window ids should stay out of the main UI`);
  assert.ok(html.includes('data-history-empty-snapshots-1M'), `expected snapshot history empty-state data to remain available`);
});

test('dashboard source modes: no raw filenames, paths, internal labels, or private source labels appear in HTML', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const rawPrivate = 'raw-internal-label C:\\Users\\keith\\session.jsonl secret-token';
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([{
    providerId: 'claude',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(500, 5),
    sourceLabel: rawPrivate,
  }]));
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(!html.includes('.jsonl'), `should not include raw filenames`);
  assert.ok(!html.includes('C:\\'), `should not include raw paths`);
  assert.ok(!html.includes('AgentBridge'), `should not include internal project labels`);
  assert.ok(!html.includes('PHOENIX'), `should not include machine labels`);
  assert.ok(!html.includes('WATCHER'), `should not include machine labels`);
  assert.ok(!html.includes('CEREBRO'), `should not include machine labels`);
  assert.ok(!html.includes('X-23'), `should not include machine labels`);
  assert.ok(!html.includes('raw-internal-label'), `should not include private labels`);
  assert.ok(!html.includes('secret-token'), `should not include credential-looking values`);
});

test('dashboard: renders Overview, Claude, and Codex tabs with Overview active by default', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.ok(html.includes('data-dashboard-tab="overview"'), `expected Overview tab`);
  assert.ok(html.includes('data-dashboard-tab="claude"'), `expected Claude tab`);
  assert.ok(html.includes('data-dashboard-tab="codex"'), `expected Codex tab`);
  assert.ok(html.includes('aria-controls="tab-overview"'), `expected Overview tab controls overview panel`);
  assert.ok(html.includes('aria-selected="true">Overview</button>'), `expected Overview active by default`);
  assert.ok(html.includes('data-dashboard-tab-panel="overview"'), `expected Overview tab panel`);
  assert.ok(html.includes('data-dashboard-tab-panel="claude"'), `expected Claude tab panel`);
  assert.ok(html.includes('data-dashboard-tab-panel="codex"'), `expected Codex tab panel`);
  assert.ok(html.includes('aria-labelledby="tab-button-claude" hidden'), `expected Claude tab hidden by default`);
  assert.ok(html.includes('aria-labelledby="tab-button-codex" hidden'), `expected Codex tab hidden by default`);
});

test('dashboard: hides provider tabs and panels when selected source scope has no provider usage data', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyLiveQuotaResults(createInitialStatus(['claude', 'codex']), [
    {
      providerId: 'claude',
      windows: [{ windowId: '5h', usedPercentage: 25, remainingPercentage: 75 }],
      freshness: 'live',
      lastUpdatedEpochMs: Date.now(),
    },
  ]);
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);

  assert.ok(html.includes('data-dashboard-tab="overview"'), `expected Overview tab`);
  assert.ok(html.includes('aria-selected="true">Overview</button>'), `expected Overview active by default`);
  assert.ok(!html.includes('data-dashboard-tab="claude"'), `live quota alone should not render Claude tab`);
  assert.ok(!html.includes('data-dashboard-tab="codex"'), `live quota alone should not render Codex tab`);
  assert.ok(!html.includes('data-dashboard-tab-panel="claude"'), `live quota alone should not render Claude provider panel`);
  assert.ok(!html.includes('data-dashboard-tab-panel="codex"'), `live quota alone should not render Codex provider panel`);
  assert.ok(html.includes('75% remaining'), `Overview should still show live quota`);
  assert.ok(html.includes("tabId = 'overview'"), `tab script should fall back to Overview when a tab is unavailable`);
});

test('dashboard: provider tab appears when usage comes from imported snapshot data', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applySnapshotReadResults(createInitialStatus(['claude', 'codex']), snapshotStateFixture([{
    providerId: 'codex',
    generatedAtEpochMs: new Date('2026-05-31T18:00:00.000Z').getTime(),
    aggregate: aggregateFixture(700, 7),
    sourceLabel: 'WATCHER',
    windowTotals: { today: aggregateFixture(70, 1), all: aggregateFixture(700, 7) },
  }]));
  const model = buildDashboardModel(status, 'snapshots');
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(!html.includes('data-dashboard-tab="claude"'), `Claude tab should be hidden without snapshot usage`);
  assert.ok(html.includes('data-dashboard-tab="codex"'), `Codex tab should render for snapshot usage`);
  assert.ok(codexPanel.includes('Codex (WATCHER)'), `Codex tab should label imported source lane`);
  assert.ok(codexPanel.includes('metric-label">Tokens'), `provider Today tokens card should render`);
  assert.ok(codexPanel.includes('metric-label">Activity'), `provider Today activity card should render`);
});

test('dashboard: provider tabs isolate local history details by provider', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      {
        providerId: 'claude',
        status: 'ok',
        totalTokens: 1000,
        totalAssistantMessages: 10,
        filesFound: 1,
        parseErrors: 2,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 100, messages: 1 },
          last5h: { tokens: 80, messages: 1 },
          last7d: { tokens: 300, messages: 3 },
          all: { tokens: 1000, messages: 10 },
        }),
      },
      {
        providerId: 'codex',
        status: 'ok',
        totalTokens: 2000,
        totalAssistantMessages: 20,
        filesFound: 1,
        parseErrors: 3,
        localHistoryWindows: localHistoryWindowsFixture({
          today: { tokens: 200, messages: 2 },
          last5h: { tokens: 150, messages: 2 },
          last7d: { tokens: 600, messages: 6 },
          all: { tokens: 2000, messages: 20 },
        }),
      },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(!claudePanel.includes('Claude provider usage history details'), `provider history details section should not render in Claude tab`);
  assert.ok(!claudePanel.includes('data-provider-local-detail='), `provider detail card should not render in Claude tab`);
  assert.ok(claudePanel.includes('Parse errors: 2 lines skipped'), `expected Claude parse error note`);
  assert.ok(!claudePanel.includes('Parse errors: 3 lines skipped'), `Claude tab should not include Codex parse count`);

  assert.ok(!codexPanel.includes('Codex provider usage history details'), `provider history details section should not render in Codex tab`);
  assert.ok(!codexPanel.includes('data-provider-local-detail='), `provider detail card should not render in Codex tab`);
  assert.ok(codexPanel.includes('Parse errors: 3 lines skipped'), `expected Codex parse error note`);
  assert.ok(!codexPanel.includes('Parse errors: 2 lines skipped'), `Codex tab should not include Claude parse count`);
});

test('dashboard: local history selector updates provider details and charts', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 5000,
      totalAssistantMessages: 5,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 125, messages: 1 },
        last5h: { tokens: 75, messages: 1 },
        last7d: { tokens: 1200, messages: 3 },
        all: { tokens: 5000, messages: 5 },
      }),
    }],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');

  assert.ok(!html.includes('data-local-window="last7d"'), `local history selector button should be removed`);
  assert.ok(!html.includes('local-history-summary-value'), `removed usage summary values should not render or update`);
  assert.ok(html.includes("querySelectorAll('[data-history-chart]')"), `expected selector script to update charts`);
  assert.ok(claudePanel.includes('data-history-total-label-combined-1M="125 tokens"'), `expected Claude tab history chart to carry combined 1M range tokens`);
  assert.ok(claudePanel.includes('data-history-chart="claude"'), `expected Claude tab history chart`);
  assert.ok(!claudePanel.includes('data-provider-local-detail='), `provider detail card should not render in Claude tab`);
});

test('dashboard: includes local history disclaimer banner', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('class="disclaimer"'), `expected dashboard disclaimer banner`);
  assert.ok(html.includes('class="live-quota-section"'), `expected live quota section`);
  assert.ok(!html.includes('class="source-selector"'), `source mode controls should not render`);
  assert.ok(!html.includes('class="window-selector"'), `local history window controls should not render`);
  assert.ok(!html.includes('class="control-panel"'), `main dashboard control panel should not render`);
  assert.ok(html.includes('Dashboard usage source: Combined'), `expected config-driven source copy`);
});

test('dashboard: no file paths or .jsonl in HTML', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 3000, totalAssistantMessages: 1, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(!html.includes('.jsonl'), `should not include .jsonl in HTML`);
  assert.ok(!html.includes('projects'), `should not include path segments`);
  assert.ok(!html.includes('sessions'), `should not include path segments`);
});

test('dashboard: refresh button sends refreshDashboard command', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('refreshDashboard'), `expected refreshDashboard command in HTML`);
});

test('dashboard: default live quota state shows loading, not not-enabled copy', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = createInitialStatus(['claude']);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('Live quota loading'), `expected "Live quota loading" in dashboard`);
  assert.ok(!html.includes('Live quota not enabled yet'), `should not show old not-enabled copy`);
});

test('dashboard: explicit opt-out shows live quota disabled', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = createInitialStatus(['claude'], false);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('Live quota disabled'), `expected "Live quota disabled" in dashboard`);
  assert.ok(html.includes('DISABLED'), `expected disabled badge in dashboard`);
});

test('dashboard: unavailable live quota stays primary over local history', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const updated = applyLiveQuotaResults(status, [
    { providerId: 'claude', windows: [], freshness: 'unavailable' },
  ]);
  const model = buildDashboardModel(updated);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('Live quota unavailable'), `expected unavailable live quota in dashboard`);
  assert.ok(html.includes('UNAVAILABLE'), `expected unavailable badge in dashboard`);
  assert.ok(html.includes('History chart'), `expected historical chart to remain separated`);
  assert.ok(!html.includes('Usage history tokens'), `removed usage summary labels should stay absent`);
});

test('dashboard: live quota values are not filtered by history range or source setting', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const now = Date.now();
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude']),
    [{
      providerId: 'claude',
      status: 'ok',
      totalTokens: 5000,
      totalAssistantMessages: 5,
      filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({
        today: { tokens: 100, messages: 1 },
        last5h: { tokens: 80, messages: 1 },
        last7d: { tokens: 1200, messages: 3 },
        all: { tokens: 5000, messages: 5 },
      }),
    }],
  );
  const status = applyLiveQuotaResults(localStatus, [{
    providerId: 'claude',
    windows: [
      { windowId: '5h', usedPercentage: 92, remainingPercentage: 8, resetsAtEpochMs: now + 1000 },
      { windowId: '7d', usedPercentage: 72, remainingPercentage: 28, resetsAtEpochMs: now + 2000 },
    ],
    freshness: 'live',
    lastUpdatedEpochMs: now,
  }]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);

  assert.strictEqual(model.liveQuotaCards[0].windows[0].usedPercentage, 92);
  assert.ok(html.includes('8% remaining'), `expected live quota 5h remaining value`);
  assert.ok(html.includes('28% remaining'), `expected live quota 7d remaining value`);
  assert.ok(!html.includes('used /'), `dashboard should not show used/left pairs`);
  assert.ok(!html.includes('% left'), `dashboard should not use left wording`);
  assert.ok(!html.includes('data-local-window="all"'), `local selector should not render`);
  assert.ok(html.includes('data-history-range="ALL"'), `history range control should remain separate from live quota`);
});

test('dashboard: stale provider card renders inside provider tab only for that provider', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const status = applyLiveQuotaResults(localStatus, [
    {
      providerId: 'claude',
      windows: [
        { windowId: '5h', usedPercentage: 92, remainingPercentage: 8 },
        { windowId: '7d', usedPercentage: 72, remainingPercentage: 28 },
      ],
      freshness: 'stale',
      lastUpdatedEpochMs: Date.now(),
    },
    {
      providerId: 'codex',
      windows: [
        { windowId: '5h', usedPercentage: 15, remainingPercentage: 85 },
      ],
      freshness: 'live',
      lastUpdatedEpochMs: Date.now(),
    },
  ]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(claudePanel.includes('Claude live quota'), `expected Claude live quota section`);
  assert.ok(claudePanel.includes('STALE'), `expected stale badge in Claude tab`);
  assert.ok(claudePanel.includes('8% remaining'), `expected Claude stale remaining value`);
  assert.ok(!claudePanel.includes('85% remaining'), `Claude tab should not include Codex live value`);
  assert.ok(codexPanel.includes('LIVE'), `expected Codex live badge`);
  assert.ok(!codexPanel.includes('8% remaining'), `Codex tab should not include Claude stale value`);
  assert.ok(!html.includes('used /'), `dashboard should not show used/left pairs`);
});

test('dashboard: unavailable provider state renders inside provider tab', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const localStatus = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [{ providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const status = applyLiveQuotaResults(localStatus, [
    { providerId: 'codex', windows: [], freshness: 'unavailable' },
  ]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(codexPanel.includes('Codex live quota'), `expected Codex live quota section`);
  assert.ok(codexPanel.includes('UNAVAILABLE'), `expected unavailable badge in Codex tab`);
  assert.ok(codexPanel.includes('Live quota unavailable'), `expected sanitized unavailable copy in Codex tab`);
});

test('dashboard: disabled live quota state renders inside provider tabs', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex'], false),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  const codexPanel = dashboardTabPanel(html, 'codex');

  assert.ok(claudePanel.includes('Claude: Live quota disabled'), `expected Claude disabled copy`);
  assert.ok(codexPanel.includes('Codex: Live quota disabled'), `expected Codex disabled copy`);
  assert.ok(claudePanel.includes('DISABLED'), `expected disabled badge in Claude tab`);
  assert.ok(codexPanel.includes('DISABLED'), `expected disabled badge in Codex tab`);
});

test('dashboard: stale live quota renders as stale card, not unavailable', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyLiveQuotaResults(createInitialStatus(['claude']), [
    {
      providerId: 'claude',
      windows: [
        { windowId: '5h', usedPercentage: 92, remainingPercentage: 8 },
        { windowId: '7d', usedPercentage: 72, remainingPercentage: 28 },
      ],
      freshness: 'stale',
      lastUpdatedEpochMs: Date.now(),
    },
  ]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('badge stale'), `expected stale badge in dashboard`);
  assert.ok(html.includes('STALE'), `expected stale badge label in dashboard`);
  assert.ok(html.includes('Cached:'), `expected cached footer in dashboard`);
  assert.ok(html.includes('8% remaining'), `expected stale quota bar value`);
  assert.ok(!html.includes('used /'), `dashboard should not show used/left pairs`);
  assert.ok(!html.includes('Claude: Live quota unavailable'), `stale quota should not render unavailable`);
});

test('dashboard: live provider card shows live badge and reset countdown', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const now = Date.now();
  const status = applyLiveQuotaResults(createInitialStatus(['codex']), [
    {
      providerId: 'codex',
      windows: [
        { windowId: '5h', usedPercentage: 15, remainingPercentage: 85, resetsAtEpochMs: now + 60 * 60 * 1000 },
        { windowId: '7d', usedPercentage: 27, remainingPercentage: 73, resetsAtEpochMs: now + 24 * 60 * 60 * 1000 },
      ],
      freshness: 'live',
      lastUpdatedEpochMs: now,
    },
  ]);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(html.includes('Codex'), `expected Codex live card`);
  assert.ok(html.includes('LIVE'), `expected live badge`);
  assert.ok(html.includes('class="card-grid live-quota-grid"'), `expected live quota cards to use stable grid class`);
  assert.ok(html.includes('role="progressbar"'), `expected live quota bars to expose progress semantics`);
  assert.ok(html.includes('85% remaining'), `expected remaining text`);
  assert.ok(html.includes('85% remaining · resets in'), `expected remaining text with reset countdown`);
  assert.ok(!html.includes('used /'), `dashboard should not show used/left pairs`);
});

test('dashboard: removed usage summary section stays removed and parse wording remains', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1, parseErrors: 1 }],
  );
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  assert.ok(!html.includes('Usage totals'), `dashboard should not show standalone usage totals section`);
  assert.ok(!html.includes('Usage history (secondary)'), `dashboard should not show confusing secondary usage history label`);
  assert.ok(!html.includes('Usage history is secondary'), `dashboard should not describe usage history as secondary`);
  assert.ok(!html.includes('local-history-summary-value'), `dashboard should not render removed usage summary values`);
  assert.ok(!html.includes('Provider usage history details'), `provider usage history details section should not render`);
  assert.ok(!html.includes('Usage distribution'), `Usage distribution section should not render`);
  assert.ok(html.includes('Parse errors: 1 line skipped'), `expected non-alarming parse wording`);
});

test('dashboard: webview CSP and script nonce remain paired', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = createInitialStatus(['claude']);
  const model = buildDashboardModel(status);
  const mockWebview = { cspSource: 'http://example.com' };
  const html = buildDashboardHtml(mockWebview, model);
  const cspMatch = html.match(/script-src 'nonce-([^']+)'/);
  const scriptMatch = html.match(/<script nonce="([^"]+)">/);

  assert.ok(html.includes("default-src 'none'"), `expected restrictive default CSP`);
  assert.ok(html.includes('style-src http://example.com'), `expected webview CSP source in style-src`);
  assert.ok(cspMatch, `expected CSP nonce`);
  assert.ok(scriptMatch, `expected script nonce`);
  assert.strictEqual(scriptMatch[1], cspMatch[1], `expected script nonce to match CSP nonce`);
});

// === Dashboard parity: new behavior tests ===

test('dashboard: Today Source card is not rendered', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 2, filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 100, messages: 1 }, last5h: { tokens: 50, messages: 1 }, last7d: { tokens: 300, messages: 2 }, all: { tokens: 1000, messages: 2 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  const overviewPanel = dashboardTabPanel(html, 'overview');
  const todayGrid = overviewPanel.slice(overviewPanel.indexOf('today-card-grid'), overviewPanel.indexOf('today-card-grid') + 800);
  assert.ok(!todayGrid.includes('metric-label">Source'), `Today Source card should not render`);
  assert.ok(todayGrid.includes('metric-label">Tokens'), `Today Tokens card should render`);
  assert.ok(todayGrid.includes('metric-label">Activity'), `Today Activity card should render`);
});

test('dashboard: Today cache card renders when cache data exists', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1,
      localHistoryWindows: {
        today: { totalInputTokens: 200, totalOutputTokens: 100, totalCacheCreationInputTokens: 50, totalCacheReadInputTokens: 300, totalTokens: 650, totalAssistantMessages: 2 },
        last5h: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, totalTokens: 0, totalAssistantMessages: 0 },
        last7d: { totalInputTokens: 200, totalOutputTokens: 100, totalCacheCreationInputTokens: 50, totalCacheReadInputTokens: 300, totalTokens: 650, totalAssistantMessages: 2 },
        all: { totalInputTokens: 200, totalOutputTokens: 100, totalCacheCreationInputTokens: 50, totalCacheReadInputTokens: 300, totalTokens: 5000, totalAssistantMessages: 2 },
      } }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('metric-label">Cache'), `Today Cache card should render when cache data exists`);
  assert.ok(html.includes('Prompt cache activity'), `Today Cache card should include subtitle`);
});

test('dashboard: Today cache card absent when no cache data', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 2, filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 100, messages: 1 }, last5h: { tokens: 50, messages: 1 }, last7d: { tokens: 300, messages: 2 }, all: { tokens: 1000, messages: 2 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(!html.includes('Prompt cache activity'), `Today Cache card should not render when no cache data`);
});

test('dashboard: model colors assigned by model label, not provider', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 2, filesFound: 1,
        modelAggregates: [{ providerId: 'claude', modelLabel: 'same-model', totalTokens: 600, totalAssistantMessages: 1 }],
        localHistoryModelWindows: { today: [], last5h: [], last7d: [], all: [{ providerId: 'claude', modelLabel: 'same-model', totalTokens: 600, totalAssistantMessages: 1 }] } },
      { providerId: 'codex', status: 'ok', totalTokens: 2000, totalAssistantMessages: 3, filesFound: 1,
        modelAggregates: [{ providerId: 'codex', modelLabel: 'same-model', totalTokens: 800, totalAssistantMessages: 1 }],
        localHistoryModelWindows: { today: [], last5h: [], last7d: [], all: [{ providerId: 'codex', modelLabel: 'same-model', totalTokens: 800, totalAssistantMessages: 1 }] } },
    ],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  const colorMatches = [...html.matchAll(/--model-color:\s*var\(--pf-model-(\d+)\)/g)];
  assert.ok(colorMatches.length > 0, `expected --model-color assignments`);
  const uniqueColors = [...new Set(colorMatches.map(m => m[1]))];
  assert.strictEqual(uniqueColors.length, 1, `same model label 'same-model' should get the same color index, got ${uniqueColors}`);
});

test('dashboard: different model labels receive distinct colors', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 3000, totalAssistantMessages: 3, filesFound: 1,
      modelAggregates: [
        { providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 1 },
        { providerId: 'claude', modelLabel: 'claude-opus-4-20250514', totalTokens: 1200, totalAssistantMessages: 1 },
        { providerId: 'claude', modelLabel: 'claude-haiku-4-20250514', totalTokens: 800, totalAssistantMessages: 1 },
      ],
      localHistoryModelWindows: {
        today: [], last5h: [], last7d: [],
        all: [
          { providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 1000, totalAssistantMessages: 1 },
          { providerId: 'claude', modelLabel: 'claude-opus-4-20250514', totalTokens: 1200, totalAssistantMessages: 1 },
          { providerId: 'claude', modelLabel: 'claude-haiku-4-20250514', totalTokens: 800, totalAssistantMessages: 1 },
        ],
      } }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  const colorMatches = [...html.matchAll(/--model-color:\s*var\(--pf-model-(\d+)\)/g)];
  const uniqueColors = [...new Set(colorMatches.map(m => m[1]))];
  assert.ok(uniqueColors.length >= 2, `different model labels should get different colors, got ${uniqueColors.length}`);
});

test('dashboard: History range does not affect Today section', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 5, filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 125, messages: 1 }, last5h: { tokens: 75, messages: 1 }, last7d: { tokens: 1200, messages: 3 }, all: { tokens: 5000, messages: 5 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('125 tokens'), `expected today tokens in Today section`);
  assert.ok(html.includes('data-today-source-group='), `expected Today section source groups`);
  assert.ok(!html.includes('data-local-window='), `local window selector should not render`);
});

test('dashboard: History range drives model distribution and history chart together', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 5, filesFound: 1,
      modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 5000, totalAssistantMessages: 5 }],
      localHistoryModelWindows: { today: [], last5h: [], last7d: [], all: [{ providerId: 'claude', modelLabel: 'claude-sonnet-4-20250514', totalTokens: 5000, totalAssistantMessages: 5 }] },
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 125, messages: 1 }, last5h: { tokens: 75, messages: 1 }, last7d: { tokens: 1200, messages: 3 }, all: { tokens: 5000, messages: 5 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('data-model-empty-combined-1W='), `model distribution should have 1W range data`);
  assert.ok(html.includes('data-model-empty-combined-1M='), `model distribution should have 1M range data`);
  assert.ok(html.includes('data-model-empty-combined-1Y='), `model distribution should have 1Y range data`);
  assert.ok(html.includes('data-model-empty-combined-ALL='), `model distribution should have ALL range data`);
  assert.ok(html.includes('data-history-range-group="combined-1W"'), `history chart should have 1W range group`);
  assert.ok(html.includes('data-history-range-group="combined-1M"'), `history chart should have 1M range group`);
  assert.ok(html.includes("activeHistoryRange = rangeKey"), `range change should update history range variable`);
  assert.ok(html.includes("updateModelDistributionVisuals()"), `range change should update model distribution`);
  assert.ok(html.includes("updateUsageHistoryCharts()"), `range change should update history charts`);
});

test('dashboard: live quota not affected by History range or dashboard source', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const now = Date.now();
  const status = applyLiveQuotaResults(createInitialStatus(['claude']), [{
    providerId: 'claude',
    windows: [{ windowId: '5h', usedPercentage: 15, remainingPercentage: 85, resetsAtEpochMs: now + 1000 }],
    freshness: 'live',
    lastUpdatedEpochMs: now,
  }]);
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('85% remaining'), `live quota value should be present`);
  assert.ok(html.includes('data-live-quota-card="claude"'), `live quota card should render`);
  assert.ok(!html.includes('data-history-range="5h"'), `live quota window IDs should not appear as history range selectors`);
});

test('dashboard: Today section shows Tokens and Activity cards', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 2, filesFound: 1,
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 100, messages: 1 }, last5h: { tokens: 50, messages: 1 }, last7d: { tokens: 300, messages: 2 }, all: { tokens: 1000, messages: 2 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('metric-label">Tokens'), `Today Tokens card should render`);
  assert.ok(html.includes('metric-label">Activity'), `Today Activity card should render`);
  assert.ok(!html.includes('metric-label">Source'), `Today Source card should not render`);
});

test('dashboard: Provider usage history details section is not rendered', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(!html.includes('provider usage history details'), `provider usage history details should not appear in dashboard`);
  assert.ok(!html.includes('data-provider-local-detail='), `provider local detail attribute should not render`);
});

test('dashboard: parse errors appear as notes in provider tabs, not detail sections', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1, parseErrors: 5 }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  const claudePanel = dashboardTabPanel(html, 'claude');
  assert.ok(claudePanel.includes('Parse errors: 5 lines skipped'), `expected parse error note in Claude tab`);
  assert.ok(claudePanel.includes('parse-error-note'), `expected parse-error-note class`);
  assert.ok(!claudePanel.includes('provider usage history details'), `no details section should render`);
});

test('dashboard: provider hover tooltips attach to history bars and model rows', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 2, filesFound: 1,
      modelAggregates: [{ providerId: 'claude', modelLabel: 'claude-sonnet', totalTokens: 1000, totalAssistantMessages: 2 }],
      localHistoryModelWindows: { today: [], last5h: [], last7d: [], all: [{ providerId: 'claude', modelLabel: 'claude-sonnet', totalTokens: 1000, totalAssistantMessages: 2 }] },
      localHistoryWindows: localHistoryWindowsFixture({ today: { tokens: 100, messages: 1 }, last5h: { tokens: 50, messages: 1 }, last7d: { tokens: 300, messages: 2 }, all: { tokens: 1000, messages: 2 } }) }],
  );
  const model = buildDashboardModel(status);
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('data-pf-tip='), `expected data-pf-tip tooltip attributes`);
  assert.ok(html.includes('&quot;kind&quot;:&quot;history&quot;'), `expected history bar tooltip payloads`);
  assert.ok(html.includes('&quot;kind&quot;:&quot;model&quot;'), `expected model row tooltip payloads`);
  assert.ok(html.includes("pfTipEl.className = 'pf-tip hidden'"), `expected pf-tip element initialization`);
});

test('dashboard: model breakdown progress bars use fixed column alignment', () => {
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const model = buildDashboardModel(createInitialStatus(['claude', 'codex']));
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, model);
  assert.ok(html.includes('10px 52px'), `expected fixed-width swatch and provider columns for bar alignment`);
  const modelRowCss = html.match(/\.usage-model-row\s*\{[^}]+\}/);
  assert.ok(modelRowCss, `expected .usage-model-row CSS rule`);
  assert.ok(!modelRowCss[0].includes('minmax(80px, 1fr)'), `variable-width bar column should not appear in model row grid`);
  assert.ok(!html.includes('class="usage-model-bar"'), `progress bar element should not render in model rows`);
  assert.ok(!html.includes('.usage-model-bar-fill'), `bar fill CSS should be removed`);
});

// === Live quota: formatLiveQuota integration ===

const {
  formatLiveQuotaStatusBarText,
  formatLiveQuotaTooltip,
  hasUsableLiveQuota,
  hasAnyLiveQuota,
  getFreshnessLabel,
  getSanitizedErrorLabel,
  formatCountdownLabel,
  formatWindowLine,
  formatPercentage,
} = require(path.join(OUT, 'core/formatLiveQuota'));

// --- Status bar: live quota preferred ---

test('formatStatusBarText: live quota preferred over local history', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected "Claude" in status bar "${t}"`);
  assert.ok(t.includes('%'), `expected percentage in status bar "${t}"`);
  assert.ok(!t.includes('local'), `should not show "local" suffix when live quota available "${t}"`);
});

test('formatStatusBarText: live quota available shows remaining percentages', () => {
  const now = Date.now();
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [{
    providerId: 'claude',
    windows: [
      { windowId: '5h', usedPercentage: 92 },
      { windowId: '7d', usedPercentage: 72 },
    ],
    freshness: 'live',
    lastUpdatedEpochMs: now,
  }]);
  const t = formatStatusBarText(updated);
  assert.ok(!t.startsWith('PromptFuel'), `live quota status should omit PromptFuel prefix in "${t}"`);
  assert.ok(t.includes('Claude'), `expected provider label in "${t}"`);
  assert.ok(t.includes('7d'), `expected 7d window in "${t}"`);
  assert.ok(t.includes('28%'), `expected 7d remaining percentage in "${t}"`);
  assert.ok(t.includes('5h'), `expected 5h window in "${t}"`);
  assert.ok(t.includes('8%'), `expected 5h remaining percentage in "${t}"`);
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
  assert.ok(!t.includes('displayMode'), `status bar should not mention displayMode "${t}"`);
});

test('formatStatusBarText: single provider shows reset countdown labels when resets exist', () => {
  const now = Date.now();
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [{
    providerId: 'claude',
    windows: [
      { windowId: '5h', usedPercentage: 92, resetsAtEpochMs: now + (4 * 60 + 25) * 60 * 1000 },
      { windowId: '7d', usedPercentage: 72, resetsAtEpochMs: now + (6 * 24 + 5) * 60 * 60 * 1000 },
    ],
    freshness: 'live',
    lastUpdatedEpochMs: now,
  }]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected provider label in "${t}"`);
  assert.ok(t.includes('6d5h'), `expected 7d reset countdown in "${t}"`);
  assert.ok(t.includes('28%'), `expected 7d remaining percentage in "${t}"`);
  assert.ok(t.includes('4h25m'), `expected 5h reset countdown in "${t}"`);
  assert.ok(t.includes('8%'), `expected 5h remaining percentage in "${t}"`);
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
});

test('formatStatusBarText: multiple providers always show countdowns when resets exist', () => {
  const now = Date.now();
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [
        { windowId: '5h', usedPercentage: 45, resetsAtEpochMs: now + (4 * 60 + 25) * 60 * 1000 },
        { windowId: '7d', usedPercentage: 62, resetsAtEpochMs: now + (6 * 24 + 5) * 60 * 60 * 1000 },
      ],
      freshness: 'live',
      lastUpdatedEpochMs: now,
    },
    {
      providerId: 'codex',
      windows: [{ windowId: '5h', usedPercentage: 10, resetsAtEpochMs: now + 60 * 60 * 1000 }],
      freshness: 'live',
      lastUpdatedEpochMs: now,
    },
  ]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected Claude in "${t}"`);
  assert.ok(t.includes('Codex'), `expected Codex in "${t}"`);
  assert.ok(t.includes('6d5h'), `expected Claude 7d countdown in "${t}"`);
  assert.ok(t.includes('4h25m'), `expected Claude 5h countdown in "${t}"`);
  assert.ok(t.includes('1h00m'), `expected Codex countdown in "${t}"`);
  assert.ok(t.includes('38%'), `expected Claude 7d remaining in "${t}"`);
  assert.ok(t.includes('55%'), `expected Claude 5h remaining in "${t}"`);
  assert.ok(t.includes('90%'), `expected Codex remaining in "${t}"`);
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
});

test('formatStatusBarText: enabled-but-not-yet-read shows loading', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: live quota loading');
  assert.ok(!t.includes('local history'), `local history should not mask loading live quota "${t}"`);
});

test('formatStatusBarText: live quota unavailable shows safe state', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'unavailable',
    },
  ]);
  const t = formatStatusBarText(updated);
  assert.strictEqual(t, 'Claude unavailable');
  assert.ok(!t.includes('local history'), `should prefer live quota state over local fallback "${t}"`);
});

test('formatStatusBarText: live quota error shows safe state', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'error',
      error: 'some raw error with /path/to/file.jsonl and secret',
    },
  ]);
  const t = formatStatusBarText(updated);
  assert.strictEqual(t, 'Claude unavailable');
  assert.ok(!t.includes('secret'), `should not leak secrets "${t}"`);
  assert.ok(!t.includes('.jsonl'), `should not leak file paths "${t}"`);
});

test('formatStatusBarText: multiple providers with live quota show remaining values', () => {
  const codexLiveQuota = {
    providerId: 'codex',
    windows: [
      {
        windowId: '5h',
        usedPercentage: 0,
        resetsAtEpochMs: Date.now() + 5 * 60 * 60 * 1000,
      },
    ],
    freshness: 'live',
    lastUpdatedEpochMs: Date.now(),
  };
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota, codexLiveQuota]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected "Claude" "${t}"`);
  assert.ok(t.includes('Codex'), `expected "Codex" "${t}"`);
  assert.ok(t.includes('38%'), `expected Claude 7d remaining in "${t}"`);
  assert.ok(t.includes('55%'), `expected Claude 5h remaining in "${t}"`);
  assert.ok(t.includes('100%'), `expected Codex remaining in "${t}"`);
  assert.ok(t.includes('5h00m'), `expected reset countdown in "${t}"`);
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
});

test('formatStatusBarText: stale quota keeps quota display without stale marker', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [{
    providerId: 'claude',
    windows: [
      { windowId: '5h', usedPercentage: 92 },
      { windowId: '7d', usedPercentage: 72 },
    ],
    freshness: 'stale',
  }]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected provider label in "${t}"`);
  assert.ok(!t.includes('stale'), `status bar should not show stale marker in "${t}"`);
  assert.ok(t.includes('28%'), `expected 7d remaining percentage in "${t}"`);
  assert.ok(t.includes('8%'), `expected 5h remaining percentage in "${t}"`);
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
});

test('formatStatusBarText: mixed Claude stale and Codex live shows both providers', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [
        { windowId: '5h', usedPercentage: 92 },
        { windowId: '7d', usedPercentage: 72 },
      ],
      freshness: 'stale',
    },
    {
      providerId: 'codex',
      windows: [
        { windowId: '5h', usedPercentage: 15 },
        { windowId: '7d', usedPercentage: 27 },
      ],
      freshness: 'live',
    },
  ]);
  const t = formatStatusBarText(updated);
  assert.ok(t.includes('Claude'), `expected Claude in "${t}"`);
  assert.ok(t.includes('Codex'), `expected Codex in "${t}"`);
  assert.ok(!t.includes('stale'), `status bar should not show stale marker in "${t}"`);
  for (const expected of ['28%', '8%', '73%', '85%']) {
    assert.ok(t.includes(expected), `expected remaining percentage ${expected} in "${t}"`);
  }
  assert.ok(!t.includes('used'), `status bar should not show used quota "${t}"`);
});

// --- Tooltip: live quota sections ---

test('formatTooltip: live quota shows provider sections', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('Claude'), `expected "Claude" in tooltip`);
  assert.ok(tooltip.includes('# PromptFuel'), `expected PromptFuel title`);
  assert.ok(!tooltip.includes('# PromptFuel Quota'), `tooltip title should not repeat Quota`);
  assert.ok(tooltip.includes('## Quota'), `expected quota section`);
  assert.ok(!tooltip.includes('| Provider | Window |'), `quota table header should not show text labels`);
  assert.ok(tooltip.includes('| Claude | 7d |'), `expected Claude 7d quota row`);
  assert.ok(tooltip.includes('| LIVE |'), `expected LIVE state marker`);
  assert.ok(tooltip.includes('<span style="color:'), `expected colored quota bar in tooltip`);
  assert.ok(/\u25B0/.test(tooltip), `expected filled quota bar segments in tooltip`);
  assert.ok(!tooltip.includes('Live quota not enabled yet'), `should not show "not enabled" when live quota present`);
  assert.ok(!tooltip.includes('displayMode'), `tooltip should not mention displayMode`);
});

test('formatTooltip: live and unavailable mixed state is sanitized', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [
    syntheticLiveQuota,
    {
      providerId: 'codex',
      windows: [],
      freshness: 'error',
      error: 'raw provider failure /private/session.jsonl secret-token',
    },
  ]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('| Claude | 7d |'), `expected Claude quota row`);
  assert.ok(tooltip.includes('| LIVE |'), `expected Claude live state`);
  assert.ok(tooltip.includes('| Codex | - | \u26AB | Live quota unavailable |  | - | UNAVAILABLE |'), `expected Codex unavailable row`);
  assert.ok(tooltip.includes('Live quota unavailable'), `expected sanitized unavailable message`);
  assert.ok(!tooltip.includes('secret-token'), `should not leak raw provider error`);
  assert.ok(!tooltip.includes('.jsonl'), `should not leak filenames`);
});

test('formatTooltip: stale and live mixed state shows cached note', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [
        { windowId: '5h', usedPercentage: 92, remainingPercentage: 8 },
        { windowId: '7d', usedPercentage: 72, remainingPercentage: 28 },
      ],
      freshness: 'stale',
      lastUpdatedEpochMs: Date.now(),
    },
    {
      providerId: 'codex',
      windows: [
        { windowId: '5h', usedPercentage: 15, remainingPercentage: 85 },
        { windowId: '7d', usedPercentage: 27, remainingPercentage: 73 },
      ],
      freshness: 'live',
      lastUpdatedEpochMs: Date.now(),
    },
  ]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('| Claude | 7d | \uD83D\uDFE0 | **28%**'), `expected Claude stale 7d row`);
  assert.ok(tooltip.includes('| STALE |'), `expected STALE state marker`);
  assert.ok(tooltip.includes('| Codex | 7d | \uD83D\uDFE2 | **73%**'), `expected Codex live 7d row`);
  assert.ok(tooltip.includes('| LIVE |'), `expected LIVE state marker`);
  assert.ok(tooltip.includes('| Claude | 5h | \uD83D\uDD34 | **8%**'), `expected 5h remaining`);
  assert.ok(tooltip.includes('| Codex | 7d | \uD83D\uDFE2 | **73%**'), `expected 7d remaining`);
  assert.ok(!tooltip.includes('used'), `tooltip should not show used quota`);
});

test('formatTooltip: disabled provider sections shown', () => {
  const status = createInitialStatus(['claude', 'codex'], false);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Live quota disabled'), `expected disabled top state`);
  assert.ok(tooltip.includes('| Claude | - | \u26AB | Live quota disabled |  | - | DISABLED |'), `expected Claude disabled row`);
  assert.ok(tooltip.includes('| Codex | - | \u26AB | Live quota disabled |  | - | DISABLED |'), `expected Codex disabled row`);
});

test('formatTooltip: live quota error shows sanitized label', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'error',
      error: 'some raw error with /path/to/file.jsonl and secret username:admin',
    },
  ]);
  const tooltip = formatTooltip(updated);
  assert.ok(!tooltip.includes('secret'), `should not leak secrets`);
  assert.ok(!tooltip.includes('.jsonl'), `should not leak file paths`);
  assert.ok(!tooltip.includes('username'), `should not leak usernames`);
  assert.ok(!tooltip.includes('admin'), `should not leak credentials`);
  assert.ok(tooltip.includes(getSanitizedErrorLabel()), `expected sanitized error label`);
});

test('formatTooltip: live quota shows Live quota refreshed timestamp', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('Live quota refreshed:'), `expected "Live quota refreshed:" in tooltip`);
});

test('formatTooltip: live quota shows Local history refreshed timestamp', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('Local history refreshed:'), `expected "Local history refreshed:" in tooltip`);
});

test('applyLiveQuotaResults: preserves local history timestamp separately', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const localHistoryRefreshed = status.localHistoryLastRefreshedMs;
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  assert.strictEqual(updated.localHistoryLastRefreshedMs, localHistoryRefreshed);
  assert.ok(typeof updated.liveQuotaLastRefreshedMs === 'number', 'expected live quota timestamp');
});

test('applyLiveQuotaResults: normalizes window labels, reset countdown, and status', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const window = updated.liveQuotaStates[0].windows[0];
  assert.strictEqual(window.label, '5h');
  assert.strictEqual(window.status, 'available');
  assert.ok(typeof window.resetInMs === 'number', 'expected resetInMs');
});

test('applyLiveQuotaResults: stores sanitized unavailable message only', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'error',
      error: 'raw /path/to/file.jsonl secret-token',
    },
  ]);
  const liveState = updated.liveQuotaStates[0];
  assert.strictEqual(liveState.status, 'error');
  assert.strictEqual(liveState.sanitizedMessage, 'Live quota unavailable');
  assert.strictEqual(liveState.error, undefined);
});

test('formatTooltip: stale freshness shown correctly', () => {
  const staleLiveQuota = {
    ...syntheticLiveQuota,
    freshness: 'stale',
  };
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [staleLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('STALE'), `expected "STALE" freshness in tooltip`);
  assert.ok(tooltip.includes('| STALE |'), `expected stale quota row`);
  assert.ok(!tooltip.includes('used'), `tooltip should not show used quota`);
});

test('formatTooltip: cached freshness shown correctly', () => {
  const cachedLiveQuota = {
    ...syntheticLiveQuota,
    freshness: 'cached',
  };
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [cachedLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('CACHED'), `expected "CACHED" freshness in tooltip`);
});

test('formatTooltip: snapshot quota shows 7d and 5h rows with age note', () => {
  const generatedAtEpochMs = Date.now() - 5 * 60 * 1000;
  const status = applySnapshotReadResults(createInitialStatus(['codex']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'codex',
      generatedAtEpochMs,
      snapshotLaneLabel: 'Remote Codex',
      sevenDayUsedPercent: 27,
      fiveHourUsedPercent: 92,
      sevenDayResetAtEpochSeconds: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
      fiveHourResetAtEpochSeconds: Math.floor((Date.now() + 5 * 60 * 60 * 1000) / 1000),
    }),
  ]));
  const tooltip = formatTooltip(status);
  const sevenDayIndex = tooltip.indexOf('| Remote Codex | 7d | \uD83D\uDFE2 | **73%**');
  const fiveHourIndex = tooltip.indexOf('| Remote Codex | 5h | \uD83D\uDD34 | **8%**');
  assert.ok(sevenDayIndex >= 0, `expected snapshot 7d row in tooltip`);
  assert.ok(fiveHourIndex >= 0, `expected snapshot 5h row in tooltip`);
  assert.ok(sevenDayIndex < fiveHourIndex, `expected snapshot 7d row before 5h row`);
  assert.ok(tooltip.includes('snap 5m ago'), `expected snapshot age note in tooltip`);
});

test('formatTooltip: snapshot quota with one window shows one row', () => {
  const status = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'claude',
      generatedAtEpochMs: Date.now() - 60 * 1000,
      snapshotLaneLabel: 'Remote Claude',
      sevenDayUsedPercent: 10,
    }),
  ]));
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('| Remote Claude | 7d | \uD83D\uDD35 | **90%**'), `expected one snapshot 7d row`);
  assert.ok(!tooltip.includes('| Remote Claude | 5h |'), `should not invent missing snapshot 5h row`);
});

test('formatTooltip: stale snapshot quota shows stale note', () => {
  const status = applySnapshotReadResults(createInitialStatus(['codex']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'codex',
      generatedAtEpochMs: Date.now() - 60 * 60 * 1000,
      snapshotLaneLabel: 'Remote Codex',
      sevenDayUsedPercent: 55,
      snapshotStale: true,
    }),
  ]));
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('snap \u26A0 stale'), `expected stale snapshot note`);
});

test('formatStatusBarText: snapshot quota is appended after live quota', () => {
  const withSnapshot = applySnapshotReadResults(createInitialStatus(['claude', 'codex']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'codex',
      generatedAtEpochMs: Date.now() - 2 * 60 * 1000,
      snapshotLaneLabel: 'Remote Codex',
      sevenDayUsedPercent: 10,
    }),
  ]));
  const status = applyLiveQuotaResults(withSnapshot, [syntheticLiveQuota]);
  const text = formatStatusBarText(status);
  const liveIndex = text.indexOf('Claude');
  const snapshotIndex = text.indexOf('Remote Codex \uD83D\uDD3590%');
  assert.ok(liveIndex >= 0, `expected live quota in status bar "${text}"`);
  assert.ok(snapshotIndex > liveIndex, `expected snapshot quota after live quota "${text}"`);
  assert.ok(text.includes(' | '), `expected provider separator in "${text}"`);
});

test('formatStatusBarText: matching live and imported providers both render', () => {
  const withSnapshot = applySnapshotReadResults(createInitialStatus(['claude']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'claude',
      generatedAtEpochMs: Date.now() - 2 * 60 * 1000,
      snapshotLaneLabel: 'Remote Claude',
      sevenDayUsedPercent: 10,
    }),
  ]));
  const status = applyLiveQuotaResults(withSnapshot, [syntheticLiveQuota]);
  const text = formatStatusBarText(status);
  assert.ok(text.includes('Claude'), `expected live Claude quota in "${text}"`);
  assert.ok(text.includes('Remote Claude \uD83D\uDD3590%'), `matching imported provider should remain visible in "${text}"`);
});

test('formatTooltip and status bar omit snapshots without quota windows', () => {
  const status = applySnapshotReadResults(createInitialStatus(['codex']), snapshotStateFixture([
    snapshotQuotaProvider({
      providerId: 'codex',
      generatedAtEpochMs: Date.now() - 2 * 60 * 1000,
      snapshotLaneLabel: 'Remote Codex',
    }),
  ]));
  const tooltip = formatTooltip(status);
  const text = formatStatusBarText(status);
  assert.ok(!tooltip.includes('| Remote Codex | 7d |'), `should not render missing snapshot 7d row`);
  assert.ok(!tooltip.includes('| Remote Codex | 5h |'), `should not render missing snapshot 5h row`);
  assert.strictEqual(text, 'PromptFuel: live quota loading');
});

test('snapshot imports: quota-only provider renders remaining in bar, tooltip, and dashboard', () => {
  const now = Date.now();
  const validation = validatePromptFuelSnapshotPayload({
    schemaVersion: 2,
    generatedAtEpochMs: now - 2 * 60 * 1000,
    machine: { label: 'snapshot import' },
    providerUsage: [{
      provider: 'codex',
      laneLabel: 'Remote Codex',
      sevenDayUsedPercent: 25,
      fiveHourUsedPercent: 90,
      sevenDayResetAtEpochSeconds: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
      fiveHourResetAtEpochSeconds: Math.floor((now + 5 * 60 * 60 * 1000) / 1000),
      stale: false,
    }],
  }, new Set(['codex']), now);
  assert.strictEqual(validation.malformed, false);
  assert.ok(validation.snapshot, `expected quota-only import to validate`);
  assert.strictEqual(validation.snapshot.providers.length, 1);
  assert.strictEqual(validation.snapshot.providers[0].aggregate.totalTokens, 0);
  assert.strictEqual(validation.snapshot.providers[0].sevenDayUsedPercent, 25);

  const status = applySnapshotReadResults(createInitialStatus(['codex']), snapshotStateFixture(validation.snapshot.providers));
  const text = formatStatusBarText(status);
  const tooltip = formatTooltip(status);
  const { buildDashboardHtml } = require(path.join(OUT, 'panel/dashboardHtml'));
  const html = buildDashboardHtml({ cspSource: 'http://example.com' }, buildDashboardModel(status));

  assert.ok(text.includes('snapshot import Remote Codex 7d0h \uD83D\uDFE275%'), `expected imported 7d countdown and remaining in status bar "${text}"`);
  assert.ok(text.includes('5h00m \uD83D\uDFE010%'), `expected imported 5h countdown and remaining in status bar "${text}"`);
  assert.ok(tooltip.includes('| snapshot import Remote Codex | 7d | \uD83D\uDFE2 | **75%**'), `expected imported 7d remaining in tooltip`);
  assert.ok(tooltip.includes('| snapshot import Remote Codex | 5h | \uD83D\uDFE0 | **10%**'), `expected imported 5h remaining in tooltip`);
  assert.ok(html.includes('Snapshot quota: snapshot import Remote Codex: 7d 75% remaining / 5h 10% remaining'), `expected imported remaining in dashboard`);
});

// --- Helper: freshness labels ---

test('getFreshnessLabel: returns correct labels', () => {
  assert.strictEqual(getFreshnessLabel('live'), 'live');
  assert.strictEqual(getFreshnessLabel('cached'), 'cached');
  assert.strictEqual(getFreshnessLabel('stale'), 'stale');
  assert.strictEqual(getFreshnessLabel('unavailable'), 'unavailable');
  assert.strictEqual(getFreshnessLabel('error'), 'error');
});

// --- Helper: countdown formatting ---

test('formatCountdownLabel: positive countdown', () => {
  const reset = Date.now() + 3 * 60 * 60 * 1000;
  const label = formatCountdownLabel(reset, Date.now());
  assert.ok(label.includes('3h'), `expected "3h" in countdown "${label}"`);
});

test('formatCountdownLabel: past reset shows reset', () => {
  const reset = Date.now() - 1000;
  const label = formatCountdownLabel(reset, Date.now());
  assert.strictEqual(label, 'reset');
});

test('formatCountdownLabel: days and hours', () => {
  const reset = Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000;
  const label = formatCountdownLabel(reset, Date.now());
  assert.ok(label.includes('2d'), `expected "2d" in countdown "${label}"`);
});

// --- Helper: window line formatting ---

test('formatWindowLine: includes window ID and remaining percentage', () => {
  const window = {
    windowId: '5h',
    remainingPercentage: 55,
    resetsAtEpochMs: Date.now() + 5 * 60 * 60 * 1000,
  };
  const line = formatWindowLine(window, Date.now());
  assert.ok(line.includes('5h'), `expected "5h" in "${line}"`);
  assert.ok(line.includes('55%'), `expected "55%" in "${line}"`);
  assert.ok(line.includes('remaining'), `expected "remaining" in "${line}"`);
  assert.ok(line.includes('resets in'), `expected reset countdown in "${line}"`);
  assert.ok(!line.includes('used'), `should not show used quota in "${line}"`);
});

test('formatWindowLine: derives remaining percentage when only used is available', () => {
  const window = {
    windowId: '7d',
    usedPercentage: 40,
  };
  const line = formatWindowLine(window, Date.now());
  assert.ok(line.includes('60% remaining'), `expected derived remaining in "${line}"`);
  assert.ok(!line.includes('used'), `should not show used quota in "${line}"`);
});

// --- Helper: percentage formatting ---

test('formatPercentage: rounds correctly', () => {
  assert.strictEqual(formatPercentage(45.6), '46%');
  assert.strictEqual(formatPercentage(0), '0%');
  assert.strictEqual(formatPercentage(100), '100%');
});

test('formatPercentage: undefined returns undefined', () => {
  assert.strictEqual(formatPercentage(undefined), undefined);
});

// --- Utility: hasUsableLiveQuota ---

test('hasUsableLiveQuota: true when live freshness', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  assert.strictEqual(hasUsableLiveQuota(updated), true);
});

test('hasUsableLiveQuota: false when unavailable', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    { providerId: 'claude', windows: [], freshness: 'unavailable' },
  ]);
  assert.strictEqual(hasUsableLiveQuota(updated), false);
});

test('hasUsableLiveQuota: false when empty', () => {
  const status = createInitialStatus(['claude']);
  assert.strictEqual(hasUsableLiveQuota(status), false);
});

// --- Utility: hasAnyLiveQuota ---

test('hasAnyLiveQuota: true when any state present', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  assert.strictEqual(hasAnyLiveQuota(updated), true);
});

test('hasAnyLiveQuota: true for unavailable state', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    { providerId: 'claude', windows: [], freshness: 'unavailable' },
  ]);
  assert.strictEqual(hasAnyLiveQuota(updated), true);
});

test('hasAnyLiveQuota: false when empty', () => {
  const status = createInitialStatus(['claude']);
  assert.strictEqual(hasAnyLiveQuota(status), false);
});

// --- Safety: no raw error strings in status bar ---

test('formatStatusBarText: raw error not surfaced', () => {
  const rawError = 'connection refused at /path/to/api/endpoint.jsonl user:admin';
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'error',
      error: rawError,
    },
  ]);
  const t = formatStatusBarText(updated);
  assert.ok(!t.includes('connection'), `should not include raw error text "${t}"`);
  assert.ok(!t.includes('refused'), `should not include raw error text "${t}"`);
  assert.ok(!t.includes('.jsonl'), `should not include file paths "${t}"`);
  assert.ok(!t.includes('admin'), `should not include credentials "${t}"`);
});

// --- Safety: no raw error strings in tooltip ---

test('formatTooltip: raw error not surfaced', () => {
  const rawError = 'ECONNREFUSED /path/to/file.jsonl credentials:secret123';
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [
    {
      providerId: 'claude',
      windows: [],
      freshness: 'error',
      error: rawError,
    },
  ]);
  const tooltip = formatTooltip(updated);
  assert.ok(!tooltip.includes('ECONNREFUSED'), `should not include raw error code`);
  assert.ok(!tooltip.includes('.jsonl'), `should not include file paths`);
  assert.ok(!tooltip.includes('credentials'), `should not include credential keywords`);
  assert.ok(!tooltip.includes('secret123'), `should not include secrets`);
});

// Summary
console.log('');
console.log(`smoke-core: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
