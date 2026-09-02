import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_GENERIC_USAGE_METERS,
  applyMeterVisibility,
  DEFAULT_METER_VISIBILITY,
  EXTRA_USAGE_METER_ID,
  isExtraUsageMeter,
  isMeterSelected,
  MeterVisibilityPolicy,
  normalizeShowExtraUsage,
  normalizeVisibleUsageMeters,
  selectVisibleMeters,
  SelectableMeter
} from '../display/meterVisibility';
import { buildUsageMeterDiscoveryItems } from '../display/meterDiscovery';
import type { ProviderUsageState, UsageMeter } from '../types';

function meter(id: string, label: string): SelectableMeter {
  return { id, label };
}

function usageMeter(overrides: Partial<UsageMeter> & Pick<UsageMeter, 'id' | 'label'>): UsageMeter {
  return {
    scope: 'unknown',
    window: {},
    ...overrides
  };
}

describe('normalizeVisibleUsageMeters', () => {
  it('returns an empty array for non-array input', () => {
    assert.deepEqual(normalizeVisibleUsageMeters(undefined), []);
    assert.deepEqual(normalizeVisibleUsageMeters(null), []);
    assert.deepEqual(normalizeVisibleUsageMeters('nimbus-quill'), []);
    assert.deepEqual(normalizeVisibleUsageMeters(42), []);
  });

  it('skips non-string entries', () => {
    assert.deepEqual(normalizeVisibleUsageMeters([1, null, undefined, {}, 'nimbus-quill']), ['nimbus-quill']);
  });

  it('trims whitespace and skips empty strings', () => {
    assert.deepEqual(normalizeVisibleUsageMeters(['  nimbus-quill  ', '   ', '']), ['nimbus-quill']);
  });

  it('preserves the "*" wildcard literally', () => {
    assert.deepEqual(normalizeVisibleUsageMeters(['*']), ['*']);
  });

  it('normalizes snake_case, Title Case, and kebab-case to the same ID', () => {
    assert.deepEqual(normalizeVisibleUsageMeters(['nimbus_quill']), ['nimbus-quill']);
    assert.deepEqual(normalizeVisibleUsageMeters(['Nimbus Quill']), ['nimbus-quill']);
    assert.deepEqual(normalizeVisibleUsageMeters(['nimbus-quill']), ['nimbus-quill']);
  });

  it('removes duplicates while preserving first-seen order', () => {
    assert.deepEqual(
      normalizeVisibleUsageMeters(['nimbus-quill', 'other-meter', 'nimbus_quill', 'Nimbus Quill']),
      ['nimbus-quill', 'other-meter']
    );
  });
});

describe('normalizeShowExtraUsage', () => {
  it('returns false only for the literal false value', () => {
    assert.equal(normalizeShowExtraUsage(false), false);
  });

  it('returns true for true, undefined, and other garbage input', () => {
    assert.equal(normalizeShowExtraUsage(true), true);
    assert.equal(normalizeShowExtraUsage(undefined), true);
    assert.equal(normalizeShowExtraUsage(null), true);
    assert.equal(normalizeShowExtraUsage('false'), true);
    assert.equal(normalizeShowExtraUsage(0), true);
  });
});

describe('extra usage selection', () => {
  it('shows extra usage by default, recognized by id', () => {
    const m = meter(EXTRA_USAGE_METER_ID, 'Some Label');
    assert.equal(isExtraUsageMeter(m), true);
    assert.equal(isMeterSelected(m), true);
  });

  it('hides extra usage when showExtraUsage is false, recognized by id', () => {
    const m = meter(EXTRA_USAGE_METER_ID, 'Some Label');
    const policy: MeterVisibilityPolicy = { showExtraUsage: false, visibleUsageMeters: [] };
    assert.equal(isMeterSelected(m, policy), false);
  });

  it('recognizes extra usage by normalized label alone, including multi-space labels', () => {
    const byLabel = meter('some-other-id', 'Extra usage');
    const byMultiSpaceLabel = meter('another-id', 'EXTRA  USAGE');
    assert.equal(isExtraUsageMeter(byLabel), true);
    assert.equal(isExtraUsageMeter(byMultiSpaceLabel), true);

    const policy: MeterVisibilityPolicy = { showExtraUsage: false, visibleUsageMeters: [] };
    assert.equal(isMeterSelected(byLabel, policy), false);
    assert.equal(isMeterSelected(byMultiSpaceLabel, policy), false);
  });

  it('does not let "*" make extra usage visible when showExtraUsage is false', () => {
    const m = meter(EXTRA_USAGE_METER_ID, 'Extra usage');
    const policy: MeterVisibilityPolicy = { showExtraUsage: false, visibleUsageMeters: [ALL_GENERIC_USAGE_METERS] };
    assert.equal(isMeterSelected(m, policy), false);
  });

  // Selection is deliberately provider-blind: SelectableMeter carries no provider, so
  // extra usage is governed by showExtraUsage for every provider rather than falling
  // into the opt-in generic bucket. The end-to-end non-Claude case is covered in
  // displayFormat.test.ts ('does not suppress a Codex meter with the same extra usage
  // id or label at zero'), which drives formatStatus with a codex state under the
  // default policy. What is pinned here is the precedence rule between the two settings.
  it('never lets visibleUsageMeters override the showExtraUsage toggle', () => {
    const extraUsage = meter('extra_usage', 'Extra usage');

    // Listing the ID does not bring it back when the toggle is off.
    const listedButToggledOff: MeterVisibilityPolicy = {
      showExtraUsage: false,
      visibleUsageMeters: ['extra-usage']
    };
    assert.equal(isMeterSelected(extraUsage, listedButToggledOff), false);

    // And the toggle alone is enough, with the list left empty.
    const toggledOn: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: [] };
    assert.equal(isMeterSelected(extraUsage, toggledOn), true);
  });
});

