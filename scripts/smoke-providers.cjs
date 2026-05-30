'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const assert = require('assert');

const OUT = path.resolve(__dirname, '../out');

const { ClaudeLocalReader } = require(path.join(OUT, 'providers/claudeLocal'));
const { CodexLocalReader } = require(path.join(OUT, 'providers/codexLocal'));
const { runEnabledReaders } = require(path.join(OUT, 'providers/readProviders'));
const { formatRefreshSummary, formatStatusBarText } = require(path.join(OUT, 'core/formatQuota'));

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

const FIXTURE_DIR = path.join(os.tmpdir(), `pf-smoke-fixtures-${Date.now()}`);

async function writeFile(dir, fileName, content) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, fileName), content, 'utf8');
}

async function createClaudeFixture(dir, records) {
  const lines = records.map(r => JSON.stringify(r));
  await writeFile(dir, 'session.jsonl', lines.join('\n') + '\n');
}

async function createCodexFixture(dir, records) {
  const lines = records.map(r => JSON.stringify(r));
  await writeFile(dir, 'session.jsonl', lines.join('\n') + '\n');
}

async function main() {
  await fsp.mkdir(FIXTURE_DIR, { recursive: true });

  // --- ClaudeLocalReader basics ---

  const ABSENT = path.join(FIXTURE_DIR, 'absent-' + Date.now());

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

  // --- Claude parser: valid fixture ---

  const claudeValid = path.join(FIXTURE_DIR, 'claude-valid');
  await createClaudeFixture(claudeValid, [
    {
      type: 'assistant',
      timestamp: Date.now(),
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 1200,
          output_tokens: 800,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 200,
        },
      },
    },
    {
      type: 'assistant',
      timestamp: Date.now() + 1000,
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 500,
          output_tokens: 300,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      },
    },
  ]);

  await test('ClaudeLocalReader: parses valid fixture and returns aggregate', async () => {
    const reader = new ClaudeLocalReader(claudeValid);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'claude');
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 2);
    assert.strictEqual(result.totalInputTokens, 1700);
    assert.strictEqual(result.totalOutputTokens, 1100);
    assert.strictEqual(result.totalTokens, 3450);
  });

  // --- Claude parser: malformed lines ---

  const claudeMalformed = path.join(FIXTURE_DIR, 'claude-malformed');
  await createClaudeFixture(claudeMalformed, [
    {
      type: 'assistant',
      timestamp: Date.now(),
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ]);
  const malformedFile = path.join(claudeMalformed, 'session.jsonl');
  await fsp.appendFile(malformedFile, 'this is not valid json\n', 'utf8');
  await fsp.appendFile(malformedFile, '{broken json\n', 'utf8');

  await test('ClaudeLocalReader: skips malformed lines gracefully', async () => {
    const reader = new ClaudeLocalReader(claudeMalformed);
    const result = await reader.read();
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 1);
    assert.ok(result.parseErrors >= 2, `expected parseErrors >= 2, got ${result.parseErrors}`);
  });

  // --- Claude parser: no assistant records ---

  const claudeNoMatch = path.join(FIXTURE_DIR, 'claude-no-match');
  await createClaudeFixture(claudeNoMatch, [
    { type: 'human', timestamp: Date.now(), message: { content: 'hello' } },
    { type: 'system', timestamp: Date.now(), message: { content: 'be helpful' } },
  ]);

  await test('ClaudeLocalReader: returns no-data when no assistant records', async () => {
    const reader = new ClaudeLocalReader(claudeNoMatch);
    const result = await reader.read();
    assert.strictEqual(result.status, 'no-data');
    assert.strictEqual(result.recordsMatched, 0);
  });

  // --- CodexLocalReader basics ---

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

  // --- Codex parser: valid fixture ---

  const codexValid = path.join(FIXTURE_DIR, 'codex-valid');
  await createCodexFixture(codexValid, [
    {
      type: 'tool_use',
      timestamp: Date.now(),
      payload: {
        info: {
          last_token_usage: {
            input_tokens: 2000,
            output_tokens: 1500,
            cached_input_tokens: 400,
          },
        },
      },
    },
    {
      type: 'tool_use',
      timestamp: Date.now() + 1000,
      payload: {
        info: {
          last_token_usage: {
            input_tokens: 800,
            output_tokens: 600,
            cached_input_tokens: 200,
          },
        },
      },
    },
  ]);

  await test('CodexLocalReader: parses valid fixture and returns aggregate', async () => {
    const reader = new CodexLocalReader(codexValid);
    const result = await reader.read();
    assert.strictEqual(result.providerId, 'codex');
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 2);
    assert.strictEqual(result.totalInputTokens, 2800);
    assert.strictEqual(result.totalOutputTokens, 2100);
  });

  // --- Codex parser: malformed lines ---

  const codexMalformed = path.join(FIXTURE_DIR, 'codex-malformed');
  await createCodexFixture(codexMalformed, [
    {
      type: 'tool_use',
      timestamp: Date.now(),
      payload: {
        info: {
          last_token_usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
          },
        },
      },
    },
  ]);
  const codexMalformedFile = path.join(codexMalformed, 'session.jsonl');
  await fsp.appendFile(codexMalformedFile, 'not json at all\n', 'utf8');

  await test('CodexLocalReader: skips malformed lines gracefully', async () => {
    const reader = new CodexLocalReader(codexMalformed);
    const result = await reader.read();
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.totalAssistantMessages, 1);
    assert.ok(result.parseErrors >= 1, `expected parseErrors >= 1, got ${result.parseErrors}`);
  });

  // --- Codex parser: no usage records ---

  const codexNoMatch = path.join(FIXTURE_DIR, 'codex-no-match');
  await createCodexFixture(codexNoMatch, [
    { type: 'session_meta', timestamp: Date.now(), payload: { id: 'test-session' } },
    { type: 'user', timestamp: Date.now(), payload: { content: 'hello' } },
  ]);

  await test('CodexLocalReader: returns no-data when no usage records', async () => {
    const reader = new CodexLocalReader(codexNoMatch);
    const result = await reader.read();
    assert.strictEqual(result.status, 'no-data');
    assert.strictEqual(result.recordsMatched, 0);
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

  // --- formatRefreshSummary with aggregate ---

  await test('formatRefreshSummary: empty results returns no-providers message', async () => {
    const s = formatRefreshSummary([]);
    assert.ok(s.includes('no providers'), `expected "no providers" in "${s}"`);
  });

  await test('formatRefreshSummary: not-found includes label and "not found"', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'not-found' }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('not found'), `expected "not found" in "${s}"`);
  });

  await test('formatRefreshSummary: ok includes aggregate data', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 3,
      totalAssistantMessages: 5,
      totalTokens: 15000,
    }]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('3'), `expected file count "3" in "${s}"`);
    assert.ok(s.includes('5'), `expected message count "5" in "${s}"`);
    assert.ok(s.includes('K tokens'), `expected "K tokens" in "${s}"`);
  });

  await test('formatRefreshSummary: ok with 1 file uses singular', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'ok', filesFound: 1 }]);
    assert.ok(s.includes('1 file'), `expected singular "1 file" in "${s}"`);
    assert.ok(!s.includes('1 files'), `expected no plural "1 files" in "${s}"`);
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

  // --- formatStatusBarText with loaded status ---

  await test('formatStatusBarText: loaded status shows token count', async () => {
    const s = formatStatusBarText([
      { providerId: 'claude', status: 'loaded', totalTokens: 25000 },
      { providerId: 'codex', status: 'no-data' },
    ]);
    assert.ok(s.includes('Claude'), `expected "Claude" in "${s}"`);
    assert.ok(s.includes('25.0K'), `expected "25.0K" in "${s}"`);
    assert.ok(s.includes('Codex'), `expected "Codex" in "${s}"`);
  });

  // --- Token count formatting thresholds ---

  await test('formatRefreshSummary: large token counts use M suffix', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 2,
      totalAssistantMessages: 10,
      totalTokens: 2500000,
    }]);
    assert.ok(s.includes('2.5M'), `expected "2.5M" in "${s}"`);
  });

  await test('formatRefreshSummary: small token counts show raw number', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 1,
      totalAssistantMessages: 1,
      totalTokens: 500,
    }]);
    assert.ok(s.includes('500'), `expected "500" in "${s}"`);
    assert.ok(s.includes('tokens'), `expected "tokens" in "${s}"`);
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
