'use strict';

const path = require('path');
const assert = require('assert');

const OUT = path.resolve(__dirname, '../out');

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

test('CONFIG_DEFAULTS.displayMode default', () => {
  assert.strictEqual(CONFIG_DEFAULTS.displayMode, 'compact');
});

test('CONFIG_DEFAULTS.refreshIntervalMinutes default', () => {
  assert.strictEqual(CONFIG_DEFAULTS.refreshIntervalMinutes, 5);
});

test('CONFIG_DEFAULTS.refreshIntervalMinutes is number', () => {
  assert.strictEqual(typeof CONFIG_DEFAULTS.refreshIntervalMinutes, 'number');
});

// === Config: interface shape ===

test('CONFIG_DEFAULTS has expected keys', () => {
  const keys = Object.keys(CONFIG_DEFAULTS).sort();
  assert.deepStrictEqual(keys, ['displayMode', 'enabledProviders', 'liveQuotaEnabled', 'refreshIntervalMinutes']);
});

// --- formatQuota ---
const { formatStatusBarText, formatRefreshSummary, formatTokenCount } = require(path.join(OUT, 'core/formatQuota'));
const { formatTooltip } = require(path.join(OUT, 'core/statusTooltip'));
const { createInitialStatus, applyRefreshResults } = require(path.join(OUT, 'core/statusModel'));

// === Status bar text: all no-data ===

test('formatStatusBarText: all disabled returns local history label', () => {
  const status = createInitialStatus([]);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: local history');
});

test('formatStatusBarText: all no-data returns local history label', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: local history');
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

test('formatStatusBarText: loaded shows compact aggregate with local suffix', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('5.0K'), `expected "5.0K" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
  assert.ok(!t.includes(' | '), `should not include per-provider pipe separator in "${t}"`);
});

test('formatStatusBarText: error/unknown returns refresh failed', () => {
  const status = applyRefreshResults(
    createInitialStatus(['codex']),
    [{ providerId: 'codex', status: 'error' }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: refresh failed');
});

test('formatStatusBarText: mixed providers shows single aggregate', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'not-found' },
    ],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.startsWith('PromptFuel:'), `expected "PromptFuel:" prefix in "${t}"`);
  assert.ok(t.includes('5.0K'), `expected aggregate "5.0K" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
  assert.ok(!t.includes(' | '), `should not include per-provider pipe separator in "${t}"`);
});

// === Status bar text: both loaded ===

test('formatStatusBarText: both loaded shows single aggregate total', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3100, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('15.5K'), `expected aggregate "15.5K" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
  assert.ok(!t.includes(' | '), `should not include per-provider pipe separator in "${t}"`);
});

// === Status bar text: large token formatting ===

test('formatStatusBarText: large token counts use M suffix', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 2500000, totalAssistantMessages: 10, filesFound: 5 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('2.5M'), `expected "2.5M" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
});

