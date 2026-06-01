import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProviderUsageState } from '../types';
import { isStale } from '../usageTime';

interface CodexCompletedTurnsBridgeFile {
  schemaVersion?: number;
  provider?: string;
  source?: string;
  sourceConfidence?: string;
  lastUpdatedEpochMs?: number;
  bridgeStatus?: {
    configured?: boolean;
    lastHookEpochMs?: number | null;
    lastError?: string | null;
    message?: string;
    observedPayload?: CodexObservedPayload | null;
  };
  today?: unknown;
}

interface CodexObservedPayload {
  hasInput?: boolean;
  jsonParsed?: boolean;
  safeTopLevelKeys?: string[];
  hasModelField?: boolean;
  hasTimestampField?: boolean;
  hasUsageObject?: boolean;
  hasInputTokenField?: boolean;
  hasOutputTokenField?: boolean;
  hasCacheTokenField?: boolean;
  hasReasoningTokenField?: boolean;
  hasCompletionSignal?: boolean;
}

const LEGACY_CODEX_STATE_FILENAME = 'codex.json';
const COMPLETED_TURNS_STATE_FILENAME = 'codex-completed-turns.json';

export async function readCodexBridgeState(stateDirectory: string): Promise<ProviderUsageState | undefined> {
  return await readCodexCompletedTurnsBridgeState(stateDirectory)
    ?? await readLegacyCodexBridgeState(stateDirectory);
}

async function readCodexCompletedTurnsBridgeState(stateDirectory: string): Promise<ProviderUsageState | undefined> {
  const file = path.join(stateDirectory, COMPLETED_TURNS_STATE_FILENAME);

  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as CodexCompletedTurnsBridgeFile;

    if (parsed.provider !== 'codex') {
      return undefined;
    }

    const message = parsed.bridgeStatus?.message
      ?? 'Codex completed-turn bridge state is present, but trusted completed-turn usage is not available yet.';

    const observed = formatObservedPayload(parsed.bridgeStatus?.observedPayload);
    const confidence = typeof parsed.sourceConfidence === 'string'
      ? parsed.sourceConfidence
      : 'unavailable';

    return {
      provider: 'codex',
      source: 'Codex completed-turn bridge status',
      lastUpdatedEpochMs: parsed.lastUpdatedEpochMs,
      stale: isStale(parsed.lastUpdatedEpochMs),
      error: observed
        ? `${message} Source confidence: ${confidence}. ${observed}`
        : `${message} Source confidence: ${confidence}. No hook payload shape observed yet.`,
      diagnosticSeverity: 'info',
      diagnostics: {
        usageFieldsFound: Boolean(parsed.bridgeStatus?.observedPayload?.hasUsageObject),
        quotaFieldsFound: false
      }
    };
  } catch {
    return undefined;
  }
}

async function readLegacyCodexBridgeState(stateDirectory: string): Promise<ProviderUsageState | undefined> {
  const file = path.join(stateDirectory, LEGACY_CODEX_STATE_FILENAME);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as ProviderUsageState;
    return {
      ...parsed,
      provider: 'codex',
      source: 'local Codex bridge state',
      stale: isStale(parsed.lastUpdatedEpochMs)
    };
  } catch {
    return undefined;
  }
}

function formatObservedPayload(observed: CodexObservedPayload | null | undefined): string | undefined {
  if (!observed?.hasInput) {
    return undefined;
  }

  if (!observed.jsonParsed) {
    return 'Observed hook payload input, but it was not valid JSON.';
  }

  const signals = [
    observed.hasModelField ? 'model' : undefined,
    observed.hasTimestampField ? 'timestamp' : undefined,
    observed.hasUsageObject ? 'usage' : undefined,
    observed.hasInputTokenField ? 'input tokens' : undefined,
    observed.hasOutputTokenField ? 'output tokens' : undefined,
    observed.hasCacheTokenField ? 'cache tokens' : undefined,
    observed.hasReasoningTokenField ? 'reasoning tokens' : undefined,
    observed.hasCompletionSignal ? 'completion signal' : undefined
  ].filter((value): value is string => Boolean(value));

  const safeKeys = observed.safeTopLevelKeys?.length
    ? ` Safe top-level keys: ${observed.safeTopLevelKeys.join(', ')}.`
    : '';

  if (signals.length === 0) {
    return `Observed JSON hook payload, but no completed-turn candidate signals were found.${safeKeys}`;
  }

  return `Observed JSON hook payload shape signals: ${signals.join(', ')}.${safeKeys}`;
}
