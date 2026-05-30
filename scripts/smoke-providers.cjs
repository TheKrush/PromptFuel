'use strict';

const path = require('path');
const os = require('os');
const assert = require('assert');

const OUT = path.resolve(__dirname, '../out');

const { ClaudeLocalReader } = require(path.join(OUT, 'providers/claudeLocal'));
const { CodexLocalReader } = require(path.join(OUT, 'providers/codexLocal'));
const { runEnabledReaders } = require(path.join(OUT, 'providers/readProviders'));
const { formatRefreshSummary } = require(path.join(OUT, 'core/formatQuota'));

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    fail++;
  }
}

const ABSENT = path.join(os.tmpdir(), `pf-smoke-absent-${Date.now()}`);

async function main() {
  // --- ClaudeLocalReader ---

  await test('ClaudeLocalReader: returns not-found for absent path', async () => {
    const reader = new ClaudeLocalReader(ABSENT);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'claude');
    assert.strictEqual(result.status, 'not-found');
  });

  await test('ClaudeLocalReader: providerId is claude', async () => {
    const reader = new ClaudeLocalReader(ABSENT);
    assert.strictEqual(reader.providerId, 'claude');
  });

  // --- CodexLocalReader ---

  await test('CodexLocalReader: returns not-found for absent path', async () => {
    const reader = new CodexLocalReader(ABSENT);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'codex');
    assert.strictEqual(result.status, 'not-found');
  });

  await test('CodexLocalReader: providerId is codex', async () => {
    const reader = new CodexLocalReader(ABSENT);
    assert.strictEqual(reader.providerId, 'codex');
  });

  // --- runEnabledReaders ---

  await test('runEnabledReaders: empty enabledProviders returns empty array', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, []);
    assert.strictEqual(results.length, 0);
  });

  await test('runEnabledReaders: only enabled providers run', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['claude']);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].providerId, 'claude');
  });

  await test('runEnabledReaders: unknown provider id is skipped', async () => {
    const readers = [new ClaudeLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['openai']);
    assert.strictEqual(results.length, 0);
  });

  await test('runEnabledReaders: both providers run when both enabled', async () => {
    const readers = [new ClaudeLocalReader(ABSENT), new CodexLocalReader(ABSENT)];
    const results = await runEnabledReaders(readers, ['claude', 'codex']);
    assert.strictEqual(results.length, 2);
    const ids = results.map(r => r.providerId).sort();
    assert.deepStrictEqual(ids, ['claude', 'codex']);
  });

  // --- formatRefreshSummary ---

  await test('formatRefreshSummary: empty results returns no-providers message', async () => {
    const s = formatRefreshSummary([]);
    assert.ok(s.includes('no providers'), `expected "no providers" in "${s}"`);
  });

  await test('formatRefreshSummary: not-found includes label and "not found"', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'not-found' }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('not found'), `expected "not found" in "${s}"`);
  });

  await test('formatRefreshSummary: ok includes file count', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'ok', filesFound: 5 }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('5'), `expected "5" in "${s}"`);
  });

  await test('formatRefreshSummary: ok with 1 file uses singular', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'ok', filesFound: 1 }]);
    assert.ok(s.includes('1 session file'), `expected singular "1 session file" in "${s}"`);
    assert.ok(!s.includes('1 session files'), `expected no plural "1 session files" in "${s}"`);
  });

  await test('formatRefreshSummary: no-data includes label and "no session files"', async () => {
    const s = formatRefreshSummary([{ providerId: 'codex', status: 'no-data', filesFound: 0 }]);
    assert.ok(s.includes('Codex'), `expected "Codex" in "${s}"`);
    assert.ok(s.includes('no session files'), `expected "no session files" in "${s}"`);
  });

  await test('formatRefreshSummary: error includes label and "read error"', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'error' }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('read error'), `expected "read error" in "${s}"`);
  });

  await test('formatRefreshSummary: mixed states joined with " | "', async () => {
    const s = formatRefreshSummary([
      { providerId: 'claude', status: 'ok', filesFound: 3 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.ok(s.includes(' | '), `expected " | " separator in "${s}"`);
  });

  console.log('');
  console.log(`smoke-providers: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('smoke-providers: fatal error:', e);
  process.exit(1);
});
