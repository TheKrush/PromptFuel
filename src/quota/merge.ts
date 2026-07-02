import { LimitWindow, ProviderUsageState, QuotaSourceKind, UsageMeter } from '../types';
import { RESET_EXPIRY_GRACE_MS } from '../usageTime';

const AUTHORITY_RANK: Record<QuotaSourceKind, number> = {
  authenticated: 400,
  statusLine: 300,
  hook: 300,
  localSession: 200,
  cache: 100,
  stale: 0,
  unknown: 0
};

const FRESH_WINDOW_TOLERANCE_S = 120;
const FIVE_HOUR_WINDOW_S = 5 * 60 * 60;
const SEVEN_DAY_WINDOW_S = 7 * 24 * 60 * 60;

export interface QuotaMergeOptions {
  freshResetToleranceSeconds?: number;
}

interface MergeWindowResult {
  window?: LimitWindow;
  ignored?: string;
}

interface MergeMetersResult {
  meters?: UsageMeter[];
  ignored: string[];
}

export function mergeLocalAndAuthenticated(
  local: ProviderUsageState,
  authenticated: ProviderUsageState | undefined,
  options?: QuotaMergeOptions
): ProviderUsageState {
  const localWithMetadata = annotateStateWindows(local, options);
  if (!authenticated || !stateHasQuota(authenticated)) {
    return localWithMetadata;
  }

  const authenticatedWithMetadata = annotateStateWindows(authenticated, options);
  const fiveHour = chooseQuotaWindow(localWithMetadata.fiveHour, authenticatedWithMetadata.fiveHour);
  const sevenDay = chooseQuotaWindow(localWithMetadata.sevenDay, authenticatedWithMetadata.sevenDay);
  const meters = mergeQuotaMeters(localWithMetadata.meters, authenticatedWithMetadata.meters);
  const quotaWindows = [fiveHour.window, sevenDay.window, ...(meters.meters ?? []).map(meter => meter.window)];
  const ignored = unique([
    fiveHour.ignored,
    sevenDay.ignored,
    ...meters.ignored
  ].filter((value): value is string => Boolean(value)));
  const quotaSource = summarizeQuotaSource(quotaWindows, localWithMetadata.source);
  const lastQuotaUpdate = Math.max(
    ...quotaWindows.map(window => window?.sourceUpdatedEpochMs ?? 0),
    localWithMetadata.lastUpdatedEpochMs ?? 0,
    authenticatedWithMetadata.lastUpdatedEpochMs ?? 0
  );

  return {
    ...localWithMetadata,
    fiveHour: fiveHour.window,
    sevenDay: sevenDay.window,
    meters: meters.meters,
    source: quotaSource,
    lastUpdatedEpochMs: lastQuotaUpdate || localWithMetadata.lastUpdatedEpochMs,
    lastAuthenticatedRefreshEpochMs: authenticated.lastAuthenticatedRefreshEpochMs,
    nextAuthenticatedRefreshEpochMs: authenticated.nextAuthenticatedRefreshEpochMs,
    authenticatedStatus: authenticated.authenticatedStatus,
    authenticatedHttpStatus: authenticated.authenticatedHttpStatus,
    authenticatedError: authenticated.authenticatedError,
    stale: mergedQuotaIsStale(quotaWindows, localWithMetadata.stale),
    error: quotaWindows.some(window => Boolean(window)) ? undefined : localWithMetadata.error,
    ignoredQuotaSource: ignored.length > 0 ? ignored.join('; ') : localWithMetadata.ignoredQuotaSource
  };
}

export function mergeAuthenticatedQuotaSuccess(
  current: ProviderUsageState | undefined,
  authenticated: ProviderUsageState,
  options?: QuotaMergeOptions
): ProviderUsageState {
  const localUpdated = current?.lastLocalUpdateEpochMs ?? current?.lastUpdatedEpochMs;
  const base = current ?? { provider: authenticated.provider };
  const annotated = annotateStateWindows({
    ...authenticated,
    source: 'live authenticated refresh',
    stale: false
  }, options);

  return {
    ...base,
    fiveHour: annotated.fiveHour ?? nonExpiredWindow(current?.fiveHour),
    sevenDay: annotated.sevenDay ?? nonExpiredWindow(current?.sevenDay),
    meters: annotated.meters ?? nonExpiredMeters(current?.meters),
    source: 'live authenticated refresh',
    lastUpdatedEpochMs: authenticated.lastUpdatedEpochMs,
    lastLocalUpdateEpochMs: localUpdated,
    lastAuthenticatedRefreshEpochMs: authenticated.lastAuthenticatedRefreshEpochMs,
    nextAuthenticatedRefreshEpochMs: authenticated.nextAuthenticatedRefreshEpochMs,
    authenticatedStatus: authenticated.authenticatedStatus,
    authenticatedHttpStatus: authenticated.authenticatedHttpStatus,
    authenticatedError: undefined,
    stale: false,
    error: undefined,
    ignoredQuotaSource: undefined
  };
}

