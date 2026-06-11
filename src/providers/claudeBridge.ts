import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProviderUsageState } from '../types';
import { isStale } from '../usageTime';

export async function readClaudeBridgeState(stateDirectory: string): Promise<ProviderUsageState> {
  const file = path.join(stateDirectory, 'claude.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as ProviderUsageState;
    return {
      ...parsed,
      provider: 'claude',
      sourceKind: 'statusLine',
      source: 'local statusLine/hook state',
      stale: isStale(parsed.lastUpdatedEpochMs)
    };
  } catch (error) {
    return {
      provider: 'claude',
      sourceKind: 'statusLine',
      source: 'local statusLine/hook state',
      stale: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
