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
const {
  formatRefreshSummary,
  formatStatusBarText,
  formatTooltip,
  formatTokenCount,
} = require(path.join(OUT, 'core/formatQuota'));
const { _test: authTest } = require(path.join(OUT, 'providers/authenticatedQuota'));
const {
  createInitialStatus,
  applyRefreshResults,
  getProviderState,
  hasAnyLoaded,
  hasAnyError,
} = require(path.join(OUT, 'core/statusModel'));

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

  const ABSENT = path.join(FIXTURE_DIR, 'absent-' + Date.now());

  // ===== statusModel: createInitialStatus =====

  await test('createInitialStatus: creates no-data states for all enabled providers', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    assert.strictEqual(status.providerStates.length, 2);
    assert.strictEqual(status.providerStates[0].status, 'no-data');
    assert.strictEqual(status.providerStates[1].status, 'no-data');
    assert.strictEqual(status.lastRefreshedMs, undefined);
    assert.strictEqual(status.localHistoryLastRefreshedMs, undefined);
    assert.strictEqual(status.liveQuotaLastRefreshedMs, undefined);
    assert.deepStrictEqual(status.enabledProviderIds, ['claude', 'codex']);
  });

  await test('createInitialStatus: empty enabledProviders yields empty states', async () => {
    const status = createInitialStatus([]);
    assert.strictEqual(status.providerStates.length, 0);
  });

  // ===== statusModel: applyRefreshResults =====

  await test('applyRefreshResults: updates lastRefreshedMs', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    assert.ok(typeof updated.lastRefreshedMs === 'number', 'expected lastRefreshedMs to be a number');
    assert.ok(updated.lastRefreshedMs > 0, 'expected lastRefreshedMs > 0');
    assert.strictEqual(updated.localHistoryLastRefreshedMs, updated.lastRefreshedMs);
    assert.strictEqual(updated.liveQuotaLastRefreshedMs, undefined);
  });

  await test('applyRefreshResults: ok with tokens -> loaded status', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 1000, totalAssistantMessages: 3, filesFound: 2 },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'loaded');
    assert.strictEqual(claudeState.totalTokens, 1000);
    assert.strictEqual(claudeState.totalAssistantMessages, 3);
  });

  await test('applyRefreshResults: not-found -> no-data status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'no-data');
  });

  await test('applyRefreshResults: error -> unknown status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'error' },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'unknown');
  });

  await test('applyRefreshResults: ok with 0 tokens -> no-data status', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'claude', status: 'ok', totalTokens: 0, totalAssistantMessages: 0, filesFound: 1 },
    ];
    const updated = applyRefreshResults(status, results);
    const claudeState = getProviderState(updated, 'claude');
    assert.strictEqual(claudeState.status, 'no-data');
  });

  await test('applyRefreshResults: ignores unknown providerId', async () => {
    const status = createInitialStatus(['claude']);
    const results = [
      { providerId: 'openai', status: 'ok', totalTokens: 999 },
      { providerId: 'claude', status: 'not-found' },
    ];
    const updated = applyRefreshResults(status, results);
    assert.strictEqual(updated.providerStates.length, 1);
    assert.strictEqual(updated.providerStates[0].providerId, 'claude');
  });

  // ===== statusModel: hasAnyLoaded / hasAnyError =====

  await test('hasAnyLoaded: true when at least one provider loaded', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 500, totalAssistantMessages: 1, filesFound: 1 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyLoaded(updated), true);
  });

  await test('hasAnyLoaded: false when no provider loaded', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyLoaded(updated), false);
  });

  await test('hasAnyError: true when at least one provider errored', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyError(updated), true);
  });

  await test('hasAnyError: false when no provider errored', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'not-found' },
    ]);
    assert.strictEqual(hasAnyError(updated), false);
  });

  // ===== formatStatusBarText: compact aggregate status bar =====

  await test('formatStatusBarText: all providers no-data shows local history label', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const text = formatStatusBarText(status);
    assert.strictEqual(text, 'PromptFuel: local history');
  });

  await test('formatStatusBarText: one provider loaded shows aggregate with local suffix', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    const text = formatStatusBarText(updated);
    assert.ok(text.includes('12.4K'), `expected "12.4K" in "${text}"`);
    assert.ok(text.includes('local history'), `expected "local history" in "${text}"`);
    assert.ok(!text.includes(' | '), `should not include pipe separator in "${text}"`);
  });

  await test('formatStatusBarText: both providers loaded shows single aggregate', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 12400, totalAssistantMessages: 5, filesFound: 3 },
      { providerId: 'codex', status: 'ok', totalTokens: 3100, totalAssistantMessages: 2, filesFound: 1 },
    ]);
    const text = formatStatusBarText(updated);
    assert.ok(text.includes('15.5K'), `expected aggregate "15.5K" in "${text}"`);
    assert.ok(text.includes('local history'), `expected "local history" in "${text}"`);
    assert.ok(!text.includes(' | '), `should not include pipe separator in "${text}"`);
    assert.ok(!text.includes('⛽'), `should not include emoji in "${text}"`);
  });

  await test('formatStatusBarText: error state returns refresh failed', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
    ]);
    const text = formatStatusBarText(updated);
    assert.strictEqual(text, 'PromptFuel: refresh failed');
  });

  await test('formatStatusBarText: mixed loaded and no-data shows aggregate only', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
      { providerId: 'codex', status: 'ok', totalTokens: 5000, totalAssistantMessages: 2, filesFound: 1 },
    ]);
    const text = formatStatusBarText(updated);
    assert.ok(text.includes('5.0K'), `expected "5.0K" in "${text}"`);
    assert.ok(text.includes('local history'), `expected "local history" in "${text}"`);
    assert.ok(!text.includes(' | '), `should not include pipe separator in "${text}"`);
  });

  // ===== formatTooltip =====

  await test('formatTooltip: initial state shows local history disclaimers', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const tooltip = formatTooltip(status);
    assert.ok(tooltip.includes('PromptFuel'), `expected "PromptFuel" in tooltip`);
    assert.ok(tooltip.includes('Local history only'), `expected "Local history only" in tooltip`);
    assert.ok(tooltip.includes('no local data'), `expected "no local data" in tooltip`);
    assert.ok(!tooltip.includes('Last refreshed'), 'should not show refresh time before first refresh');
  });

  await test('formatTooltip: loaded state shows tokens and messages', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 25000, totalAssistantMessages: 7, filesFound: 4 },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(tooltip.includes('Claude'), `expected "Claude" in tooltip`);
    assert.ok(tooltip.includes('loaded'), `expected "loaded" in tooltip`);
    assert.ok(tooltip.includes('25.0K'), `expected "25.0K" in tooltip`);
    assert.ok(tooltip.includes('7 messages'), `expected "7 messages" in tooltip`);
    assert.ok(tooltip.includes('Last refreshed'), `expected "Last refreshed" in tooltip`);
  });

  await test('formatTooltip: error state shows read error', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'error' },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(tooltip.includes('read error'), `expected "read error" in tooltip`);
  });

  await test('formatTooltip: last refreshed shows time', async () => {
    const status = createInitialStatus(['claude']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'not-found' },
    ]);
    const tooltip = formatTooltip(updated);
    assert.ok(tooltip.includes('Last refreshed:'), `expected "Last refreshed:" in tooltip`);
    const timeMatch = tooltip.match(/Last refreshed: (\d{2}:\d{2}:\d{2})/);
    assert.ok(timeMatch, `expected HH:MM:SS format in tooltip`);
  });

  await test('formatTooltip: multiple providers shown on separate lines', async () => {
    const status = createInitialStatus(['claude', 'codex']);
    const updated = applyRefreshResults(status, [
      { providerId: 'claude', status: 'ok', totalTokens: 10000, totalAssistantMessages: 3, filesFound: 2 },
      { providerId: 'codex', status: 'not-found' },
    ]);
    const tooltip = formatTooltip(updated);
    const lines = tooltip.split('\n');
    assert.ok(lines.length >= 3, `expected at least 3 lines in tooltip, got ${lines.length}`);
    assert.ok(lines.some(l => l.includes('Claude')), 'expected Claude line');
    assert.ok(lines.some(l => l.includes('Codex')), 'expected Codex line');
  });

  // ===== formatTokenCount =====

  await test('formatTokenCount: M suffix for >= 1M', async () => {
    assert.strictEqual(formatTokenCount(2_500_000), '2.5M tokens');
  });

  await test('formatTokenCount: K suffix for >= 1K', async () => {
    assert.strictEqual(formatTokenCount(12_400), '12.4K tokens');
  });

  await test('formatTokenCount: raw number for < 1K', async () => {
    assert.strictEqual(formatTokenCount(500), '500 tokens');
  });

  await test('formatTokenCount: zero', async () => {
    assert.strictEqual(formatTokenCount(0), '0 tokens');
  });

  // ===== formatRefreshSummary =====

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
    assert.ok(s.includes('5'), `expected message count "5" in "${s}"`);
    assert.ok(s.includes('K tokens'), `expected "K tokens" in "${s}"`);
    assert.ok(!s.includes('.jsonl'), `should not include file extensions in "${s}"`);
    assert.ok(!s.includes('\\'), `should not include backslashes in "${s}"`);
    assert.ok(!s.includes('/'), `should not include slashes in "${s}"`);
  });

  await test('formatRefreshSummary: ok with 1 file omits file count', async () => {
    const s = formatRefreshSummary([{ providerId: 'claude', status: 'ok', filesFound: 1, totalAssistantMessages: 1, totalTokens: 200 }]);
    assert.ok(!s.includes('file'), `should not include file count in "${s}"`);
    assert.ok(!s.includes('files'), `should not include files in "${s}"`);
  });

  await test('formatRefreshSummary: no-data includes label and "no local usage history"', async () => {
    const s = formatRefreshSummary([{ providerId: 'codex', status: 'no-data', filesFound: 0 }]);
    assert.ok(s.includes('Codex'), `expected "Codex" in "${s}"`);
    assert.ok(s.includes('no local usage history'), `expected "no local usage history" in "${s}"`);
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

  await test('formatRefreshSummary: parse errors shown in summary', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 2,
      totalAssistantMessages: 1,
      totalTokens: 500,
      parseErrors: 3,
    }]);
    assert.ok(s.includes('3 parse errors'), `expected "3 parse errors" in "${s}"`);
  });

  await test('formatRefreshSummary: single parse error uses singular', async () => {
    const s = formatRefreshSummary([{
      providerId: 'claude',
      status: 'ok',
      filesFound: 1,
      totalAssistantMessages: 1,
      totalTokens: 200,
      parseErrors: 1,
    }]);
    assert.ok(s.includes('1 parse error'), `expected "1 parse error" in "${s}"`);
    assert.ok(!s.includes('1 parse errors'), `expected no plural "1 parse errors" in "${s}"`);
  });

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

  // ===== ClaudeLocalReader integration =====

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

  // Claude parser: valid fixture
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

  // Claude parser: malformed lines
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

  // Claude parser: no assistant records
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

  // ===== CodexLocalReader integration =====

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

  // Codex parser: valid fixture
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

  // Codex parser: malformed lines
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

  // Codex parser: no usage records
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

  // ===== runEnabledReaders =====

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

  // ===== Authenticated quota window mapping (synthetic data) =====

  await test('parseClaudeWindow: five_hour maps to 5h', async () => {
    const w = authTest.parseClaudeWindow('5h', { utilization: 0.45, resets_at: Date.now() / 1000 + 5000 });
    assert.strictEqual(w.windowId, '5h', 'five_hour should map to 5h');
  });

  await test('parseClaudeWindow: seven_day maps to 7d', async () => {
    const w = authTest.parseClaudeWindow('7d', { utilization: 0.3, resets_at: Date.now() / 1000 + 70000 });
    assert.strictEqual(w.windowId, '7d', 'seven_day should map to 7d');
  });

  await test('parseClaudeWindow: undefined window returns undefined', async () => {
    const w = authTest.parseClaudeWindow('5h', undefined);
    assert.strictEqual(w, undefined);
  });

  await test('parseCodexWindow: 18000s window maps to 5h', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 18000, used_percent: 50 }, 18000);
    assert.strictEqual(w.windowId, '5h', '18000s should map to 5h');
  });

  await test('parseCodexWindow: 604800s window maps to 7d', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 604800, used_percent: 20 }, 604800);
    assert.strictEqual(w.windowId, '7d', '604800s should map to 7d');
  });

  await test('parseCodexWindow: mismatched seconds returns undefined', async () => {
    const w = authTest.parseCodexWindow({ limit_window_seconds: 99999, used_percent: 50 }, 18000);
    assert.strictEqual(w, undefined);
  });

  await test('buildWindow: preserves windowId', async () => {
    const w = authTest.buildWindow('7d', 50, Math.floor(Date.now() / 1000) + 86400);
    assert.strictEqual(w.windowId, '7d');
    assert.strictEqual(w.usedPercentage, 50);
    assert.strictEqual(w.remainingPercentage, 50);
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