export function mergeAuthenticatedFailure(
  current: ProviderUsageState | undefined,
  failure: ProviderUsageState,
  backoffUntil: number,
  options?: QuotaMergeOptions
): ProviderUsageState {
  const hasQuota = stateHasQuota(current);
  const state = annotateStateWindows(current ?? { provider: failure.provider, source: 'authenticated quota provider', stale: true }, options);
  const fallback = annotateAuthenticatedFallbackWindows(state);

  return {
    ...fallback,
    lastAuthenticatedRefreshEpochMs: failure.lastAuthenticatedRefreshEpochMs,
    nextAuthenticatedRefreshEpochMs: failure.nextAuthenticatedRefreshEpochMs,
    authenticatedStatus: failure.authenticatedStatus,
    authenticatedHttpStatus: failure.authenticatedHttpStatus,
    authenticatedError: failure.authenticatedError,
    authenticatedBackoffUntilEpochMs: backoffUntil,
    diagnostics: state.diagnostics,
    stale: fallback.stale || hasCachedQuota(fallback),
    diagnosticSeverity: state.diagnosticSeverity ?? failure.diagnosticSeverity,
    error: hasQuota ? undefined : state.error ?? failure.authenticatedError,
    lastUpdatedEpochMs: state.lastUpdatedEpochMs
  };
}

export function annotateStateWindows(state: ProviderUsageState, options?: QuotaMergeOptions): ProviderUsageState {
  const sourceKind = inferSourceKind(state);
  const sourceUpdatedEpochMs = inferSourceUpdatedEpochMs(state);
  const sourceAuthorityRank = AUTHORITY_RANK[sourceKind];
  const sourceLabel = sourceLabelForKind(sourceKind, state.source);

  return {
    ...state,
    fiveHour: annotateWindow(state.fiveHour, sourceKind, sourceLabel, sourceUpdatedEpochMs, sourceAuthorityRank, options, FIVE_HOUR_WINDOW_S),
    sevenDay: annotateWindow(state.sevenDay, sourceKind, sourceLabel, sourceUpdatedEpochMs, sourceAuthorityRank, options, SEVEN_DAY_WINDOW_S),
    meters: annotateMeters(state.meters, sourceKind, sourceLabel, sourceUpdatedEpochMs, sourceAuthorityRank, options)
  };
}

function annotateAuthenticatedFallbackWindows(state: ProviderUsageState): ProviderUsageState {
  const fiveHour = annotateAuthenticatedFallbackWindow(state.fiveHour);
  const sevenDay = annotateAuthenticatedFallbackWindow(state.sevenDay);
  const meters = annotateAuthenticatedFallbackMeters(state.meters);
  const labels = unique([
    fiveHour?.sourceLabel,
    sevenDay?.sourceLabel,
    ...(meters ?? []).map(meter => meter.window.sourceLabel)
  ].filter((value): value is string => Boolean(value)));

  return {
    ...state,
    fiveHour,
    sevenDay,
    meters,
    source: labels.length === 1 ? labels[0] : labels.length > 1 ? 'mixed quota sources' : state.source
  };
}

function annotateAuthenticatedFallbackWindow(window: LimitWindow | undefined): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }
  if (window.sourceKind !== 'authenticated') {
    return window;
  }

  return annotateExpiredFallbackWindow({
    ...window,
    sourceKind: 'cache',
    sourceLabel: 'cached quota snapshot',
    sourceAuthorityRank: AUTHORITY_RANK.authenticated - 1
  });
}

