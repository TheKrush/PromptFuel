import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthenticatedQuotaStatus,
  AuthenticatedQuotaWindowKey,
  AuthenticatedQuotaWindowObservation,
  AuthenticatedQuotaWindowState,
  LimitWindow,
  ProviderName,
  ProviderUsageState,
  UsageMeter,
  UsageMeterScope
} from '../types';
import { isStale } from '../usageTime';
import { USER_AGENT } from '../version';

const CACHE_FILE = 'authenticated-quota-cache.json';
const SOCKET_TIMEOUT_MS = 5000;
const HARD_DEADLINE_MS = 10000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const FIVE_HOUR_SECONDS = 18_000;
const SEVEN_DAY_SECONDS = 604_800;
const KNOWN_CLAUDE_PRIMARY_KEYS = new Set(['five_hour', 'seven_day', 'seven_day_opus']);
const CODEX_PRIMARY_WINDOW_ALIASES: ReadonlyArray<{
  alias: string;
  fallbackKey: AuthenticatedQuotaWindowKey;
}> = [
  { alias: 'primary_window', fallbackKey: 'fiveHour' },
  { alias: 'primary', fallbackKey: 'fiveHour' },
  { alias: 'secondary_window', fallbackKey: 'sevenDay' },
  { alias: 'secondary', fallbackKey: 'sevenDay' }
];
const KNOWN_CODEX_PRIMARY_KEYS = new Set(CODEX_PRIMARY_WINDOW_ALIASES.map(({ alias }) => alias));

export const CLAUDE_OPUS_USAGE_METER_ID = 'claude-seven-day-opus';

export interface ParsedProviderQuota {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  meters?: UsageMeter[];
  primaryWindowObservations?: Partial<Record<AuthenticatedQuotaWindowKey, AuthenticatedQuotaWindowObservation>>;
}

export interface AuthenticatedQuotaFetchOutcome {
  provider: ProviderName;
  state: ProviderUsageState;
  success: boolean;
  retryAfterSeconds?: number;
}

interface HttpJsonResult {
  ok: boolean;
  statusCode?: number;
  body?: unknown;
  retryAfterSeconds?: number;
}

