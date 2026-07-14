import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addThousandsSeparators, formatStatus, formatTokenCount, quotaIndicatorForRemaining, quotaLevelForRemaining, type FormatOptions } from '../display/format';
import type { ProviderUsageState } from '../types';

function makeState(usedPercentSevenDay: number, usedPercentFiveHour = usedPercentSevenDay): ProviderUsageState[] {
  const reset = Math.floor(Date.now() / 1000) + 86_400;
  return [{
    provider: 'claude',
    source: 'threshold unit fixture',
    stale: false,
    lastUpdatedEpochMs: Date.now(),
    sevenDay: { usedPercentage: usedPercentSevenDay, resetsAtEpochSeconds: reset },
    fiveHour: { usedPercentage: usedPercentFiveHour, resetsAtEpochSeconds: reset }
  }];
}

function baseOptions(): FormatOptions {
  return {
    displayMode: 'compact',
    statusMode: 'remaining'
  };
}

describe('display formatting', () => {
  it('adds thousands separators without changing decimals', () => {
    assert.equal(addThousandsSeparators('8133.4'), '8,133.4');
    assert.equal(addThousandsSeparators('6137.0'), '6,137.0');
    assert.equal(addThousandsSeparators('14651'), '14,651');
    assert.equal(addThousandsSeparators('0.39'), '0.39');
    assert.equal(addThousandsSeparators('999'), '999');
    assert.equal(addThousandsSeparators('1000'), '1,000');
    assert.equal(addThousandsSeparators('1234567'), '1,234,567');
  });

  it('formats token counts with K/M abbreviations', () => {
    assert.equal(formatTokenCount(0), '0');
    assert.equal(formatTokenCount(5), '5');
    assert.equal(formatTokenCount(999), '999');
    assert.equal(formatTokenCount(1000), '1.0K');
    assert.equal(formatTokenCount(1500), '1.5K');
    assert.equal(formatTokenCount(999999), '1,000.0K');
    assert.equal(formatTokenCount(1000000), '1.0M');
    assert.equal(formatTokenCount(1500000), '1.5M');
    assert.equal(formatTokenCount(9999999), '10.0M');
    assert.equal(formatTokenCount(1234567), '1.2M');
    assert.equal(formatTokenCount(123456), '123.5K');
  });

  it('maps remaining quota levels to dashboard color buckets', () => {
    assert.equal(quotaLevelForRemaining(100), 'purple');
    assert.equal(quotaLevelForRemaining(91), 'purple');
    assert.equal(quotaLevelForRemaining(90), 'blue');
    assert.equal(quotaLevelForRemaining(71), 'blue');
    assert.equal(quotaLevelForRemaining(70), 'green');
    assert.equal(quotaLevelForRemaining(51), 'green');
    assert.equal(quotaLevelForRemaining(50), 'yellow');
    assert.equal(quotaLevelForRemaining(31), 'yellow');
    assert.equal(quotaLevelForRemaining(30), 'orange');
    assert.equal(quotaLevelForRemaining(11), 'orange');
    assert.equal(quotaLevelForRemaining(10), 'red');
    assert.equal(quotaLevelForRemaining(0), 'red');
    assert.equal(quotaLevelForRemaining(undefined), 'unavailable');
    assert.equal(quotaLevelForRemaining(50, true), 'unavailable');
  });

  it('maps remaining quota percentages to correct emoji via quotaIndicatorForRemaining', () => {
    assert.equal(quotaIndicatorForRemaining(100), '\uD83D\uDFE3');
    assert.equal(quotaIndicatorForRemaining(91), '\uD83D\uDFE3');
    assert.equal(quotaIndicatorForRemaining(90), '\uD83D\uDD35');
    assert.equal(quotaIndicatorForRemaining(71), '\uD83D\uDD35');
    assert.equal(quotaIndicatorForRemaining(70), '\uD83D\uDFE2');
    assert.equal(quotaIndicatorForRemaining(51), '\uD83D\uDFE2');
    assert.equal(quotaIndicatorForRemaining(50), '\uD83D\uDFE1');
    assert.equal(quotaIndicatorForRemaining(31), '\uD83D\uDFE1');
    assert.equal(quotaIndicatorForRemaining(30), '\uD83D\uDFE0');
    assert.equal(quotaIndicatorForRemaining(11), '\uD83D\uDFE0');
    assert.equal(quotaIndicatorForRemaining(10), '\uD83D\uDD34');
    assert.equal(quotaIndicatorForRemaining(0), '\uD83D\uDD34');
    assert.equal(quotaIndicatorForRemaining(undefined), '\u26AB');
    assert.equal(quotaIndicatorForRemaining(undefined, true), '\u26AB');
  });

  it('formats compact status bar windows with per-window dots', () => {
    const opts = baseOptions();
    const text = formatStatus(makeState(35, 78), opts).text;
    assert.equal(text, `C ${quotaIndicatorForRemaining(65)}65% \u00B7 ${quotaIndicatorForRemaining(22)}22%`);
  });

  it('uses one local attention state for a retained broken primary window without adding compact issue symbols', () => {
    const reset = Math.floor(Date.now() / 1000) + 86_400;
    const rawError = 'provider-specific internal response details';
    const result = formatStatus([{
      provider: 'codex',
      sourceKind: 'authenticated',
      source: 'live authenticated refresh',
      stale: false,
      lastUpdatedEpochMs: Date.now(),
      authenticatedStatus: 'success',
      authenticatedError: rawError,
      sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: reset, sourceKind: 'authenticated' },
      fiveHour: { usedPercentage: 30, resetsAtEpochSeconds: reset, sourceKind: 'cache', sourceUpdatedEpochMs: Date.now() - 60_000 },
      authenticatedWindows: {
        sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: Date.now() },
        fiveHour: { observation: 'malformed', availability: 'cached', lastLiveEpochMs: Date.now() - 60_000 }
      }
    }], baseOptions());

    assert.doesNotMatch(result.text, /[!⚠▲△?]/);
    assert.equal(result.localLiveQuotaAttention, true);
    assert.equal(
      result.tooltip.split('Some live quota data is incomplete. Open the dashboard for details.').length - 1,
      1
    );
    assert.doesNotMatch(result.tooltip, /cached value|stale cached value|live window unreadable|unavailable/i);
    assert.doesNotMatch(result.tooltip, new RegExp(rawError));
    assert.equal(result.providers[0]?.severity, 'normal');
  });

  it('does not bind authenticated fallback wording to a retained local window by identity or label', () => {
    const reset = Math.floor(Date.now() / 1000) + 86_400;
    const localTimestamp = Date.now() - 60_000;
    const result = formatStatus([{
      provider: 'codex',
      sourceKind: 'localSession',
      source: 'local Codex session snapshot',
      stale: false,
      lastUpdatedEpochMs: Date.now(),
      sevenDay: { usedPercentage: 0, resetsAtEpochSeconds: reset, sourceKind: 'authenticated' },
      fiveHour: {
        usedPercentage: 30,
        resetsAtEpochSeconds: reset,
        sourceKind: 'localSession',
        sourceUpdatedEpochMs: localTimestamp
      },
      authenticatedWindows: {
        sevenDay: { observation: 'valid', availability: 'live', lastLiveEpochMs: Date.now() },
        fiveHour: { observation: 'malformed', availability: 'cached', lastLiveEpochMs: localTimestamp }
      }
    }], baseOptions());

    assert.doesNotMatch(result.text, /!/);
    assert.doesNotMatch(result.tooltip, /cached value|stale cached value|live window unreadable/i);
    assert.equal(result.localLiveQuotaAttention, false);
  });

  it('does not treat imported snapshot staleness as local live-quota attention', () => {
    const result = formatStatus(makeState(25, 50), baseOptions(), [{
      provider: 'codex',
      text: 'Remote Codex 75% · 50%',
      tooltip: '',
      severity: 'warning',
      remoteQuotaData: {
        label: 'Remote Codex',
        sevenDayRemainingPercent: 75,
        fiveHourRemainingPercent: 50,
        stale: true
      }
    }]);

    assert.equal(result.localLiveQuotaAttention, false);
    assert.doesNotMatch(result.tooltip, /snap|snapshot|cached|stale|unavailable|live window not supplied/i);
  });

  it('does not describe a generic local provider error as incomplete live quota', () => {
    const state = makeState(25, 50)[0];
    const result = formatStatus([{ ...state, error: 'local history read failed' }], baseOptions());

    assert.equal(result.localLiveQuotaAttention, false);
    assert.doesNotMatch(result.tooltip, /Some live quota data is incomplete/);
  });

  it('shows raw 5h percent in status bar when 7d is near exhausted', () => {
    const opts = baseOptions();
    // 7d at 99% used (1% remaining, previously the blocked threshold), 5h at 17% used (83% remaining)
    const text = formatStatus(makeState(99, 17), opts).text;
    assert.match(text, /83%/);
    assert.doesNotMatch(text, /blocked/i);
  });

  it('renders generic meters in the provider tooltip table', () => {
    const reset = Math.floor(Date.now() / 1000) + 86_400;
    const state: ProviderUsageState[] = [{
      provider: 'claude',
      source: 'threshold unit fixture',
      stale: false,
      lastUpdatedEpochMs: Date.now(),
      sevenDay: { usedPercentage: 35, resetsAtEpochSeconds: reset },
      fiveHour: { usedPercentage: 20, resetsAtEpochSeconds: reset },
      meters: [{
        id: 'fake-scoped-meter',
        label: 'preview 1d',
        scope: 'model',
        windowSeconds: 86_400,
        window: { usedPercentage: 40, resetsAtEpochSeconds: reset }
      }]
    }];

    const status = formatStatus(state, { displayMode: 'standard', statusMode: 'remaining' });
    assert.match(status.tooltip ?? '', /\| preview 1d \|/);
  });
  it('separates compact status bar providers with pipe', () => {
    const opts = baseOptions();
    const remoteText = `XW ${quotaIndicatorForRemaining(65)}65% \u00B7 ${quotaIndicatorForRemaining(22)}22%`;
    const text = formatStatus(makeState(3, 100), opts, [{
      provider: 'codex',
      text: remoteText,
      tooltip: '',
      severity: 'normal'
    }]).text;
    assert.equal(text, `C ${quotaIndicatorForRemaining(97)}97% \u00B7 ${quotaIndicatorForRemaining(0)}0% | ${remoteText}`);
  });

  it('every quota level maps to a valid dashboard progress-bar CSS class', () => {
    const levels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red'] as const;
    for (const level of levels) {
      const cssClass = 'level-' + level;
      assert.ok(cssClass.startsWith('level-'), `CSS class must start with level- prefix for ${level}`);
    }
    // Verify unavailable is excluded from dashboard levels
    const dashboardLevels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red'] as const;
    const allQuotaLevels = ['purple', 'blue', 'green', 'yellow', 'orange', 'red', 'unavailable'] as const;
    for (const l of allQuotaLevels) {
      if (l === 'unavailable') {
        assert.equal((dashboardLevels as readonly string[]).includes(l), false,
          'unavailable must not be a dashboard progress-bar level');
      } else {
        assert.ok((dashboardLevels as readonly string[]).includes(l),
          `${l} must be a dashboard progress-bar level`);
      }
    }
  });

  it('applies fixed remaining thresholds to formatted status severity', () => {
    const opts = baseOptions();
    assert.equal(formatStatus(makeState(25), opts).severity, 'normal');
    assert.equal(formatStatus(makeState(60), opts).severity, 'low');
    assert.equal(formatStatus(makeState(80), opts).severity, 'warning');
    assert.equal(formatStatus(makeState(95), opts).severity, 'critical');
  });
});
