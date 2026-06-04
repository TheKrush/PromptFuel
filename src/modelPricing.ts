import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CsvPricingRow {
  provider: string;
  model: string;
  inputPer1m: number | undefined;
  outputPer1m: number | undefined;
  cacheWritePer1m: number | undefined;
  cacheReadPer1m: number | undefined;
}

export interface ModelPricingMatch {
  row: CsvPricingRow;
  matchedKey: string;
}

export type ModelPricingTable = Map<string, Map<string, CsvPricingRow>>;

const EXPECTED_CSV_HEADER = 'provider,model,input_per_1m,output_per_1m,cache_write_per_1m,cache_read_per_1m,currency,effective_date,notes';

function parseOptionalNumber(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function parseModelPricingCsv(csvContent: string): CsvPricingRow[] {
  const lines = csvContent.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].trim().toLowerCase();
  if (header !== EXPECTED_CSV_HEADER) return [];

  const rows: CsvPricingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split(',');
    if (fields.length < 6) continue;

    const provider = fields[0].trim();
    const model = fields[1].trim();
    if (!provider || !model) continue;

    rows.push({
      provider,
      model,
      inputPer1m: parseOptionalNumber(fields[2]),
      outputPer1m: parseOptionalNumber(fields[3]),
      cacheWritePer1m: parseOptionalNumber(fields[4]),
      cacheReadPer1m: parseOptionalNumber(fields[5]),
    });
  }

  return rows;
}

export function buildPricingTable(rows: CsvPricingRow[]): ModelPricingTable {
  const table: ModelPricingTable = new Map();
  for (const row of rows) {
    const providerKey = row.provider.toLowerCase();
    const modelKey = row.model.toLowerCase();
    let providerMap = table.get(providerKey);
    if (!providerMap) {
      providerMap = new Map();
      table.set(providerKey, providerMap);
    }
    providerMap.set(modelKey, row);
  }
  return table;
}

let loadedTable: ModelPricingTable | undefined;

export function getLoadedTable(): ModelPricingTable {
  return loadedTable ?? new Map();
}

export function initModelPricingFromCsv(csvContent: string): void {
  const rows = parseModelPricingCsv(csvContent);
  loadedTable = buildPricingTable(rows);
}

export function resetModelPricing(): void {
  loadedTable = undefined;
}

export function findModelPricingInTable(
  table: ModelPricingTable,
  provider: string,
  modelName: string
): ModelPricingMatch | undefined {
  const providerMap = table.get(provider.toLowerCase());
  if (!providerMap) return undefined;

  const normalized = modelName.toLowerCase();
  const keys = Array.from(providerMap.keys()).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (normalized.startsWith(key)) {
      return { row: providerMap.get(key)!, matchedKey: key };
    }
  }

  return undefined;
}

export function findModelPricing(provider: string, modelName: string): ModelPricingMatch | undefined {
  return findModelPricingInTable(getLoadedTable(), provider, modelName);
}

export async function loadModelPricingCsv(extensionPath: string): Promise<void> {
  const csvPath = path.join(extensionPath, 'data', 'model-pricing-estimates.csv');
  const content = await fs.readFile(csvPath, 'utf-8');
  initModelPricingFromCsv(content);
}