function annotateAuthenticatedFallbackMeters(meters: UsageMeter[] | undefined): UsageMeter[] | undefined {
  if (!meters || meters.length === 0) {
    return undefined;
  }

  const annotated = meters
    .map(meter => {
      const window = annotateAuthenticatedFallbackWindow(meter.window);
      return window ? { ...meter, window } : undefined;
    })
    .filter((meter): meter is UsageMeter => Boolean(meter));

  return annotated.length > 0 ? annotated : undefined;
}

function hasCachedQuota(state: ProviderUsageState): boolean {
  return [state.fiveHour, state.sevenDay, ...(state.meters ?? []).map(meter => meter.window)]
    .some(window => window?.sourceKind === 'cache');
}

function chooseQuotaWindow(local: LimitWindow | undefined, authenticated: LimitWindow | undefined): MergeWindowResult {
  if (!local) {
    return { window: authenticated };
  }
  if (!authenticated) {
    return { window: local };
  }

  const localRank = local.sourceAuthorityRank ?? 0;
  const authRank = authenticated.sourceAuthorityRank ?? 0;
  const localUpdated = local.sourceUpdatedEpochMs ?? 0;
  const authUpdated = authenticated.sourceUpdatedEpochMs ?? 0;
  const resetFreshnessChoice = chooseByResetFreshness(local, authenticated);
  if (resetFreshnessChoice) {
    return resetFreshnessChoice;
  }

  if (authRank > localRank) {
    return {
      window: authenticated,
      ignored: localWindowIgnored(local)
    };
  }

  if (authRank < localRank) {
    if (authRank <= AUTHORITY_RANK.cache && localUpdated > authUpdated) {
      return {
        window: local,
        ignored: cachedWindowIgnored(authenticated)
      };
    }

    return {
      window: authenticated,
      ignored: localWindowIgnored(local)
    };
  }

  if (authUpdated >= localUpdated) {
    return {
      window: authenticated,
      ignored: localUpdated > 0 ? localWindowIgnored(local) : undefined
    };
  }

  return {
    window: local,
    ignored: cachedWindowIgnored(authenticated)
  };
}

function annotateWindow(
  window: LimitWindow | undefined,
  sourceKind: QuotaSourceKind,
  sourceLabel: string,
  sourceUpdatedEpochMs: number | undefined,
  sourceAuthorityRank: number,
  options?: QuotaMergeOptions,
  windowDurationSeconds?: number
): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }

  return clearSuspiciousFreshExhaustedWindow(
    annotateExpiredFallbackWindow({
      ...window,
      sourceKind: window.sourceKind ?? sourceKind,
      sourceLabel: window.sourceLabel ?? sourceLabel,
      sourceUpdatedEpochMs: window.sourceUpdatedEpochMs ?? sourceUpdatedEpochMs,
      sourceAuthorityRank: window.sourceAuthorityRank ?? sourceAuthorityRank
    }),
    options,
    windowDurationSeconds
  );
}

function annotateMeters(
  meters: UsageMeter[] | undefined,
  sourceKind: QuotaSourceKind,
  sourceLabel: string,
  sourceUpdatedEpochMs: number | undefined,
  sourceAuthorityRank: number,
  options?: QuotaMergeOptions
): UsageMeter[] | undefined {
  if (!meters || meters.length === 0) {
    return undefined;
  }

  const annotated = meters
    .map(meter => {
      const window = annotateWindow(
        meter.window,
        sourceKind,
        sourceLabel,
        sourceUpdatedEpochMs,
        sourceAuthorityRank,
        options,
        meter.windowSeconds
      );
      return window ? { ...meter, window } : undefined;
    })
    .filter((meter): meter is UsageMeter => Boolean(meter));

  return annotated.length > 0 ? annotated : undefined;
}

function mergeQuotaMeters(localMeters: UsageMeter[] | undefined, authenticatedMeters: UsageMeter[] | undefined): MergeMetersResult {
  const orderedIds = unique([
    ...(authenticatedMeters ?? []).map(meter => meter.id),
    ...(localMeters ?? []).map(meter => meter.id)
  ]);
  const merged: UsageMeter[] = [];
  const ignored: string[] = [];

  for (const id of orderedIds) {
    const localMeter = localMeters?.find(meter => meter.id === id);
    const authenticatedMeter = authenticatedMeters?.find(meter => meter.id === id);

    if (!localMeter && authenticatedMeter) {
      merged.push(authenticatedMeter);
      continue;
    }
    if (localMeter && !authenticatedMeter) {
      merged.push(localMeter);
      continue;
    }
    if (!localMeter || !authenticatedMeter) {
      continue;
    }

    const choice = chooseQuotaWindow(localMeter.window, authenticatedMeter.window);
    if (choice.ignored) {
      ignored.push(choice.ignored);
    }
    if (!choice.window) {
      continue;
    }

    const selectedMeter = choice.window === localMeter.window ? localMeter : authenticatedMeter;
    merged.push({
      ...selectedMeter,
      window: choice.window
    });
  }

  return {
    meters: merged.length > 0 ? merged : undefined,
    ignored: unique(ignored)
  };
}

