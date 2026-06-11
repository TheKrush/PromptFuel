export type ProviderName = 'claude' | 'codex';

export type DisplayMode = 'compact' | 'standard';

export interface SourceConfigEntry {
  enabled: boolean;
  label: string;
  shortLabel: string;
  statusBar: boolean;
}

export const KNOWN_PROVIDERS: Record<string, SourceConfigEntry> = {
  claude: { enabled: true, label: 'Claude', shortLabel: 'C', statusBar: true },
  codex: { enabled: true, label: 'Codex', shortLabel: 'X', statusBar: true }
};

export const LOCAL_PROVIDER_IDS = new Set<string>(['claude', 'codex']);

export interface LimitWindow {
  usedPercentage?: number;
  resetsAtEpochSeconds?: number;
  sourceKind?: QuotaSourceKind;
  sourceLabel?: string;
  sourceUpdatedEpochMs?: number;
  sourceAuthorityRank?: number;
}

export type QuotaSourceKind = 'authenticated' | 'statusLine' | 'hook' | 'localSession' | 'cache' | 'stale' | 'unknown';

export interface ProviderUsageState {
  provider: ProviderName;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  sevenDayOpus?: LimitWindow;
  model?: string;
  sessionId?: string;
  workspace?: string;
  sourceKind?: QuotaSourceKind;
  source?: string;
  lastUpdatedEpochMs?: number;
  lastLocalUpdateEpochMs?: number;
  lastAuthenticatedRefreshEpochMs?: number;
  nextAuthenticatedRefreshEpochMs?: number;
  authenticatedBackoffUntilEpochMs?: number;
  authenticatedStatus?: AuthenticatedQuotaStatus;
  authenticatedHttpStatus?: number;
  authenticatedError?: string;
  lastRequestId?: string;
  lastUsageTimestamp?: string;
  lastEntrypoint?: string;
  stale?: boolean;
  error?: string;
  diagnosticSeverity?: 'info' | 'warning' | 'error';
  tracing?: UsageTracing;
  diagnostics?: ProviderDiagnostics;
  ignoredQuotaSource?: string;
}

export type AuthenticatedQuotaStatus =
  | 'disabled'
  | 'not_configured'
  | 'backoff'
  | 'success'
  | 'http_error'
  | 'network_error'
  | 'auth_expired'
  | 'parse_error'
  | 'skipped';

export interface UsageTracing {
  totalCostUsd?: number;
  totalDurationMs?: number;
  totalApiDurationMs?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  contextUsedPercentage?: number;
  contextRemainingPercentage?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCachedInputTokens?: number;
  totalReasoningOutputTokens?: number;
  totalTokens?: number;
  currentInputTokens?: number;
  currentOutputTokens?: number;
  currentCachedInputTokens?: number;
  currentReasoningOutputTokens?: number;
  currentTotalTokens?: number;
  currentCacheCreationInputTokens?: number;
  currentCacheReadInputTokens?: number;
  currentEphemeral1hCacheCreationInputTokens?: number;
  currentEphemeral5mCacheCreationInputTokens?: number;
}

export interface ProviderDiagnostics {
  sessionsPath?: string;
  sessionFilesFound?: number;
  sessionFilesInspected?: number;
  recordsRead?: number;
  newestSessionTimestamp?: string;
  usageFieldsFound?: boolean;
  quotaFieldsFound?: boolean;
}