export async function readAuthenticatedQuotaCache(stateDirectory: string): Promise<Partial<Record<ProviderName, ProviderUsageState>>> {
  const file = path.join(stateDirectory, CACHE_FILE);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as { providers?: ProviderUsageState[] };
    const result: Partial<Record<ProviderName, ProviderUsageState>> = {};
    for (const state of parsed.providers ?? []) {
      if (state.provider === 'claude') {
        const { authenticatedWindows: _authenticatedWindows, ...legacyClaudeState } = state;
        result[state.provider] = {
          ...legacyClaudeState,
          meters: cachedMetersForState(state),
          stale: isStale(state.lastUpdatedEpochMs ?? state.lastAuthenticatedRefreshEpochMs),
          source: state.source ?? 'stale cached authenticated quota'
        };
        continue;
      }

      if (state.provider === 'codex') {
        const authenticatedWindows = cachedAuthenticatedWindowStates(state);
        const stale = isStale(state.lastUpdatedEpochMs ?? state.lastAuthenticatedRefreshEpochMs);
        result[state.provider] = {
          ...state,
          fiveHour: cacheWindow(state.fiveHour, authenticatedWindows.fiveHour),
          sevenDay: cacheWindow(state.sevenDay, authenticatedWindows.sevenDay),
          meters: cachedMetersForState(state),
          sourceKind: stale ? 'stale' : 'cache',
          stale,
          source: stale ? 'stale cached authenticated quota' : 'cached authenticated quota',
          ...(Object.keys(authenticatedWindows).length > 0 ? { authenticatedWindows } : {})
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function writeAuthenticatedQuotaCache(
  stateDirectory: string,
  states: Partial<Record<ProviderName, ProviderUsageState>>
): Promise<void> {
  const providers = Object.values(states)
    .filter((state): state is ProviderUsageState => Boolean(state))
    .map(sanitizeAuthenticatedState);

  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(path.join(stateDirectory, CACHE_FILE), JSON.stringify({ providers }, undefined, 2), 'utf8');
}

export async function fetchAuthenticatedQuota(provider: ProviderName): Promise<AuthenticatedQuotaFetchOutcome> {
  if (provider === 'claude') {
    return fetchClaudeQuota();
  }
  return fetchCodexQuota();
}

async function fetchClaudeQuota(): Promise<AuthenticatedQuotaFetchOutcome> {
  const provider: ProviderName = 'claude';
  const credentialsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
  const credential = await readJsonObject(credentialsPath);
  const oauth = asRecord(credential?.claudeAiOauth);
  const token = asString(oauth?.accessToken);
  const expiresAt = toNumber(oauth?.expiresAt);

  if (!token) {
    return authFailure(provider, 'not_configured', 'Claude OAuth credentials were not found.');
  }
  if (expiresAt !== undefined && expiresAt <= Date.now() + 60_000) {
    return authFailure(provider, 'auth_expired', 'Claude OAuth token is expired or near expiry.');
  }

  const response = await requestJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': USER_AGENT
  });

  if (!response.ok) {
    return httpFailure(provider, response);
  }

  const quota = parseClaudeQuotaPayload(asRecord(response.body));
  if (!quota) {
    return authFailure(provider, 'parse_error', 'Claude usage response did not include recognizable 5h/7d or generic meter windows.');
  }

  return buildAuthenticatedQuotaSuccessOutcome(provider, quota, response.statusCode);
}

async function fetchCodexQuota(): Promise<AuthenticatedQuotaFetchOutcome> {
  const provider: ProviderName = 'codex';
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  const auth = await readJsonObject(authPath);
  const tokens = asRecord(auth?.tokens);
  const token = asString(tokens?.access_token);
  const accountId = asString(tokens?.account_id);

  if (!token) {
    return authFailure(provider, 'not_configured', 'Codex ChatGPT OAuth credentials were not found.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Origin: 'https://chatgpt.com',
    Referer: 'https://chatgpt.com/',
    'User-Agent': 'codex-cli'
  };
  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const response = await requestJson('https://chatgpt.com/backend-api/wham/usage', headers);

  if (!response.ok) {
    return httpFailure(provider, response);
  }

  const quota = parseCodexQuotaPayload(asRecord(response.body));
  if (!quota) {
    return authFailure(provider, 'parse_error', 'Codex usage response did not include recognizable 5h/7d or generic meter windows.');
  }

  return buildAuthenticatedQuotaSuccessOutcome(provider, quota, response.statusCode);
}

export function buildAuthenticatedQuotaSuccessOutcome(
  provider: ProviderName,
  quota: ParsedProviderQuota,
  statusCode: number | undefined,
  nowEpochMs = Date.now()
): AuthenticatedQuotaFetchOutcome {
  return {
    provider,
    success: true,
    state: {
      provider,
      fiveHour: quota.fiveHour,
      sevenDay: quota.sevenDay,
      meters: quota.meters,
      sourceKind: 'authenticated',
      source: 'live authenticated refresh',
      lastUpdatedEpochMs: nowEpochMs,
      lastAuthenticatedRefreshEpochMs: nowEpochMs,
      ...(quota.primaryWindowObservations
        ? { authenticatedWindows: authenticatedWindowStatesFromObservations(quota.primaryWindowObservations, nowEpochMs) }
        : {}),
      authenticatedStatus: 'success',
      authenticatedHttpStatus: statusCode,
      stale: false
    }
  };
}

function httpFailure(provider: ProviderName, response: HttpJsonResult): AuthenticatedQuotaFetchOutcome {
  return {
    provider,
    success: false,
    retryAfterSeconds: response.retryAfterSeconds,
    state: {
      provider,
      sourceKind: 'cache',
      source: 'authenticated quota provider',
      lastAuthenticatedRefreshEpochMs: Date.now(),
      authenticatedStatus: response.statusCode === undefined
        ? 'network_error'
        : response.statusCode === 401 || response.statusCode === 403
          ? 'auth_expired'
          : 'http_error',
      authenticatedHttpStatus: response.statusCode,
      authenticatedError: response.statusCode ? `HTTP ${response.statusCode}` : 'Network request failed',
      stale: true,
      diagnosticSeverity: response.statusCode === 401 || response.statusCode === 403 ? 'warning' : 'info'
    }
  };
}

function authFailure(
  provider: ProviderName,
  status: AuthenticatedQuotaStatus,
  message: string
): AuthenticatedQuotaFetchOutcome {
  return {
    provider,
    success: false,
    state: {
      provider,
      sourceKind: 'cache',
      source: 'authenticated quota provider',
      lastAuthenticatedRefreshEpochMs: Date.now(),
      authenticatedStatus: status,
      authenticatedError: message,
      stale: true,
      diagnosticSeverity: status === 'not_configured' ? 'info' : 'warning'
    }
  };
}

async function requestJson(endpoint: string, headers: Record<string, string>): Promise<HttpJsonResult> {
  return new Promise(resolve => {
    let settled = false;
    let hardDeadline: NodeJS.Timeout | undefined;
    const finish = (result: HttpJsonResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (hardDeadline) {
        clearTimeout(hardDeadline);
        hardDeadline = undefined;
      }
      resolve(result);
    };

    const req = https.request(endpoint, { method: 'GET', headers, timeout: SOCKET_TIMEOUT_MS }, res => {
      const chunks: Buffer[] = [];
      let bytes = 0;

      res.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(buffer);
      });

      res.on('end', () => {
        const retryAfterSeconds = parseRetryAfter(res.headers['retry-after']);
        const statusCode = res.statusCode;
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          finish({ ok: false, statusCode, retryAfterSeconds });
          return;
        }

        try {
          finish({
            ok: true,
            statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            retryAfterSeconds
          });
        } catch {
          finish({ ok: false, statusCode, retryAfterSeconds });
        }
      });
    });

    hardDeadline = setTimeout(() => {
      if (!settled) {
        req.destroy(new Error('hard deadline exceeded'));
      }
    }, HARD_DEADLINE_MS);

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', () => finish({ ok: false }));
    req.on('close', () => {
      if (hardDeadline) {
        clearTimeout(hardDeadline);
        hardDeadline = undefined;
      }
    });
    req.end();
  });
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function parseClaudeQuotaPayload(body: Record<string, unknown> | undefined): ParsedProviderQuota | undefined {
  if (!body) {
    return undefined;
  }

  const fiveHour = parseClaudeWindow(asRecord(body.five_hour));
  const sevenDay = parseClaudeWindow(asRecord(body.seven_day));
  const meters = collectUsageMeters([
    buildUsageMeter(
      CLAUDE_OPUS_USAGE_METER_ID,
      'opus 7d',
      'modelFamily',
      parseClaudeWindow(asRecord(body.seven_day_opus)),
      { windowSeconds: SEVEN_DAY_SECONDS }
    ),
    ...Object.entries(body).map(([key, value]) => {
      if (KNOWN_CLAUDE_PRIMARY_KEYS.has(key)) {
        return undefined;
      }
      return parseClaudeUsageMeter(key, asRecord(value));
    })
  ]);

  if (!hasParsedQuota(fiveHour, sevenDay, meters)) {
    return undefined;
  }

  return {
    fiveHour,
    sevenDay,
    ...(meters ? { meters } : {})
  };
}

export function parseCodexQuotaPayload(body: Record<string, unknown> | undefined): ParsedProviderQuota | undefined {
  if (!body) {
    return undefined;
  }

  const rateLimit = asRecord(body.rate_limit) ?? asRecord(body.rate_limits);
  const candidates = collectCodexPrimaryWindowCandidates(rateLimit);
  const fiveHourResult = parseCodexPrimaryWindow(candidates, 'fiveHour', FIVE_HOUR_SECONDS);
  const sevenDayResult = parseCodexPrimaryWindow(candidates, 'sevenDay', SEVEN_DAY_SECONDS);
  const fiveHour = fiveHourResult.window;
  const sevenDay = sevenDayResult.window;
  const meters = collectUsageMeters(
    Object.entries(rateLimit ?? {}).map(([key, value]) => {
      if (KNOWN_CODEX_PRIMARY_KEYS.has(key)) {
        return undefined;
      }
      return parseCodexUsageMeter(key, asRecord(value));
    })
  );

  if (!hasParsedQuota(fiveHour, sevenDay, meters)) {
    return undefined;
  }

  return {
    fiveHour,
    sevenDay,
    ...(meters ? { meters } : {}),
    primaryWindowObservations: {
      fiveHour: fiveHourResult.observation,
      sevenDay: sevenDayResult.observation
    }
  };
}

export function parseClaudeWindow(window: Record<string, unknown> | undefined): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  return parsedWindow(
    normalizePercent(toNumber(window.utilization) ?? toNumber(window.used_percentage) ?? toNumber(window.usedPercent)),
    parseResetEpochSeconds(window.resets_at) ?? parseResetEpochSeconds(window.reset_at) ?? parseResetEpochSeconds(window.resetsAt)
  );
}

