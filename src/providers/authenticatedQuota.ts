import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LiveQuotaFreshness, LiveQuotaStatus, LiveQuotaWindow } from '../core/liveQuotaTypes';
import type { ProviderId } from '../core/providers';
import type { LiveQuotaReader } from './liveQuotaReader';

const SOCKET_TIMEOUT_MS = 5000;
const HARD_DEADLINE_MS = 10000;
const MAX_RESPONSE_BYTES = 128 * 1024;

// --- Public API ---

export async function createAuthenticatedReader(
  providerId: string,
): Promise<LiveQuotaReader> {
  const id = providerId as ProviderId;
  if (id === 'claude') {
    return {
      providerId: 'claude',
      read: fetchClaudeLiveQuota,
    };
  }
  if (id === 'codex') {
    return {
      providerId: 'codex',
      read: fetchCodexLiveQuota,
    };
  }
  return {
    providerId,
    read: async () => ({
      providerId,
      windows: [],
      freshness: 'unavailable',
    }),
  };
}

// --- Claude ---

async function fetchClaudeLiveQuota(): Promise<LiveQuotaStatus> {
  const token = await readClaudeToken();

  if (!token) {
    return errorStatus('claude', 'not_configured');
  }

  const response = await requestJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
  });

  if (!response.ok) {
    return errorStatus('claude', response.statusCode === 401 || response.statusCode === 403
      ? 'auth_expired'
      : 'http_error');
  }

  const body = asRecord(response.body);
  const fiveHour = parseClaudeWindow(asRecord(body?.five_hour));
  const sevenDay = parseClaudeWindow(asRecord(body?.seven_day));

  if (!fiveHour && !sevenDay) {
    return errorStatus('claude', 'parse_error');
  }

  return {
    providerId: 'claude',
    windows: [fiveHour, sevenDay].filter(Boolean) as LiveQuotaWindow[],
    freshness: 'live',
    lastUpdatedEpochMs: Date.now(),
  };
}

async function readClaudeToken(): Promise<string | undefined> {
  const credentialsPath = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    '.credentials.json',
  );
  const credential = await readJsonObject(credentialsPath);
  if (!credential) return undefined;
  const oauth = credential.claudeAiOauth as Record<string, unknown> | undefined;
  return asString(oauth?.accessToken);
}

// --- Codex ---

async function fetchCodexLiveQuota(): Promise<LiveQuotaStatus> {
  const auth = await readCodexAuth();

  if (!auth.token) {
    return errorStatus('codex', 'not_configured');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    Accept: 'application/json',
    Origin: 'https://chatgpt.com',
    Referer: 'https://chatgpt.com/',
    'User-Agent': 'prompt-fuel',
  };
  if (auth.accountId) {
    headers['ChatGPT-Account-Id'] = auth.accountId;
  }

  const response = await requestJson('https://chatgpt.com/backend-api/wham/usage', headers);

  if (!response.ok) {
    return errorStatus('codex', response.statusCode === 401 || response.statusCode === 403
      ? 'auth_expired'
      : 'http_error');
  }

  const body = asRecord(response.body);
  const rateLimit = asRecord(body?.rate_limit) ?? asRecord(body?.rate_limits);
  const primaryWindow = asRecord(rateLimit?.primary_window) ?? asRecord(rateLimit?.primary);
  const secondaryWindow = asRecord(rateLimit?.secondary_window) ?? asRecord(rateLimit?.secondary);
  const fiveHour = parseCodexWindow(primaryWindow, 18_000);
  const sevenDay = parseCodexWindow(secondaryWindow, 604_800);

  if (!fiveHour && !sevenDay) {
    return errorStatus('codex', 'parse_error');
  }

  return {
    providerId: 'codex',
    windows: [fiveHour, sevenDay].filter(Boolean) as LiveQuotaWindow[],
    freshness: 'live',
    lastUpdatedEpochMs: Date.now(),
  };
}

interface CodexAuth {
  token: string;
  accountId?: string;
}

async function readCodexAuth(): Promise<CodexAuth> {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  const auth = await readJsonObject(authPath);
  const tokens = asRecord(auth?.tokens);
  return {
    token: asString(tokens?.access_token) ?? '',
    accountId: asString(tokens?.account_id),
  };
}

