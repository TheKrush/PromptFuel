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

test('CONFIG_DEFAULTS.refreshIntervalSeconds default', () => {
  assert.strictEqual(CONFIG_DEFAULTS.refreshIntervalSeconds, 300);
});

// --- formatQuota ---
const { formatProviderText, formatStatusBarText } = require(path.join(OUT, 'core/formatQuota'));

test('formatProviderText: no-data shows label and dash', () => {
  const t = formatProviderText({ providerId: 'claude', status: 'no-data' });
  assert.ok(t.includes('Claude'), `expected "Claude" in "${t}"`);
  assert.ok(t.includes('—'), `expected "—" in "${t}"`);
});

test('formatProviderText: disabled returns empty string', () => {
  const t = formatProviderText({ providerId: 'claude', status: 'disabled' });
  assert.strictEqual(t, '');
});

test('formatProviderText: unknown shows label and ellipsis', () => {
  const t = formatProviderText({ providerId: 'codex', status: 'unknown' });
  assert.ok(t.includes('Codex'), `expected "Codex" in "${t}"`);
  assert.ok(t.includes('…'), `expected "…" in "${t}"`);
});

test('formatStatusBarText: all disabled returns PromptFuel', () => {
  const t = formatStatusBarText([
    { providerId: 'claude', status: 'disabled' },
    { providerId: 'codex', status: 'disabled' },
  ]);
  assert.strictEqual(t, 'PromptFuel');
});

test('formatStatusBarText: empty array returns PromptFuel', () => {
  const t = formatStatusBarText([]);
  assert.strictEqual(t, 'PromptFuel');
});

test('formatStatusBarText: no-data states include fuel emoji prefix', () => {
  const t = formatStatusBarText([
    { providerId: 'claude', status: 'no-data' },
    { providerId: 'codex', status: 'no-data' },
  ]);
  assert.ok(t.startsWith('⛽'), `expected "⛽" prefix in "${t}"`);
});

test('formatStatusBarText: no-data includes Claude', () => {
  const t = formatStatusBarText([{ providerId: 'claude', status: 'no-data' }]);
  assert.ok(t.includes('Claude'), `expected "Claude" in "${t}"`);
});

test('formatStatusBarText: unknown includes Codex', () => {
  const t = formatStatusBarText([{ providerId: 'codex', status: 'unknown' }]);
  assert.ok(t.includes('Codex'), `expected "Codex" in "${t}"`);
});

test('formatStatusBarText: mixed enabled providers joined with pipe', () => {
  const t = formatStatusBarText([
    { providerId: 'claude', status: 'no-data' },
    { providerId: 'codex', status: 'no-data' },
  ]);
  assert.ok(t.includes(' | '), `expected " | " separator in "${t}"`);
});

// Summary
console.log('');
console.log(`smoke-core: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