export function parseCodexWindow(window: Record<string, unknown> | undefined, expectedSeconds?: number): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  const seconds = parseUsageMeterWindowSeconds(window);
  if (expectedSeconds !== undefined && seconds !== undefined && seconds !== expectedSeconds) {
    return undefined;
  }

  // used_percent and usedPercentage are 0–100 values; only utilization is a 0–1 fraction
  const rawPercent = toNumber(window.used_percent) ?? toNumber(window.usedPercentage);
  const usedPercentage = rawPercent !== undefined
    ? Math.max(0, Math.min(100, rawPercent))
    : normalizePercent(toNumber(window.utilization));

  return parsedWindow(
    usedPercentage,
    parseResetEpochSeconds(window.reset_at) ?? parseResetEpochSeconds(window.resets_at) ?? parseResetEpochSeconds(window.resetsAtEpochSeconds)
  );
}

export function parsedWindow(usedPercentage: number | undefined, resetsAtEpochSeconds: number | undefined): LimitWindow | undefined {
  if (usedPercentage === undefined && resetsAtEpochSeconds === undefined) {
    return undefined;
  }
  return { usedPercentage, resetsAtEpochSeconds };
}

function sanitizeAuthenticatedState(state: ProviderUsageState): ProviderUsageState {
  return {
    provider: state.provider,
    fiveHour: state.fiveHour,
    sevenDay: state.sevenDay,
    meters: state.meters,
    sourceKind: state.sourceKind,
    source: state.source,
    lastUpdatedEpochMs: state.lastUpdatedEpochMs,
    lastAuthenticatedRefreshEpochMs: state.lastAuthenticatedRefreshEpochMs,
    nextAuthenticatedRefreshEpochMs: state.nextAuthenticatedRefreshEpochMs,
    authenticatedBackoffUntilEpochMs: state.authenticatedBackoffUntilEpochMs,
    authenticatedStatus: state.authenticatedStatus,
    authenticatedHttpStatus: state.authenticatedHttpStatus,
    authenticatedError: state.authenticatedError,
    authenticatedWindows: state.authenticatedWindows,
    stale: state.stale,
    diagnosticSeverity: state.diagnosticSeverity
  };
}