test('formatStatusBarText: billion token counts use B suffix', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 6700000000, totalAssistantMessages: 10, filesFound: 5 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('6.7B'), `expected "6.7B" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
});

test('formatStatusBarText: small token counts show raw number', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('500'), `expected "500" in "${t}"`);
  assert.ok(t.includes('local history'), `expected "local history" suffix in "${t}"`);
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
  assert.ok(tooltip.includes('Parse errors: 3'), `expected "Parse errors: 3" in tooltip`);
});

test('formatTooltip: no parse errors when clean', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const tooltip = formatTooltip(status);
  assert.ok(!tooltip.includes('Parse errors'), `should not show parse errors when 0`);
});

test('formatTooltip: total tokens and messages shown for loaded providers', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Total local history:'), `expected "Total local history:" in tooltip`);
  assert.ok(tooltip.includes('15.0K'), `expected "15.0K" total in tooltip`);
  assert.ok(tooltip.includes('5 messages'), `expected "5 messages" total in tooltip`);
});

// === Tooltip: local history disclaimers ===

test('formatTooltip: includes Local history only disclaimer', () => {
  const status = createInitialStatus(['claude']);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Local history only'), `expected "Local history only" in tooltip`);
});

test('formatTooltip: includes Live quota not enabled disclaimer', () => {
  const status = createInitialStatus(['claude']);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Live quota not enabled yet'), `expected "Live quota not enabled yet" in tooltip`);
});

test('formatTooltip: includes Snapshots not included disclaimer', () => {
  const status = createInitialStatus(['claude']);
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Snapshots not included'), `expected "Snapshots not included" in tooltip`);
});

// === Tooltip: provider splits still exist ===

test('formatTooltip: provider token splits still present', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const tooltip = formatTooltip(status);
  assert.ok(tooltip.includes('Claude'), `expected "Claude" provider line in tooltip`);
  assert.ok(tooltip.includes('Codex'), `expected "Codex" provider line in tooltip`);
  assert.ok(tooltip.includes('10.0K'), `expected "10.0K" for Claude in tooltip`);
  assert.ok(tooltip.includes('5.0K'), `expected "5.0K" for Codex in tooltip`);
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
  assert.ok(s.includes('3 parse errors'), `expected "3 parse errors" in "${s}"`);
});

test('formatRefreshSummary: single parse error uses singular', () => {
  const s = formatRefreshSummary([{
    providerId: 'claude',
    status: 'ok',
    totalAssistantMessages: 1,
    totalTokens: 200,
    parseErrors: 1,
  }]);
  assert.ok(s.includes('1 parse error'), `expected "1 parse error" in "${s}"`);
  assert.ok(!s.includes('1 parse errors'), `expected no plural "1 parse errors" in "${s}"`);
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

const fs = require('fs');

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

const { buildDashboardModel } = require(path.join(OUT, 'panel/dashboardModel'));

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
  assert.ok(html.includes('Usage overview'), `expected "Usage overview" subtitle`);
  assert.ok(html.includes('Local history tokens'), `expected "Local history tokens" overview label`);
  assert.ok(html.includes('Local history messages'), `expected "Local history messages" overview label`);
  assert.ok(!html.includes('subscription'), `should not include "subscription"`);
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
  assert.ok(html.includes('live quota from provider APIs'), `expected live quota disclaimer in HTML`);
  assert.ok(html.includes('local history from session files'), `expected local history disclaimer in HTML`);
  assert.ok(html.includes('Snapshots'), `expected "Snapshots" disclaimer in HTML`);
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
  assert.ok(t.includes('5h'), `expected "5h" window in status bar "${t}"`);
  assert.ok(!t.includes('local'), `should not show "local" suffix when live quota available "${t}"`);
});

test('formatStatusBarText: fallback to local history when no live quota', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('local history'), `expected "local history" suffix "${t}"`);
});

test('formatStatusBarText: live quota unavailable falls back to local history', () => {
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
  assert.ok(t.includes('local history'), `expected "local history" suffix when live quota unavailable "${t}"`);
});

test('formatStatusBarText: live quota error falls back to local history', () => {
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
  assert.ok(t.includes('local history'), `expected "local history" suffix when live quota error "${t}"`);
  assert.ok(!t.includes('secret'), `should not leak secrets "${t}"`);
  assert.ok(!t.includes('.jsonl'), `should not leak file paths "${t}"`);
});

test('formatStatusBarText: both providers with live quota show both', () => {
  const codexLiveQuota = {
    providerId: 'codex',
    windows: [
      {
        windowId: '5h',
        remainingPercentage: 80,
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
});

// --- Tooltip: live quota sections ---

test('formatTooltip: live quota shows provider sections', () => {
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [syntheticLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('Claude'), `expected "Claude" in tooltip`);
  assert.ok(tooltip.includes('live'), `expected "live" freshness in tooltip`);
  assert.ok(tooltip.includes('Local history + live quota'), `expected combined mode label`);
  assert.ok(!tooltip.includes('Live quota not enabled yet'), `should not show "not enabled" when live quota present`);
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
  assert.ok(tooltip.includes('stale'), `expected "stale" freshness in tooltip`);
});

test('formatTooltip: cached freshness shown correctly', () => {
  const cachedLiveQuota = {
    ...syntheticLiveQuota,
    freshness: 'cached',
  };
  const status = createInitialStatus(['claude']);
  const updated = applyLiveQuotaResults(status, [cachedLiveQuota]);
  const tooltip = formatTooltip(updated);
  assert.ok(tooltip.includes('cached'), `expected "cached" freshness in tooltip`);
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
});

test('formatWindowLine: used percentage when no remaining', () => {
  const window = {
    windowId: '7d',
    usedPercentage: 40,
  };
  const line = formatWindowLine(window, Date.now());
  assert.ok(line.includes('40%'), `expected "40%" in "${line}"`);
  assert.ok(line.includes('used'), `expected "used" in "${line}"`);
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
