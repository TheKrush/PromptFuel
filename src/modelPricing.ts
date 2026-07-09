import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CsvPricingRow {
  provider: string;
  model: string;
  inputPer1m: number | undefined;
  outputPer1m: number | undefined;
  cacheWrite5mPer1m: number | undefined;
  cacheWrite1hPer1m: number | undefined;
  cacheReadPer1m: number | undefined;
  currency: string;
  effectiveDate: string;
  notes: string;
}

export interface ModelPricingMatch {
  row: CsvPricingRow;
  matchedKey: string;
}

export type ModelPricingTable = Map<string, Map<string, CsvPricingRow[]>>;

const EXPECTED_CSV_HEADER = 'provider,model,input_per_1m,output_per_1m,cache_write_5m_per_1m,cache_write_1h_per_1m,cache_read_per_1m,currency,effective_date,notes';
const VERSION_DATE_SUFFIX_PATTERN = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/;

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
    if (fields.length < 10) continue;

    const provider = fields[0].trim();
    const model = fields[1].trim();
    if (!provider || !model) continue;

    rows.push({
      provider,
      model,
      inputPer1m: parseOptionalNumber(fields[2]),
      outputPer1m: parseOptionalNumber(fields[3]),
      cacheWrite5mPer1m: parseOptionalNumber(fields[4]),
      cacheWrite1hPer1m: parseOptionalNumber(fields[5]),
      cacheReadPer1m: parseOptionalNumber(fields[6]),
      currency: fields[7].trim(),
      effectiveDate: fields[8].trim(),
      notes: fields.slice(9).join(',').trim(),
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

    const scheduledRows = providerMap.get(modelKey);
    if (scheduledRows) {
      scheduledRows.push(row);
      scheduledRows.sort(comparePricingRowEffectiveDate);
      continue;
    }

    providerMap.set(modelKey, [row]);
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

function comparePricingRowEffectiveDate(a: CsvPricingRow, b: CsvPricingRow): number {
  return a.effectiveDate.localeCompare(b.effectiveDate);
}

// Pricing schedules resolve against a UTC calendar date so runtime selection and tests
// share the same deterministic YYYY-MM-DD rule.
function currentUtcCalendarDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function resolveAsOfDate(asOfDate?: string): string {
  return asOfDate?.trim() || currentUtcCalendarDate();
}

function hasApprovedVersionSuffix(modelName: string, key: string): boolean {
  if (!modelName.startsWith(key)) {
    return false;
  }

  const suffix = modelName.slice(key.length);
  return VERSION_DATE_SUFFIX_PATTERN.test(suffix);
}

function matchesModelKey(modelName: string, key: string): boolean {
  return modelName === key || hasApprovedVersionSuffix(modelName, key);
}

function findApplicablePricingRow(rows: CsvPricingRow[], asOfDate: string): CsvPricingRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row.effectiveDate || row.effectiveDate <= asOfDate) {
      return row;
    }
  }

  return undefined;
}

export function findModelPricingInTable(
  table: ModelPricingTable,
  provider: string,
  modelName: string,
  asOfDate?: string
): ModelPricingMatch | undefined {
  const providerMap = table.get(provider.toLowerCase());
  if (!providerMap) return undefined;

  const normalized = modelName.toLowerCase();
  const resolvedAsOfDate = resolveAsOfDate(asOfDate);
  const keys = Array.from(providerMap.keys()).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (!matchesModelKey(normalized, key)) {
      continue;
    }

    const rows = providerMap.get(key)!;
    const row = findApplicablePricingRow(rows, resolvedAsOfDate);
    if (row) {
      return { row, matchedKey: key };
    }

    return undefined;
  }

  return undefined;
}

export function findModelPricing(provider: string, modelName: string, asOfDate?: string): ModelPricingMatch | undefined {
  return findModelPricingInTable(getLoadedTable(), provider, modelName, asOfDate);
}

export async function loadModelPricingCsv(extensionPath: string): Promise<void> {
  const csvPath = path.join(extensionPath, 'data', 'model-pricing-estimates.csv');
  const content = await fs.readFile(csvPath, 'utf-8');
  initModelPricingFromCsv(content);
}