interface ParsedCodexPrimaryWindow {
  window?: LimitWindow;
  observation: AuthenticatedQuotaWindowObservation;
}

interface CodexPrimaryWindowCandidate {
  value: unknown;
  logicalKey?: AuthenticatedQuotaWindowKey;
}

function collectCodexPrimaryWindowCandidates(
  rateLimit: Record<string, unknown> | undefined
): CodexPrimaryWindowCandidate[] {
  return CODEX_PRIMARY_WINDOW_ALIASES
    .filter(({ alias }) => Object.prototype.hasOwnProperty.call(rateLimit ?? {}, alias))
    .map(({ alias, fallbackKey }) => {
      const value = rateLimit?.[alias];
      const record = asRecord(value);
      if (!record) {
        return { value, logicalKey: fallbackKey };
      }

      const durationSeconds = parseUsageMeterWindowSeconds(record);
      if (durationSeconds === FIVE_HOUR_SECONDS) {
        return { value, logicalKey: 'fiveHour' as const };
      }
      if (durationSeconds === SEVEN_DAY_SECONDS) {
        return { value, logicalKey: 'sevenDay' as const };
      }
      if (durationSeconds !== undefined || hasCodexWindowDurationMetadata(record)) {
        return { value };
      }

      return { value, logicalKey: fallbackKey };
    });
}