function annotateExpiredFallbackWindow(window: LimitWindow): LimitWindow {
  if (!isExpiredWindow(window)) {
    return window;
  }

  // cache/stale: the provider's reset boundary is authoritative — treat the expired window as fully reset (0% used).
  // localSession/statusLine/hook: local heuristics with no authoritative reset boundary — mark unknown instead.
  if (window.sourceKind === 'cache' || window.sourceKind === 'stale') {
    return {
      ...window,
      usedPercentage: 0,
      sourceLabel: expiredSourceLabel(window),
      sourceAuthorityRank: Math.min(window.sourceAuthorityRank ?? AUTHORITY_RANK.cache, AUTHORITY_RANK.cache)
    };
  }

  if (window.sourceKind === 'localSession' || window.sourceKind === 'statusLine' || window.sourceKind === 'hook') {
    return {
      ...window,
      usedPercentage: undefined
    };
  }

  return window;
}

function clearSuspiciousFreshExhaustedWindow(
  window: LimitWindow,
  options?: QuotaMergeOptions,
  windowDurationSeconds?: number
): LimitWindow {
  const tolerance = options?.freshResetToleranceSeconds ?? FRESH_WINDOW_TOLERANCE_S;
  if (tolerance <= 0) {
    return window;
  }

  if (window.usedPercentage === undefined || window.resetsAtEpochSeconds === undefined) {
    return window;
  }
  if (window.usedPercentage < 99) {
    return window;
  }

  const timeUntilResetSeconds = window.resetsAtEpochSeconds - Date.now() / 1000;
  if (timeUntilResetSeconds <= 0) {
    return window;
  }

  const knownDurations = uniqueNumbers([windowDurationSeconds, FIVE_HOUR_WINDOW_S, SEVEN_DAY_WINDOW_S]);
  const matchesFreshReset = knownDurations.some(
    duration => Math.abs(timeUntilResetSeconds - duration) <= tolerance
  );

  if (!matchesFreshReset) {
    return window;
  }

  return {
    ...window,
    usedPercentage: 0
  };
}

function expiredSourceLabel(window: LimitWindow): string {
  const label = window.sourceLabel ?? sourceLabelForKind(window.sourceKind ?? 'cache', undefined);
  return label.toLowerCase().startsWith('expired ') ? label : `expired ${label}`;
}

function chooseByResetFreshness(local: LimitWindow, authenticated: LimitWindow): MergeWindowResult | undefined {
  const localExpired = isExpiredWindow(local);
  const authenticatedExpired = isExpiredWindow(authenticated);

  if (authenticatedExpired && isPostResetCandidate(local, authenticated)) {
    return {
      window: local,
      ignored: expiredWindowIgnored(authenticated)
    };
  }

  if (localExpired && isPostResetCandidate(authenticated, local)) {
    return {
      window: authenticated,
      ignored: expiredWindowIgnored(local)
    };
  }

  return undefined;
}

function isPostResetCandidate(candidate: LimitWindow, expired: LimitWindow): boolean {
  const expiredResetMs = resetEpochMs(expired);
  if (expiredResetMs === undefined) {
    return false;
  }

  const candidateResetMs = resetEpochMs(candidate);
  if (candidateResetMs !== undefined && candidateResetMs > expiredResetMs + RESET_EXPIRY_GRACE_MS) {
    return true;
  }

  const candidateUpdated = candidate.sourceUpdatedEpochMs ?? 0;
  return candidateUpdated > expiredResetMs + RESET_EXPIRY_GRACE_MS;
}

function nonExpiredWindow(window: LimitWindow | undefined): LimitWindow | undefined {
  return window && !isExpiredWindow(window) ? window : undefined;
}

