#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { buildUsageDashboardModel } = require(path.join(repoRoot, 'out', 'panel', 'usageDashboardModel.js'));

  const claudeState = {
    provider: 'claude',
    source: 'local statusLine/hook state',
    stale: false,
    lastUpdatedEpochMs: Date.now()
  };

  const codexState = {
    provider: 'codex',
    source: 'Codex completed-turn bridge status',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    diagnosticSeverity: 'info',
    diagnostics: {
      usageFieldsFound: true,
      quotaFieldsFound: false
    }
  };

  const claudeTodayUsage = {
    available: true,
    dateKey: '2026-05-13',
    dateLabel: '2026-05-13',
    totalTokens: 50000,
    inputTokens: 30000,
    outputTokens: 20000,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 500,
    assistantMessages: 42,
    correlatedTurns: 42,
    models: ['claude-sonnet-4-20250514'],
    modelUsage: [],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 42,
    recordsMatched: 42,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0,
    reasoningOutputTokens: 0
  };

  const codexTodayUsage = {
    available: true,
    dateKey: '2026-05-13',
    dateLabel: '2026-05-13',
    totalTokens: 8000,
    inputTokens: 3000,
    outputTokens: 5000,
    cacheCreationInputTokens: 500,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 600,
    assistantMessages: 2,
    correlatedTurns: 2,
    models: ['gpt-4.5-2026-05-13', '<synthetic>:o3-20260513'],
    filesFound: 1,
    filesInspected: 1,
    recordsRead: 10,
    recordsMatched: 2,
    fileReadErrors: 0,
    skippedMissingTokenData: 0,
    skippedMissingModel: 0,
    skippedMissingBaseline: 0,
    skippedNegativeDelta: 0
  };

  // ── Scenario 1: Claude only ──────────────────────────────────────────────

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState], claudeTodayUsage: claudeTodayUsage, enabledProviders: ['claude'] });

    assert.equal(model.providers.length, 2, 'providers array length unchanged by filter');

    const todayCards = model.today.cards;
    assert.ok(todayCards.length > 0, 'today has cards when claude enabled and day-bucket data present');
    assert.equal(model.today.source.confidence, 'trustedCompletedTurnUsage', 'claude-only today section source is trusted, not unavailable');
    assert.ok(!model.today.scopeLabel.includes('Source:'), 'claude-only populated today scope omits redundant source prose');

    // Claude cards present
    assert.ok(todayCards.find(c => c.key === 'todayTokens'), 'claude todayTokens card present');
    // Codex cards absent
    assert.equal(todayCards.find(c => c.key === 'codexTodayTokens'), undefined, 'codex todayTokens card absent when codex disabled');

    const codexHistoryKeys = ['codexHistoryRange', 'codexHistoryTokens', 'codexHistoryActivity', 'codexHistoryCache'];
    const codexHistoryCards = model.details.cards.filter(c => codexHistoryKeys.includes(c.key));
    assert.equal(codexHistoryCards.length, 0, 'codex history cards excluded when codex disabled');

    assert.equal(model.details.cards.find(c => c.key === 'codexBridgeStatus'), undefined, 'codex bridge status card excluded when codex disabled');

    assert.equal(model.details.codexHistoryChart, undefined, 'codex history chart undefined when codex disabled');
    assert.equal(model.details.codexModelDistribution, undefined, 'codex model distribution undefined when codex disabled');

    console.log('PASS: Claude only hides Codex sections');
  }

  // ── Scenario 2: Codex only ──────────────────────────────────────────────

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState], codexTodayUsage: codexTodayUsage, enabledProviders: ['codex'] });

    assert.equal(model.providers.length, 2, 'providers array length unchanged by filter');

    // Codex today cards present
    assert.ok(model.today.cards.find(c => c.key === 'codexTodayTokens'), 'codex todayTokens card present when codex enabled');
    assert.equal(model.today.cards.find(c => c.key === 'codexTodayReasoning'), undefined, 'codex Today omits separate reasoning tile in provider-card layout');
    assert.deepEqual(
      model.today.cards.map(c => c.label),
      ['1D Messages/Turns', '1D Tokens', '1D Input / Output', '1D Cache', '1D API-equivalent'],
      'codex Today uses 1D-prefixed metric labels'
    );
    assert.equal(model.today.source.confidence, 'correlatedDayBucket', 'codex-only today section source is correlated, not unavailable');
    assert.ok(!model.today.scopeLabel.includes('Source:'), 'codex-only populated today scope omits redundant source prose');
    // Claude cards absent
    assert.equal(model.today.cards.find(c => c.key === 'todayTokens'), undefined, 'claude todayTokens card absent when claude disabled');

    const claudeHistoryKeys = ['historyRange', 'historyTokens', 'historyActivity', 'historyCache'];
    const claudeHistoryCards = model.details.cards.filter(c => claudeHistoryKeys.includes(c.key));
    assert.equal(claudeHistoryCards.length, 0, 'claude history cards excluded when claude disabled');

    assert.equal(model.details.historyChart, undefined, 'claude history chart undefined when claude disabled');
    assert.equal(model.details.modelDistribution, undefined, 'claude model distribution undefined when claude disabled');

    assert.equal(model.details.cards.find(c => c.key === 'codexBridgeStatus'), undefined, 'codex bridge status card absent from public dashboard');
    assert.equal(model.details.codexHistoryChart.available, false, 'codex history chart unavailable when no codexCorrelatedHistory arg');
    assert.equal(model.details.codexModelDistribution.available, false, 'codex model distribution unavailable when no codexCorrelatedHistory arg');

    console.log('PASS: Codex only hides Claude sections');
  }

  // ── Scenario 3: Both enabled (default) ───────────────────────────────────

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState] });

    // Enabled providers without Today data show honest unavailable cards.
    assert.ok(model.today.cards.find(c => c.key === 'todayTokens'), 'claude todayTokens card present (unavailable)');
    assert.ok(model.today.cards.find(c => c.key === 'codexTodayTokens'), 'codex todayTokens card present (unavailable)');
    assert.equal(model.today.cards.find(c => c.key === 'codexTodayTokens').available, false, 'codex todayTokens unavailable without codex data');

    const claudeHistoryKeys = ['historyRange', 'historyTokens', 'historyActivity', 'historyCache'];
    const claudeHistoryCards = model.details.cards.filter(c => claudeHistoryKeys.includes(c.key));
    assert.equal(claudeHistoryCards.length, 4, 'claude history cards present when claude enabled');

    const codexHistoryKeys = ['codexHistoryRange', 'codexHistoryTokens', 'codexHistoryActivity', 'codexHistoryCache'];
    const codexHistoryCards = model.details.cards.filter(c => codexHistoryKeys.includes(c.key));
    assert.equal(codexHistoryCards.length, 4, 'codex history cards present when codex enabled');

    assert.equal(model.details.cards.find(c => c.key === 'codexBridgeStatus'), undefined, 'codex bridge status card absent from public dashboard');

    assert.equal(typeof model.details.historyChart, 'object', 'claude history chart present when claude enabled');
    assert.equal(typeof model.details.modelDistribution, 'object', 'claude model distribution present when claude enabled');
    assert.equal(typeof model.details.codexHistoryChart, 'object', 'codex history chart present when codex enabled');
    assert.equal(typeof model.details.codexModelDistribution, 'object', 'codex model distribution present when codex enabled');

    console.log('PASS: Both enabled preserves current sections');
  }

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState], claudeTodayUsage: claudeTodayUsage, enabledProviders: ['claude', 'codex'] });
    const codexTodayTokens = model.today.cards.find(c => c.key === 'codexTodayTokens');
    assert.ok(codexTodayTokens, 'codex unavailable placeholder appears when codex enabled but missing today data');
    assert.equal(codexTodayTokens.available, false, 'codex unavailable placeholder is unavailable');
    assert.equal(model.today.cards.filter(c => c.key.startsWith('codexToday')).length, 5, 'codex unavailable provider has one card per Today metric including Messages/Turns');
    assert.ok(model.today.scopeLabel.includes('Claude assistant-message usage'), 'scope includes available Claude data');
    assert.ok(model.today.scopeLabel.includes('Codex usage unavailable'), 'scope includes missing Codex state');
    assert.equal(model.today.source.confidence, 'trustedCompletedTurnUsage', 'section source follows available Claude data');
    console.log('PASS: Missing enabled Codex Today data renders unavailable cards beside Claude data');
  }

  {
    const model = buildUsageDashboardModel({ states: [claudeState, codexState], codexTodayUsage: codexTodayUsage, enabledProviders: ['claude', 'codex'] });
    const claudeTodayTokens = model.today.cards.find(c => c.key === 'todayTokens');
    assert.ok(claudeTodayTokens, 'claude unavailable placeholder appears when claude enabled but missing today data');
    assert.equal(claudeTodayTokens.available, false, 'claude unavailable placeholder is unavailable');
    assert.equal(model.today.cards.filter(c => !c.key.startsWith('codexToday')).length, 5, 'claude unavailable provider has one card per Today metric including Messages/Turns');
    assert.ok(model.today.scopeLabel.includes('Claude usage unavailable'), 'scope includes missing Claude state');
    assert.ok(model.today.scopeLabel.includes('Codex correlated usage'), 'scope includes available Codex data');
    assert.equal(model.today.source.confidence, 'correlatedDayBucket', 'section source follows available Codex data');
    console.log('PASS: Missing enabled Claude Today data renders unavailable cards beside Codex data');
  }

  {
    const codexCorrelatedHistory = {
      available: true,
      rangeLabel: '2026-05-12 to 2026-05-13',
      totalDays: 2,
      activeDays: 1,
      assistantMessages: 2,
      inputTokens: 3000,
      outputTokens: 5000,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 600,
      totalTokens: 8600,
      filesFound: 1,
      filesInspected: 1,
      recordsRead: 10,
      recordsMatched: 2,
      fileReadErrors: 0,
      skippedMissingTokenData: 0,
      skippedMissingModel: 0,
      skippedMissingBaseline: 0,
      skippedNegativeDelta: 0,
      skippedTaskStartedWithoutTurnId: 0,
      skippedTokenCountOutsideTurn: 0,
      skippedCloseWithoutTurn: 0,
      skippedCompletionTimestampMissing: 0,
      modelUsage: [
        {
          model: 'gpt-4.5-2026-05-13',
          assistantMessages: 1,
          inputTokens: 1000,
          outputTokens: 2000,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 3300
        },
        {
          model: '<synthetic>:o3-20260513',
          assistantMessages: 1,
          inputTokens: 2000,
          outputTokens: 3000,
          cacheCreationInputTokens: 300,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 300,
          totalTokens: 5300
        }
      ],
      days: [
        {
          available: true,
          dateKey: '2026-05-13',
          dateLabel: '2026-05-13',
          assistantMessages: 2,
          inputTokens: 3000,
          outputTokens: 5000,
          cacheCreationInputTokens: 500,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 600,
          totalTokens: 8600,
          models: ['gpt-4.5-2026-05-13', '<synthetic>:o3-20260513'],
          correlatedTurns: 2,
          filesFound: 1,
          filesInspected: 1,
          recordsRead: 10,
          recordsMatched: 2,
          fileReadErrors: 0,
          skippedMissingTokenData: 0,
          skippedMissingModel: 0,
          skippedMissingBaseline: 0,
          skippedNegativeDelta: 0,
          modelUsage: [
            {
              model: 'gpt-4.5-2026-05-13',
              assistantMessages: 1,
              inputTokens: 1000,
              outputTokens: 2000,
              cacheCreationInputTokens: 200,
              cacheReadInputTokens: 0,
              reasoningOutputTokens: 300,
              totalTokens: 3300
            },
            {
              model: '<synthetic>:o3-20260513',
              assistantMessages: 1,
              inputTokens: 2000,
              outputTokens: 3000,
              cacheCreationInputTokens: 300,
              cacheReadInputTokens: 0,
              reasoningOutputTokens: 300,
              totalTokens: 5300
            }
          ]
        }
      ]
    };

    const model = buildUsageDashboardModel({ states: [codexState], codexCorrelatedHistory: codexCorrelatedHistory, enabledProviders: ['codex'] });
    const labels = model.details.codexModelDistribution.segments.map(segment => segment.label);
    assert.ok(labels.includes('gpt-4.5'), 'gpt model label keeps gpt prefix while stripping date suffix');
    assert.ok(labels.includes('<synthetic>'), 'synthetic Codex model label collapses to synthetic marker');
    assert.equal(model.details.codexHistoryChart.points[0].models[0].label, 'gpt-4.5', 'history point keeps gpt prefix');

    console.log('PASS: Codex model labels normalize date suffixes without stripping gpt prefix');
  }

  {
    const extensionSource = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf8');
    assert.match(extensionSource, /refreshNow: \(\) => refreshNow\(\{[^}]*suppressPanelBroadcast: true[^}]*\}\)/, 'panel-triggered refresh suppresses shared dashboard broadcast');
    assert.match(extensionSource, /if \(!options\.suppressPanelBroadcast\) \{[\s\S]*postUsageDashboardRefreshIfOpen\(usageDashboardModel\);/, 'shared refresh broadcasts dashboard model only when not panel-owned');
    assert.match(extensionSource, /suppressPanelBroadcast: current\.suppressPanelBroadcast \|\| incoming\.suppressPanelBroadcast/, 'queued panel refresh keeps broadcast suppression when refresh options merge');
    assert.match(extensionSource, /getUsageDashboardModel: \(\) => buildUsageDashboardModel\([\s\S]*getConfig\(\)\.enabledProviders/, 'panel-open dashboard model uses configured provider filtering');
    assert.match(extensionSource, /const effectiveProviders = cfg\.enabledProviders;/, 'refresh path derives effective providers from config');
    assert.match(extensionSource, /if \(effectiveProviders\.includes\('claude'\)\) \{[\s\S]*readClaudeTodayUsageBucket/, 'excluded Claude provider does not refresh dashboard history inputs');
    assert.match(extensionSource, /if \(effectiveProviders\.includes\('codex'\)\) \{[\s\S]*readCodexCorrelatedHistory/, 'excluded Codex provider does not refresh dashboard history inputs');

    const panelScript = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanelScript.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanelStyles.ts'), 'utf8');
    assert.match(panelScript, /overviewCards/, 'Today overview uses model-computed combined cards');
    assert.match(panelScript, /overviewCards: undefined/, 'Today provider tabs strip overview cards so provider-specific cards render');
    assert.match(panelScript, /scopeTodayByTab[\s\S]*tab === 'overview'[\s\S]*return today/, 'Provider tabs keep scopeTodayByTab unchanged');
    assert.match(panelScript, /setUsageLoading\(true\)/, 'refresh path dims existing dashboard frames instead of blanking them');
    assert.doesNotMatch(panelScript, /Refreshing today section/, 'refresh path no longer blanks the Today section');
    assert.match(styles, /usage-section-provider-grid[\s\S]*minmax\(min\(100%,560px\),1fr\)/, 'provider comparison grid stacks before provider cards become too narrow');
    assert.match(styles, /usage-section-provider-card[\s\S]*container-type:inline-size/, 'provider cards establish a container for tile wrapping');
    assert.match(styles, /usage-metric-grid[\s\S]*minmax\(min\(100%,150px\),1fr\)/, 'metric grids keep a readable tile minimum');
    assert.match(styles, /@container \(max-width:639px\)[\s\S]*usage-metric-grid[\s\S]*repeat\(2,minmax\(min\(100%,150px\),1fr\)\)/, 'medium provider-card widths use two metric columns');
    assert.match(styles, /@container \(max-width:360px\)[\s\S]*usage-metric-grid[\s\S]*grid-template-columns:1fr/, 'narrow provider-card widths use one metric column');
    assert.match(styles, /usage-metric-label-text[\s\S]*white-space:normal/, 'metric labels can wrap instead of relying on ellipsis');
    console.log('PASS: Today unavailable/loading rendering shape is preserved');
  }

  // ── #193: Filtered states array excludes provider cards ─────────────────

{
  // Simulate extension.ts filtering: only codex state + codex enabled
  const model = buildUsageDashboardModel({ states: [codexState], enabledProviders: ['codex'] });
  assert.equal(model.providers.length, 1, 'providers has only codex when claude state excluded');
  assert.equal(model.providers[0].provider, 'codex', 'remaining provider is codex');
  assert.equal(model.today.source.confidence, 'unavailable', 'no today data -> unavailable');
  // Enabled provider with no today data still renders unavailable placeholder cards
  assert.equal(model.today.cards.length, 5, 'codex placeholder cards present when enabled but missing today data');
  assert.equal(model.today.cards[0].available, false, 'codex placeholder cards are unavailable');
  assert.ok(model.today.cards.every(card => card.key.startsWith('codex')), 'codex-only dashboard does not include claude today cards');

  // Same with claude-only
  const claudeModel = buildUsageDashboardModel({ states: [claudeState], enabledProviders: ['claude'] });
  assert.equal(claudeModel.providers.length, 1, 'providers has only claude when codex state excluded');
  assert.equal(claudeModel.providers[0].provider, 'claude', 'remaining provider is claude');
  console.log('PASS: Filtered provider states exclude provider cards for filtered-out providers');
}

console.log('\nAll dashboard hide-disabled-providers smoke tests passed.');
}

main();