describe('generic meter selection', () => {
  it('hides generic meters under the default policy', () => {
    const m = meter('nimbus-quill', 'Nimbus Quill');
    assert.equal(isMeterSelected(m, DEFAULT_METER_VISIBILITY), false);
    assert.equal(isMeterSelected(m), false);
  });

  it('shows a generic meter whose ID is listed, and keeps an unrelated one hidden', () => {
    const listed = meter('nimbus-quill', 'Nimbus Quill');
    const unrelated = meter('other-meter', 'Other Meter');
    const policy: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: ['nimbus-quill'] };

    assert.equal(isMeterSelected(listed, policy), true);
    assert.equal(isMeterSelected(unrelated, policy), false);
  });

  it('shows multiple listed IDs', () => {
    const first = meter('nimbus-quill', 'Nimbus Quill');
    const second = meter('batch-preview', 'Batch preview');
    const third = meter('other-meter', 'Other Meter');
    const policy: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: ['nimbus-quill', 'batch-preview'] };

    assert.equal(isMeterSelected(first, policy), true);
    assert.equal(isMeterSelected(second, policy), true);
    assert.equal(isMeterSelected(third, policy), false);
  });

  it('shows all generic meters when the list contains "*"', () => {
    const first = meter('nimbus-quill', 'Nimbus Quill');
    const second = meter('other-meter', 'Other Meter');
    const policy: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: [ALL_GENERIC_USAGE_METERS] };

    assert.equal(isMeterSelected(first, policy), true);
    assert.equal(isMeterSelected(second, policy), true);
  });

  it('matches a meter even when the policy holds raw un-normalized entries', () => {
    const m = meter('nimbus-quill', 'Nimbus Quill');
    const policy: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: ['nimbus_quill'] };
    assert.equal(isMeterSelected(m, policy), true);
  });
});

describe('applyMeterVisibility', () => {
  it('does not mutate its input', () => {
    const state = {
      meters: [usageMeter({ id: 'nimbus-quill', label: 'Nimbus Quill' })]
    };
    const before = JSON.parse(JSON.stringify(state));
    applyMeterVisibility(state, { showExtraUsage: true, visibleUsageMeters: [] });
    assert.deepEqual(state, before);
  });

  it('returns a state without a meters field unchanged', () => {
    const state = { provider: 'claude' as const, meters: undefined };
    const result = applyMeterVisibility(state, { showExtraUsage: true, visibleUsageMeters: [] });
    assert.equal(result, state);
  });

  it('filters meters down to the selected set via selectVisibleMeters', () => {
    const listed = usageMeter({ id: 'nimbus-quill', label: 'Nimbus Quill' });
    const unrelated = usageMeter({ id: 'other-meter', label: 'Other Meter' });
    const result = selectVisibleMeters([listed, unrelated], { showExtraUsage: true, visibleUsageMeters: ['nimbus-quill'] });
    assert.deepEqual(result, [listed]);
  });
});