// --- Window parsing ---

function parseClaudeWindow(
  window: Record<string, unknown> | undefined,
): LiveQuotaWindow | undefined {
  if (!window) {
    return undefined;
  }
  const usedPercentage = normalizePercent(
    toNumber(window.utilization) ?? toNumber(window.used_percentage) ?? toNumber(window.usedPercent),
  );
  const resetsAtEpochSeconds = parseResetEpochSeconds(window.resets_at)
    ?? parseResetEpochSeconds(window.reset_at)
    ?? parseResetEpochSeconds(window.resetsAt);

  return buildWindow('5h', usedPercentage, resetsAtEpochSeconds);
}

function parseCodexWindow(
  window: Record<string, unknown> | undefined,
  expectedSeconds: number,
): LiveQuotaWindow | undefined {
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

  const usedPercentage = normalizePercent(
    toNumber(window.used_percent) ?? toNumber(window.usedPercentage) ?? toNumber(window.utilization),
  );
  const resetsAtEpochSeconds = parseResetEpochSeconds(window.reset_at)
    ?? parseResetEpochSeconds(window.resets_at)
    ?? parseResetEpochSeconds(window.resetsAtEpochSeconds);

  const windowId = expectedSeconds === 18_000 ? '5h' : '7d';
  return buildWindow(windowId, usedPercentage, resetsAtEpochSeconds);
}

function buildWindow(
  windowId: '5h' | '7d',
  usedPercentage: number | undefined,
  resetsAtEpochSeconds: number | undefined,
): LiveQuotaWindow | undefined {
  if (usedPercentage === undefined && resetsAtEpochSeconds === undefined) {
    return undefined;
  }
  const remainingPercentage = usedPercentage !== undefined
    ? Math.max(0, Math.min(100, 100 - usedPercentage))
    : undefined;

  return {
    windowId,
    usedPercentage,
    remainingPercentage,
    resetsAtEpochMs: resetsAtEpochSeconds !== undefined ? resetsAtEpochSeconds * 1000 : undefined,
    sourceKind: 'authenticated',
    sourceLabel: 'live API',
    sourceUpdatedEpochMs: Date.now(),
    sourceAuthorityRank: 5,
  };
}

// --- Error status ---

function errorStatus(providerId: string, reason: string): LiveQuotaStatus {
  const freshness: LiveQuotaFreshness =
    reason === 'not_configured' ? 'unavailable' : 'error';

  return {
    providerId,
    windows: [],
    freshness,
    lastUpdatedEpochMs: Date.now(),
    error: sanitizeError(reason),
  };
}

function sanitizeError(reason: string): string {
  switch (reason) {
    case 'not_configured':
      return 'Credentials not found';
    case 'auth_expired':
      return 'Auth token expired';
    case 'http_error':
      return 'HTTP request failed';
    case 'parse_error':
      return 'Response could not be parsed';
    default:
      return 'Live quota unavailable';
  }
}

// --- HTTP client ---

interface HttpJsonResult {
  ok: boolean;
  statusCode?: number;
  body?: unknown;
}

async function requestJson(endpoint: string, headers: Record<string, string>): Promise<HttpJsonResult> {
  return new Promise(resolve => {
    let settled = false;
    let hardDeadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: HttpJsonResult) => {
      if (settled) return;
      settled = true;
      if (hardDeadline) {
        clearTimeout(hardDeadline);
        hardDeadline = undefined;
      }
      resolve(result);
    };

    const url = new URL(endpoint);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers,
      timeout: SOCKET_TIMEOUT_MS,
    }, res => {
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
        const statusCode = res.statusCode;
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          finish({ ok: false, statusCode });
          return;
        }
        try {
          finish({
            ok: true,
            statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch {
          finish({ ok: false, statusCode });
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

// --- JSON file reader ---

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// --- Type utilities ---

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

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value >= 0 && value <= 1) {
    return value * 100;
  }
  return Math.max(0, Math.min(100, value));
}

function parseResetEpochSeconds(value: unknown): number | undefined {
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
