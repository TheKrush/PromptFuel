import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelPricingCsv,
  buildPricingTable,
  findModelPricingInTable,
  type ModelPricingTable
} from '../modelPricing';

const CSV_HEADER = 'provider,model,input_per_1m,output_per_1m,cache_write_5m_per_1m,cache_write_1h_per_1m,cache_read_per_1m,currency,effective_date,notes';

function sampleCsv(): string {
  return [
    CSV_HEADER,
    'claude,claude-fable-5,10,50,12.50,20,1,USD,2026-06-11,Claude Fable 5',
    'claude,anthropic/claude-fable-5,10,50,12.50,20,1,USD,2026-06-11,OpenRouter-style alias',
    'claude,claude-sonnet-4-6,3,15,3.75,6,0.30,USD,2026-06-04,Claude Sonnet 4.6',
    'codex,gpt-5.4,2.50,15,,,0.25,USD,2026-06-04,GPT-5.4',
    'codex,codex-auto-review,1.75,14,,,0.175,USD,2026-06-04,Codex Auto Review',
    'claude,claude-opus-4-8,5,25,6.25,10,0.50,USD,2026-06-04,Claude Opus 4.8'
  ].join('\n');
}

describe('model pricing CSV parser', () => {
  it('parses all rows from valid CSV', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    assert.equal(rows.length, 6);
  });

  it('parses numeric values correctly', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const sonnet = rows.find(r => r.model === 'claude-sonnet-4-6')!;
    assert.equal(sonnet.inputPer1m, 3);
    assert.equal(sonnet.outputPer1m, 15);
  });

  it('parses decimal values correctly', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const gpt54 = rows.find(r => r.model === 'gpt-5.4')!;
    assert.equal(gpt54.inputPer1m, 2.50);
    assert.equal(gpt54.outputPer1m, 15);
  });

  it('parses provider and model strings', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    assert.equal(rows[0].provider, 'claude');
    assert.equal(rows[0].model, 'claude-fable-5');
    assert.equal(rows[0].currency, 'USD');
    assert.equal(rows[0].effectiveDate, '2026-06-11');
  });

  it('returns empty array for empty content', () => {
    assert.equal(parseModelPricingCsv('').length, 0);
  });

  it('returns empty array for header-only CSV', () => {
    assert.equal(parseModelPricingCsv(CSV_HEADER).length, 0);
  });

  it('returns empty array for wrong header', () => {
    const rows = parseModelPricingCsv('a,b,c\n1,2,3');
    assert.equal(rows.length, 0);
  });

  it('skips blank lines', () => {
    const csv = `${CSV_HEADER}\n\nclaude,sonnet,3,15,3.75,6,0.30,USD,2026-06-04,\n\ncodex,gpt5,5,30,,,0.50,USD,2026-06-04,\n`;
    const rows = parseModelPricingCsv(csv);
    assert.equal(rows.length, 2);
  });
});

describe('blank optional numeric fields', () => {
  it('parses blank cache_write_5m as undefined', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const gpt54 = rows.find(r => r.model === 'gpt-5.4')!;
    assert.equal(gpt54.cacheWrite5mPer1m, undefined);
  });

  it('parses blank cache_write_1h as undefined', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const gpt54 = rows.find(r => r.model === 'gpt-5.4')!;
    assert.equal(gpt54.cacheWrite1hPer1m, undefined);
  });

  it('parses cache_write and cache_read values', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const sonnet = rows.find(r => r.model === 'claude-sonnet-4-6')!;
    assert.equal(sonnet.cacheWrite5mPer1m, 3.75);
    assert.equal(sonnet.cacheWrite1hPer1m, 6);
    assert.equal(sonnet.cacheReadPer1m, 0.30);

    const fable = rows.find(r => r.model === 'claude-fable-5')!;
    assert.equal(fable.cacheWrite5mPer1m, 12.50);
    assert.equal(fable.cacheWrite1hPer1m, 20);
    assert.equal(fable.cacheReadPer1m, 1);
  });

  it('parses explicit zero cache values correctly', () => {
    const csv = `${CSV_HEADER}\nclaude,test,1,2,0,0,0,USD,2026-06-04,\n`;
    const rows = parseModelPricingCsv(csv);
    assert.equal(rows[0].cacheWrite5mPer1m, 0);
    assert.equal(rows[0].cacheWrite1hPer1m, 0);
    assert.equal(rows[0].cacheReadPer1m, 0);
  });
});

