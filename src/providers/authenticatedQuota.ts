import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthenticatedQuotaStatus, LimitWindow, ProviderName, ProviderUsageState } from '../types';
import { isStale } from '../usageTime';
import { USER_AGENT } from '../version';

const CACHE_FILE = 'authenticated-quota-cache.json';
const SOCKET_TIMEOUT_MS = 5000;
const HARD_DEADLINE_MS = 10000;
const MAX_RESPONSE_BYTES = 128 * 1024;

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
      if (state.provider === 'claude' || state.provider === 'codex') {
        result[state.provider] = {
          ...state,
          stale: isStale(state.lastUpdatedEpochMs ?? state.lastAuthenticatedRefreshEpochMs),
          source: state.source ?? 'stale cached authenticated quota'
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

  const body = asRecord(response.body);
  const fiveHour = parseClaudeWindow(asRecord(body?.five_hour));
  const sevenDay = parseClaudeWindow(asRecord(body?.seven_day));
  const sevenDayOpus = parseClaudeWindow(asRecord(body?.seven_day_opus));
  if (!fiveHour && !sevenDay && !sevenDayOpus) {
    return authFailure(provider, 'parse_error', 'Claude usage response did not include recognizable 5h/7d/opus windows.');
  }

  return success(provider, fiveHour, sevenDay, sevenDayOpus, response.statusCode);
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

  const body = asRecord(response.body);
  const rateLimit = asRecord(body?.rate_limit) ?? asRecord(body?.rate_limits);
  const primaryWindow = asRecord(rateLimit?.primary_window) ?? asRecord(rateLimit?.primary);
  const secondaryWindow = asRecord(rateLimit?.secondary_window) ?? asRecord(rateLimit?.secondary);
  const fiveHour = parseCodexWindow(primaryWindow, 18_000);
  const sevenDay = parseCodexWindow(secondaryWindow, 604_800);
  if (!fiveHour && !sevenDay) {
    return authFailure(provider, 'parse_error', 'Codex usage response did not include recognizable 5h/7d windows.');
  }

  return success(provider, fiveHour, sevenDay, undefined, response.statusCode);
}

function success(
  provider: ProviderName,
  fiveHour: LimitWindow | undefined,
  sevenDay: LimitWindow | undefined,
  sevenDayOpus: LimitWindow | undefined,
  statusCode: number | undefined
): AuthenticatedQuotaFetchOutcome {
  const now = Date.now();
  return {
    provider,
    success: true,
    state: {
      provider,
      fiveHour,
      sevenDay,
      sevenDayOpus,
      sourceKind: 'authenticated',
      source: 'live authenticated refresh',
      lastUpdatedEpochMs: now,
      lastAuthenticatedRefreshEpochMs: now,
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

export function parseClaudeWindow(window: Record<string, unknown> | undefined): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  return parsedWindow(
    normalizePercent(toNumber(window.utilization) ?? toNumber(window.used_percentage) ?? toNumber(window.usedPercent)),
    parseResetEpochSeconds(window.resets_at) ?? parseResetEpochSeconds(window.reset_at) ?? parseResetEpochSeconds(window.resetsAt)
  );
}

export function parseCodexWindow(window: Record<string, unknown> | undefined, expectedSeconds: number): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  const seconds = toNumber(window.limit_window_seconds);
  const minutes = toNumber(window.window_minutes);
  if (seconds !== undefined && seconds !== expectedSeconds) {
    return undefined;
  }
  if (minutes !== undefined && minutes * 60 !== expectedSeconds) {
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
    sevenDayOpus: state.sevenDayOpus,
    sourceKind: state.sourceKind,
    source: state.source,
    lastUpdatedEpochMs: state.lastUpdatedEpochMs,
    lastAuthenticatedRefreshEpochMs: state.lastAuthenticatedRefreshEpochMs,
    nextAuthenticatedRefreshEpochMs: state.nextAuthenticatedRefreshEpochMs,
    authenticatedBackoffUntilEpochMs: state.authenticatedBackoffUntilEpochMs,
    authenticatedStatus: state.authenticatedStatus,
    authenticatedHttpStatus: state.authenticatedHttpStatus,
    authenticatedError: state.authenticatedError,
    stale: state.stale,
    diagnosticSeverity: state.diagnosticSeverity
  };
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
