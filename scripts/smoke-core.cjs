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
  assert.deepStrictEqual(keys, ['displayMode', 'enabledProviders', 'refreshIntervalMinutes']);
});

// --- formatQuota ---
const { formatStatusBarText, formatRefreshSummary, formatTokenCount } = require(path.join(OUT, 'core/formatQuota'));
const { formatTooltip } = require(path.join(OUT, 'core/statusTooltip'));
const { createInitialStatus, applyRefreshResults } = require(path.join(OUT, 'core/statusModel'));

// === Status bar text: all no-data ===

test('formatStatusBarText: all disabled returns no local usage', () => {
  const status = createInitialStatus([]);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: no local usage');
});

test('formatStatusBarText: all no-data returns no local usage', () => {
  const status = createInitialStatus(['claude', 'codex']);
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: no local usage');
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

test('formatStatusBarText: loaded includes Claude label and compact tokens', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('Claude'), `expected "Claude" in "${t}"`);
  assert.ok(t.includes('5.0K'), `expected "5.0K" in "${t}"`);
});

test('formatStatusBarText: error/unknown returns refresh failed', () => {
  const status = applyRefreshResults(
    createInitialStatus(['codex']),
    [{ providerId: 'codex', status: 'error' }],
  );
  const t = formatStatusBarText(status);
  assert.strictEqual(t, 'PromptFuel: refresh failed');
});

test('formatStatusBarText: mixed providers joined with pipe', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
      { providerId: 'codex', status: 'not-found' },
    ],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.startsWith('PromptFuel:'), `expected "PromptFuel:" prefix in "${t}"`);
  assert.ok(t.includes(' | '), `expected " | " separator in "${t}"`);
});

// === Status bar text: both loaded ===

test('formatStatusBarText: both loaded shows compact summary', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude', 'codex']),
    [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3100, totalAssistantMessages: 2, filesFound: 1 },
    ],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('Claude'), `expected "Claude" in "${t}"`);
  assert.ok(t.includes('12.4K'), `expected "12.4K" in "${t}"`);
  assert.ok(t.includes('Codex'), `expected "Codex" in "${t}"`);
  assert.ok(t.includes('3.1K'), `expected "3.1K" in "${t}"`);
});

// === Status bar text: large token formatting ===

test('formatStatusBarText: large token counts use M suffix', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 2500000, totalAssistantMessages: 10, filesFound: 5 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('2.5M'), `expected "2.5M" in "${t}"`);
});

test('formatStatusBarText: small token counts show raw number', () => {
  const status = applyRefreshResults(
    createInitialStatus(['claude']),
    [{ providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1 }],
  );
  const t = formatStatusBarText(status);
  assert.ok(t.includes('500'), `expected "500" in "${t}"`);
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
  assert.ok(tooltip.includes('Total:'), `expected "Total:" in tooltip`);
  assert.ok(tooltip.includes('15.0K'), `expected "15.0K" total in tooltip`);
  assert.ok(tooltip.includes('5 messages'), `expected "5 messages" total in tooltip`);
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

test('formatRefreshSummary: no-data shows no local usage', () => {
  const s = formatRefreshSummary([{ providerId: 'codex', status: 'no-data' }]);
  assert.ok(s.includes('no local usage'), `expected "no local usage" in "${s}"`);
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
  assert.ok(html.includes('Local usage history'), `expected "Local usage history" subtitle`);
  assert.ok(!html.includes('subscription'), `should not include "subscription"`);
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

// Summary
console.log('');
console.log(`smoke-core: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