describe('buildPricingTable', () => {
  it('builds a lookup table keyed by provider then model', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    const table = buildPricingTable(rows);
    assert.equal(table.size, 2);
    assert.ok(table.has('claude'));
    assert.ok(table.has('codex'));
    assert.equal(table.get('claude')!.size, 4);
    assert.equal(table.get('codex')!.size, 2);
  });
});

describe('findModelPricingInTable', () => {
  let table: ModelPricingTable;

  before(() => {
    table = buildPricingTable(parseModelPricingCsv(sampleCsv()));
  });

  it('finds known model by exact name', () => {
    const result = findModelPricingInTable(table, 'claude', 'claude-sonnet-4-6');
    assert.ok(result);
    assert.equal(result.matchedKey, 'claude-sonnet-4-6');
    assert.equal(result.row.inputPer1m, 3);
    assert.equal(result.row.outputPer1m, 15);
  });

  it('finds known model by prefix match', () => {
    const result = findModelPricingInTable(table, 'claude', 'claude-sonnet-4-6-20260514');
    assert.ok(result);
    assert.equal(result.matchedKey, 'claude-sonnet-4-6');
    assert.equal(result.row.inputPer1m, 3);
  });

  it('finds Claude Fable 5 direct and OpenRouter-style aliases', () => {
    const direct = findModelPricingInTable(table, 'claude', 'claude-fable-5');
    assert.ok(direct);
    assert.equal(direct.matchedKey, 'claude-fable-5');
    assert.equal(direct.row.inputPer1m, 10);
    assert.equal(direct.row.outputPer1m, 50);

    const alias = findModelPricingInTable(table, 'claude', 'anthropic/claude-fable-5');
    assert.ok(alias);
    assert.equal(alias.matchedKey, 'anthropic/claude-fable-5');
    assert.equal(alias.row.cacheWrite5mPer1m, 12.50);
    assert.equal(alias.row.cacheWrite1hPer1m, 20);
    assert.equal(alias.row.cacheReadPer1m, 1);
  });

  it('finds model with longest key match on partial prefix', () => {
    const csv = [
      CSV_HEADER,
      'codex,gpt-5.4,2.50,15,,,0.25,USD,2026-06-04,',
      'codex,gpt-5.4-mini,0.75,4.50,,,0.075,USD,2026-06-04,'
    ].join('\n');
    const t = buildPricingTable(parseModelPricingCsv(csv));

    const result = findModelPricingInTable(t, 'codex', 'gpt-5.4-mini-20260513');
    assert.ok(result);
    assert.equal(result.matchedKey, 'gpt-5.4-mini');
  });

  it('finds PromptFuel codex rows', () => {
    const result = findModelPricingInTable(table, 'codex', 'gpt-5.4-20260513');
    assert.ok(result);
    assert.equal(result.matchedKey, 'gpt-5.4');
    assert.equal(result.row.provider, 'codex');
  });

  it('returns undefined for unknown provider', () => {
    const result = findModelPricingInTable(table, 'unknown', 'some-model');
    assert.equal(result, undefined);
  });

  it('returns undefined for unknown model', () => {
    const result = findModelPricingInTable(table, 'claude', 'claude-unknown-model');
    assert.equal(result, undefined);
  });

  it('returns undefined for synthetic model names', () => {
    const result = findModelPricingInTable(table, 'codex', '<synthetic>:o3-20260513');
    assert.equal(result, undefined);
  });

  it('performs case-insensitive lookup', () => {
    const result = findModelPricingInTable(table, 'CLAUDE', 'CLAUDE-SONNET-4-6');
    assert.ok(result);
    assert.equal(result.matchedKey, 'claude-sonnet-4-6');
  });
});