function parseCodexPrimaryWindow(
  candidates: CodexPrimaryWindowCandidate[],
  logicalKey: AuthenticatedQuotaWindowKey,
  expectedSeconds: number
): ParsedCodexPrimaryWindow {
  const values = candidates
    .filter(candidate => candidate.logicalKey === logicalKey)
    .map(candidate => candidate.value);

  if (values.length === 0) {
    return { observation: 'absent' };
  }

  const records = values.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value));
  if (records.some(window => asBoolean(window.unsupported) === true || asBoolean(window.supported) === false)) {
    return { observation: 'unsupported' };
  }
  if (records.some(window => asBoolean(window.disabled) === true || asBoolean(window.enabled) === false)) {
    return { observation: 'disabled' };
  }

  for (const value of values) {
    const window = parseCodexWindow(asRecord(value), expectedSeconds);
    if (window?.usedPercentage !== undefined) {
      return { window, observation: 'valid' };
    }
  }
  if (values.some(value => value === null)) {
    return { observation: 'null' };
  }

  return { observation: 'malformed' };
}

function hasCodexWindowDurationMetadata(window: Record<string, unknown>): boolean {
  return ['limit_window_seconds', 'window_seconds', 'windowSeconds', 'window_minutes']
    .some(field => Object.prototype.hasOwnProperty.call(window, field));
}

export function authenticatedWindowStatesFromObservations(
  observations: NonNullable<ParsedProviderQuota['primaryWindowObservations']>,
  nowEpochMs: number
): Partial<Record<AuthenticatedQuotaWindowKey, AuthenticatedQuotaWindowState>> {
  return {
    fiveHour: authenticatedWindowStateFromObservation(observations.fiveHour ?? 'absent', nowEpochMs),
    sevenDay: authenticatedWindowStateFromObservation(observations.sevenDay ?? 'absent', nowEpochMs)
  };
}

function authenticatedWindowStateFromObservation(
  observation: AuthenticatedQuotaWindowObservation,
  nowEpochMs: number
): AuthenticatedQuotaWindowState {
  if (observation === 'valid') {
    return { observation, availability: 'live', lastLiveEpochMs: nowEpochMs };
  }
  return { observation, availability: 'unavailable' };
}

function cachedAuthenticatedWindowStates(
  state: ProviderUsageState
): Partial<Record<AuthenticatedQuotaWindowKey, AuthenticatedQuotaWindowState>> {
  const fiveHour = cachedAuthenticatedWindowState(state.authenticatedWindows?.fiveHour, state.fiveHour, state.lastUpdatedEpochMs);
  const sevenDay = cachedAuthenticatedWindowState(state.authenticatedWindows?.sevenDay, state.sevenDay, state.lastUpdatedEpochMs);
  return {
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {})
  };
}

function cachedAuthenticatedWindowState(
  existing: AuthenticatedQuotaWindowState | undefined,
  window: LimitWindow | undefined,
  legacyLastUpdatedEpochMs: number | undefined
): AuthenticatedQuotaWindowState | undefined {
  if (!existing && !window) {
    return undefined;
  }

  if (!window) {
    return existing
      ? {
        observation: existing.observation,
        availability: 'unavailable',
        ...(existing.lastLiveEpochMs !== undefined ? { lastLiveEpochMs: existing.lastLiveEpochMs } : {})
      }
      : undefined;
  }

  const lastLiveEpochMs = existing?.lastLiveEpochMs
    ?? window.sourceUpdatedEpochMs
    ?? legacyLastUpdatedEpochMs;

  return {
    observation: existing?.observation ?? 'valid',
    availability: isStale(lastLiveEpochMs) ? 'stale' : 'cached',
    ...(lastLiveEpochMs ? { lastLiveEpochMs } : {})
  };
}

