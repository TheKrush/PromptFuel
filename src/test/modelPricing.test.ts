import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelPricingCsv,
  buildPricingTable,
  findModelPricingInTable,
  type CsvPricingRow,
  type ModelPricingTable
} from '../modelPricing';

const CSV_HEADER = 'provider,model,input_per_1m,output_per_1m,cache_write_per_1m,cache_read_per_1m,currency,effective_date,notes';

function sampleCsv(): string {
  return [
    CSV_HEADER,
    'claude,claude-sonnet-4-6,3,15,,,USD,2026-06-01,Claude Sonnet 4.6',
    'codex,gpt-5.4,2.50,15,,,USD,2026-06-01,GPT-5.4',
    'codex,codex-auto-review,1.75,14,,,USD,2026-06-01,Codex Auto Review',
    'claude,claude-opus-4-7,5,25,,,USD,2026-06-01,Claude Opus 4.7'
  ].join('\n');
}

describe('model pricing CSV parser', () => {
  it('parses all rows from valid CSV', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    assert.equal(rows.length, 4);
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
    assert.equal(rows[0].model, 'claude-sonnet-4-6');
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
    const csv = `${CSV_HEADER}\n\nclaude,sonnet,3,15,,,USD,2026-06-01,\n\ncodex,gpt5,5,30,,,USD,2026-06-01,\n`;
    const rows = parseModelPricingCsv(csv);
    assert.equal(rows.length, 2);
  });
});

describe('blank optional numeric fields', () => {
  it('parses blank cache_write as undefined', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    for (const row of rows) {
      assert.equal(row.cacheWritePer1m, undefined);
    }
  });

  it('parses blank cache_read as undefined', () => {
    const rows = parseModelPricingCsv(sampleCsv());
    for (const row of rows) {
      assert.equal(row.cacheReadPer1m, undefined);
    }
  });

  it('parses explicit zero cache values correctly', () => {
    const csv = `${CSV_HEADER}\nclaude,test,1,2,0,0,USD,2026-06-01,\n`;
    const rows = parseModelPricingCsv(csv);
    assert.equal(rows[0].cacheWritePer1m, 0);
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
    assert.equal(table.get('claude')!.size, 2);
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

  it('finds model with longest key match on partial prefix', () => {
    const csv = [
      CSV_HEADER,
      'codex,gpt-5.4,2.50,15,,,USD,2026-06-01,',
      'codex,gpt-5.4-mini,0.75,4.50,,,USD,2026-06-01,'
    ].join('\n');
    const t = buildPricingTable(parseModelPricingCsv(csv));

    const result = findModelPricingInTable(t, 'codex', 'gpt-5.4-mini-20260513');
    assert.ok(result);
    assert.equal(result.matchedKey, 'gpt-5.4-mini');
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