function nonExpiredMeters(meters: UsageMeter[] | undefined): UsageMeter[] | undefined {
  if (!meters || meters.length === 0) {
    return undefined;
  }

  const filtered = meters
    .map(meter => {
      const window = nonExpiredWindow(meter.window);
      return window ? { ...meter, window } : undefined;
    })
    .filter((meter): meter is UsageMeter => Boolean(meter));

  return filtered.length > 0 ? filtered : undefined;
}

function isExpiredWindow(window: LimitWindow): boolean {
  const resetMs = resetEpochMs(window);
  return resetMs !== undefined && resetMs + RESET_EXPIRY_GRACE_MS < Date.now();
}

function resetEpochMs(window: LimitWindow): number | undefined {
  const reset = window.resetsAtEpochSeconds;
  if (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0) {
    return undefined;
  }
  return Math.floor(reset) * 1000;
}

function expiredWindowIgnored(window: LimitWindow): string | undefined {
  if (!window.sourceLabel) {
    return undefined;
  }
  return `${window.sourceLabel} ignored: expired reset window`;
}

function inferSourceKind(state: ProviderUsageState): QuotaSourceKind {
  if (state.sourceKind) {
    const kind = state.sourceKind;
    if (kind === 'authenticated') {
      if (state.authenticatedStatus === 'success' && !state.stale) {
        return 'authenticated';
      }
      return state.stale ? 'cache' : 'authenticated';
    }
    if (state.stale && kind !== 'cache' && kind !== 'stale') {
      return 'stale';
    }
    return kind;
  }
  // Legacy fallback: substring inference for states without an explicit sourceKind
  const source = (state.source ?? '').toLowerCase();
  if (state.authenticatedStatus === 'success' && !state.stale) {
    return 'authenticated';
  }
  if (source.includes('authenticated')) {
    return state.stale ? 'cache' : 'authenticated';
  }
  if (source.includes('cache')) {
    return 'cache';
  }
  if (state.stale) {
    return 'stale';
  }
  if (source.includes('statusline')) {
    return 'statusLine';
  }
  if (source.includes('hook')) {
    return 'hook';
  }
  if (source.includes('session') || source.includes('bridge') || source.includes('local')) {
    return 'localSession';
  }
  return 'unknown';
}

function inferSourceUpdatedEpochMs(state: ProviderUsageState): number | undefined {
  if (inferSourceKind(state) === 'authenticated') {
    return state.lastAuthenticatedRefreshEpochMs ?? state.lastUpdatedEpochMs;
  }
  return state.lastUpdatedEpochMs ?? state.lastAuthenticatedRefreshEpochMs;
}

function sourceLabelForKind(kind: QuotaSourceKind, fallback: string | undefined): string {
  switch (kind) {
    case 'authenticated':
      return 'live authenticated refresh';
    case 'statusLine':
      return 'Claude statusLine/hook quota';
    case 'hook':
      return 'Claude hook quota';
    case 'localSession':
      return 'local session snapshot';
    case 'cache':
      return 'cached quota snapshot';
    case 'stale':
      return 'stale local snapshot';
    default:
      return fallback ?? 'unknown source';
  }
}

function summarizeQuotaSource(windows: Array<LimitWindow | undefined>, fallback: string | undefined): string {
  const labels = unique(windows.map(window => window?.sourceLabel).filter((value): value is string => Boolean(value)));
  if (labels.length === 0) {
    return fallback ?? 'unknown source';
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return 'mixed quota sources';
}

function mergedQuotaIsStale(windows: Array<LimitWindow | undefined>, fallback: boolean | undefined): boolean | undefined {
  const present = windows.filter((window): window is LimitWindow => Boolean(window));
  if (present.length === 0) {
    return fallback;
  }
  return present.every(window => window.sourceKind === 'cache' || window.sourceKind === 'stale');
}

function localWindowIgnored(window: LimitWindow): string | undefined {
  if (!window.sourceLabel) {
    return undefined;
  }
  return `${window.sourceLabel} ignored: older/lower authority`;
}

function cachedWindowIgnored(window: LimitWindow): string | undefined {
  if (!window.sourceLabel) {
    return undefined;
  }
  return `${window.sourceLabel} ignored: older/lower authority`;
}

function stateHasQuota(state: ProviderUsageState | undefined): boolean {
  return Boolean(state?.fiveHour || state?.sevenDay || state?.meters?.length);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0))];
}