function cacheWindow(
  window: LimitWindow | undefined,
  authenticatedWindow: AuthenticatedQuotaWindowState | undefined
): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }

  const stale = authenticatedWindow?.availability === 'stale';

  return {
    ...window,
    sourceKind: stale ? 'stale' : 'cache',
    sourceLabel: stale ? 'stale cached quota snapshot' : 'cached quota snapshot',
    sourceUpdatedEpochMs: window.sourceUpdatedEpochMs ?? authenticatedWindow?.lastLiveEpochMs
  };
}

function cachedMetersForState(state: ProviderUsageState): UsageMeter[] | undefined {
  const record = state as ProviderUsageState & Record<string, unknown>;
  const meters = Array.isArray(record.meters) ? record.meters as UsageMeter[] : [];
  const legacyOpus = state.provider === 'claude'
    ? buildUsageMeter(
      CLAUDE_OPUS_USAGE_METER_ID,
      'opus 7d',
      'modelFamily',
      parseLegacyCachedOpusWindow(asRecord(record.sevenDayOpus)),
      { windowSeconds: SEVEN_DAY_SECONDS, requireUsedPercentage: true }
    )
    : undefined;
  return collectUsageMeters([...meters, legacyOpus]);
}

// Legacy cached sevenDayOpus blobs are already a LimitWindow-shaped object
// ({ usedPercentage, resetsAtEpochSeconds }), not a raw provider payload window
// (which uses aliases like used_percentage/utilization/resets_at). Read the
// legacy fields directly instead of routing through parseClaudeWindow's aliases.
function parseLegacyCachedOpusWindow(window: Record<string, unknown> | undefined): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  return parsedWindow(
    toNumber(window.usedPercentage),
    parseResetEpochSeconds(window.resetsAtEpochSeconds)
  );
}

function parseClaudeUsageMeter(key: string, window: Record<string, unknown> | undefined): UsageMeter | undefined {
  if (!window) {
    return undefined;
  }
  return buildUsageMeter(
    asString(window.id) ?? key,
    parseUsageMeterLabel(asString(window.label) ?? asString(window.display_label) ?? asString(window.name), key, parseUsageMeterWindowSeconds(window)),
    parseUsageMeterScope(window),
    parseClaudeWindow(window),
    {
      windowSeconds: parseUsageMeterWindowSeconds(window),
      rollup: asBoolean(window.rollup),
      temporary: asBoolean(window.temporary),
      expiresAtEpochSeconds: parseResetEpochSeconds(window.expires_at) ?? parseResetEpochSeconds(window.expiresAtEpochSeconds),
      requireUsedPercentage: true
    }
  );
}

function parseCodexUsageMeter(key: string, window: Record<string, unknown> | undefined): UsageMeter | undefined {
  if (!window) {
    return undefined;
  }
  const windowSeconds = parseUsageMeterWindowSeconds(window);
  return buildUsageMeter(
    asString(window.id) ?? key,
    parseUsageMeterLabel(asString(window.label) ?? asString(window.display_label) ?? asString(window.name), key, windowSeconds),
    parseUsageMeterScope(window),
    parseCodexWindow(window),
    {
      windowSeconds,
      rollup: asBoolean(window.rollup),
      temporary: asBoolean(window.temporary),
      expiresAtEpochSeconds: parseResetEpochSeconds(window.expires_at) ?? parseResetEpochSeconds(window.expiresAtEpochSeconds),
      requireUsedPercentage: true
    }
  );
}