describe('buildUsageMeterDiscoveryItems', () => {
  it('returns an empty array for empty or undefined input', () => {
    assert.deepEqual(buildUsageMeterDiscoveryItems([]), []);
  });

  it('lists hidden meters with visible:false and shown meters with visible:true', () => {
    const states: Pick<ProviderUsageState, 'provider' | 'meters'>[] = [{
      provider: 'claude',
      meters: [
        usageMeter({ id: 'nimbus-quill', label: 'Nimbus Quill', window: { usedPercentage: 10 } })
      ]
    }];

    const hidden = buildUsageMeterDiscoveryItems(states, { showExtraUsage: true, visibleUsageMeters: [] });
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].visible, false);

    const shown = buildUsageMeterDiscoveryItems(states, { showExtraUsage: true, visibleUsageMeters: ['nimbus-quill'] });
    assert.equal(shown[0].visible, true);
  });

  it('returns normalized IDs that isMeterSelected actually matches when placed in visibleUsageMeters', () => {
    const states: Pick<ProviderUsageState, 'provider' | 'meters'>[] = [{
      provider: 'codex',
      meters: [
        usageMeter({ id: 'Nimbus Quill', label: 'Nimbus Quill', window: { usedPercentage: 5 } })
      ]
    }];

    const [item] = buildUsageMeterDiscoveryItems(states);
    assert.equal(item.id, 'nimbus-quill');

    const policy: MeterVisibilityPolicy = { showExtraUsage: true, visibleUsageMeters: [item.id] };
    assert.equal(isMeterSelected(states[0].meters![0], policy), true);
  });

  it('assigns categories correctly for extra usage vs generic meters', () => {
    const states: Pick<ProviderUsageState, 'provider' | 'meters'>[] = [{
      provider: 'claude',
      meters: [
        usageMeter({ id: EXTRA_USAGE_METER_ID, label: 'Extra usage', window: { usedPercentage: 0 } }),
        usageMeter({ id: 'nimbus-quill', label: 'Nimbus Quill', window: { usedPercentage: 0 } })
      ]
    }];

    const items = buildUsageMeterDiscoveryItems(states);
    const extra = items.find(i => i.id === EXTRA_USAGE_METER_ID);
    const generic = items.find(i => i.id === 'nimbus-quill');
    assert.equal(extra?.category, 'extraUsage');
    assert.equal(generic?.category, 'generic');
  });

  it('deduplicates by provider + id, keeping the first occurrence, and sorts by provider then id', () => {
    const states: Pick<ProviderUsageState, 'provider' | 'meters'>[] = [
      {
        provider: 'codex',
        meters: [usageMeter({ id: 'zeta-meter', label: 'Zeta first', window: { usedPercentage: 1 } })]
      },
      {
        provider: 'claude',
        meters: [
          usageMeter({ id: 'alpha-meter', label: 'Alpha', window: { usedPercentage: 2 } }),
          usageMeter({ id: 'zeta-meter', label: 'Zeta second', window: { usedPercentage: 3 } })
        ]
      },
      {
        provider: 'claude',
        meters: [usageMeter({ id: 'alpha-meter', label: 'Alpha duplicate', window: { usedPercentage: 99 } })]
      }
    ];

    const items = buildUsageMeterDiscoveryItems(states);
    assert.deepEqual(items.map(i => `${i.provider}:${i.id}`), ['claude:alpha-meter', 'claude:zeta-meter', 'codex:zeta-meter']);
    const claudeAlpha = items.find(i => i.provider === 'claude' && i.id === 'alpha-meter');
    assert.equal(claudeAlpha?.usedPercentage, 2);
  });

  it('carries metadata when present and omits it when absent', () => {
    const states: Pick<ProviderUsageState, 'provider' | 'meters'>[] = [{
      provider: 'claude',
      meters: [
        usageMeter({
          id: 'with-metadata',
          label: 'With metadata',
          windowSeconds: 86_400,
          window: { usedPercentage: 42, resetsAtEpochSeconds: 1_800_000_000 }
        }),
        usageMeter({ id: 'without-metadata', label: 'Without metadata', window: {} })
      ]
    }];

    const items = buildUsageMeterDiscoveryItems(states);
    const withMetadata = items.find(i => i.id === 'with-metadata');
    const withoutMetadata = items.find(i => i.id === 'without-metadata');

    assert.equal(withMetadata?.usedPercentage, 42);
    assert.equal(withMetadata?.resetsAtEpochSeconds, 1_800_000_000);
    assert.equal(withMetadata?.windowSeconds, 86_400);

    assert.equal('usedPercentage' in (withoutMetadata ?? {}), false);
    assert.equal('resetsAtEpochSeconds' in (withoutMetadata ?? {}), false);
    assert.equal('windowSeconds' in (withoutMetadata ?? {}), false);
  });
});