function buildUsageMeter(
  id: string,
  label: string,
  scope: UsageMeterScope,
  window: LimitWindow | undefined,
  options: {
    windowSeconds?: number;
    rollup?: boolean;
    temporary?: boolean;
    expiresAtEpochSeconds?: number;
    requireUsedPercentage?: boolean;
  } = {}
): UsageMeter | undefined {
  if (!window) {
    return undefined;
  }

  // Generic meters (unknown/unrecognized windows) require a defined usedPercentage;
  // reset-only or empty objects must not become meters. Primaries and the migrated
  // Opus meter are exempt (requireUsedPercentage left unset by their call sites).
  if (options.requireUsedPercentage && window.usedPercentage === undefined) {
    return undefined;
  }

  const normalizedId = normalizeUsageMeterId(id);
  if (!normalizedId) {
    return undefined;
  }

  return {
    id: normalizedId,
    label: label.trim(),
    scope,
    ...(options.windowSeconds !== undefined ? { windowSeconds: options.windowSeconds } : {}),
    window,
    ...(options.rollup !== undefined ? { rollup: options.rollup } : {}),
    ...(options.temporary !== undefined ? { temporary: options.temporary } : {}),
    ...(options.expiresAtEpochSeconds !== undefined ? { expiresAtEpochSeconds: options.expiresAtEpochSeconds } : {})
  };
}

function normalizeUsageMeterId(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function parseUsageMeterScope(window: Record<string, unknown>): UsageMeterScope {
  const value = asString(window.scope) ?? asString(window.meter_scope) ?? asString(window.meterScope);
  switch (value) {
    case 'account':
    case 'model':
    case 'modelFamily':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function parseUsageMeterWindowSeconds(window: Record<string, unknown>): number | undefined {
  const seconds = toNumber(window.limit_window_seconds) ?? toNumber(window.window_seconds) ?? toNumber(window.windowSeconds);
  if (seconds !== undefined) {
    return seconds;
  }
  const minutes = toNumber(window.window_minutes);
  if (minutes !== undefined) {
    return minutes * 60;
  }
  return undefined;
}

function parseUsageMeterLabel(explicit: string | undefined, fallbackId: string, windowSeconds: number | undefined): string {
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const base = fallbackId
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const windowLabel = formatWindowSecondsLabel(windowSeconds);
  if (!windowLabel || base.includes(windowLabel)) {
    return base;
  }
  return `${base} ${windowLabel}`;
}

function formatWindowSecondsLabel(windowSeconds: number | undefined): string | undefined {
  if (windowSeconds === undefined || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return undefined;
  }
  if (windowSeconds % 86_400 === 0) {
    return `${windowSeconds / 86_400}d`;
  }
  if (windowSeconds % 3_600 === 0) {
    return `${windowSeconds / 3_600}h`;
  }
  if (windowSeconds % 60 === 0) {
    return `${windowSeconds / 60}m`;
  }
  return `${windowSeconds}s`;
}

function hasParsedQuota(
  fiveHour: LimitWindow | undefined,
  sevenDay: LimitWindow | undefined,
  meters: UsageMeter[] | undefined
): boolean {
  return Boolean(fiveHour || sevenDay || (meters && meters.length > 0));
}

function collectUsageMeters(meters: Array<UsageMeter | undefined>): UsageMeter[] | undefined {
  const collected: UsageMeter[] = [];
  const seen = new Set<string>();
  for (const meter of meters) {
    if (!meter || seen.has(meter.id)) {
      continue;
    }
    seen.add(meter.id);
    collected.push(meter);
  }
  return collected.length > 0 ? collected : undefined;
}

function parseRetryAfter(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value >= 0 && value <= 1) {
    return value * 100;
  }
  return Math.max(0, Math.min(100, value));
}

export function parseResetEpochSeconds(value: unknown): number | undefined {
  const numeric = toNumber(value);
  if (numeric !== undefined) {
    if (numeric > 1_000_000_000_000) return Math.floor(numeric / 1000);
    if (numeric > 1_000_000_000) return Math.floor(numeric);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return undefined;
}
