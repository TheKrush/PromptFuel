import { DisplayMode, LimitWindow, ProviderName, ProviderUsageState, QuotaSourceKind, SourceConfigEntry } from '../types';
import { RESET_EXPIRY_GRACE_MS, formatCountdown, formatAgeLabel, formatRelativeTime } from '../usageTime';
import { STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS } from './modelBreakdown';
import { estimateClaudeCostUsd, estimateCodexCostUsd } from '../providers/pricing';

export interface ModelBreakdownEntry {
  label: string;
  totalTokens: number;
  assistantMessages?: number;
  costUsd?: number;
  isFallback?: boolean;
  remoteTokens?: number;
}

export type ModelBreakdownData = Record<string, ModelBreakdownEntry[]>;

export interface FormatOptions {
  displayMode: DisplayMode;
  statusMode: 'remaining' | 'used';
  lowRemainingPercent: number;
  warnRemainingPercent: number;
  criticalRemainingPercent: number;
  emptyRemainingPercent: number;
  nextResetRefreshEpochMs?: number;
  modelBreakdown?: ModelBreakdownData;
  normalizedSources?: Record<string, SourceConfigEntry>;
}

export type StatusSeverity = 'normal' | 'low' | 'warning' | 'critical';
export type QuotaIndicatorLevel = 'purple' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'unavailable';
export type PresentableQuotaSeverity = StatusSeverity | 'unavailable';
export type PresentableQuotaFreshness = 'live' | 'cached' | 'local' | 'stale' | 'unknown';
export type PresentableQuotaIncident =
  | 'auth_expired'
  | 'network_error'
  | 'http_error'
  | 'parse_error'
  | 'backoff'
  | 'disabled'
  | 'not_configured'
  | 'provider_error';

export interface PresentableQuotaWindowState {
  value: LimitWindow | undefined;
  severity: PresentableQuotaSeverity;
  freshness: PresentableQuotaFreshness;
  incident?: PresentableQuotaIncident;
}

export interface RemoteQuotaRow {
  label: string;
  sevenDayRemainingPercent?: number;
  fiveHourRemainingPercent?: number;
  sevenDayResetEpochSeconds?: number;
  fiveHourResetEpochSeconds?: number;
  stale: boolean;
  snapshotAgeLabel?: string;
}

export interface FormattedProviderStatus {
  provider: string;
  text: string;
  tooltip: string;
  severity: StatusSeverity;
  remoteQuotaData?: RemoteQuotaRow;
}

export function derivePresentableQuotaWindowState(
  state: ProviderUsageState,
  window: LimitWindow | undefined,
  options: FormatOptions
): PresentableQuotaWindowState {
  return {
    value: window,
    severity: window && window.usedPercentage !== undefined ? windowSeverity(window, options) : 'unavailable',
    freshness: quotaFreshnessForWindow(state, window),
    incident: providerIncident(state)
  };
}

export function formatStatus(
  states: ProviderUsageState[],
  options: FormatOptions,
  remoteSources?: FormattedProviderStatus[]
): { text: string; tooltip: string; severity: StatusSeverity; providers: FormattedProviderStatus[] } {
  const active = states.filter(Boolean);
  if (active.length === 0 && (!remoteSources || remoteSources.length === 0)) {
    return {
      text: '$(circle-slash) AI usage unavailable',
      tooltip: 'No usage providers are enabled or reporting.',
      severity: 'warning',
      providers: []
    };
  }

  const providers = active.map(state => formatProviderStatus(state, options));
  const allProviders = remoteSources && remoteSources.length > 0
    ? [...providers, ...remoteSources]
    : providers;

  const severity = allProviders.reduce<StatusSeverity>(
    (current, provider) => maxSeverity(current, provider.severity),
    'normal'
  );
  const separator = ' | ';

  const localText = providers.map(provider => provider.text).join(separator);
  const remoteText = remoteSources && remoteSources.length > 0
    ? remoteSources.map(r => r.text).join(separator)
    : '';
  const text = localText && remoteText
    ? `${localText}${separator}${remoteText}`
    : localText || remoteText;

  const remoteQuotaRows = remoteSources
    ? remoteSources.map(r => r.remoteQuotaData).filter((d): d is RemoteQuotaRow => d !== undefined)
    : [];

  return {
    text,
    tooltip: formatCombinedTooltip(active, options, remoteQuotaRows.length > 0 ? remoteQuotaRows : undefined),
    severity,
    providers
  };
}

function formatProviderStatus(state: ProviderUsageState, options: FormatOptions): FormattedProviderStatus {
  const resolved = resolveDisplayParts(options);
  const label = formatProviderLabel(state, resolved, options);
  const windows = formatProviderWindows(state, options, resolved);
  const severity = providerAlertSeverity(state, options, resolved);
  const sourceTag = resolved.showSourceInline ? formatSourceInline(state) : '';
  const inlineSource = sourceTag ? ` ${sourceTag}` : '';
  const inlineStale = resolved.showStaleInline && state.stale ? ' stale' : '';
  const unavailable = windows.length > 0 ? windows.join(resolved.windowSeparator) : 'unavailable';
  const prefix = resolved.showEmoji ? `${providerQuotaEmoji(state, resolved)} ` : '';
  const text =
    state.error && windows.length === 0
      ? `${prefix}${label} unavailable${inlineSource}${inlineStale}`.trim()
      : `${prefix}${label} ${unavailable}${inlineSource}${inlineStale}`.trim();

  return {
    provider: state.provider,
    text,
    tooltip: formatProviderTooltip(state, options),
    severity
  };
}

function resolveDisplayParts(options: FormatOptions): ResolvedDisplayParts {
  switch (options.displayMode) {
    case 'compact':
      return {
        showEmoji: false,
        showProviderNames: false,
        showFiveHour: true,
        showSevenDay: true,
        sevenDayFirst: true,
        showPercentSymbol: true,
        showCountdownInline: false,
        showSourceInline: false,
        showStaleInline: false,
        providerNameStyle: 'short',
        showWindowLabels: false,
        showWindowEmoji: true,
        countdownBeforeValue: false,
        windowSeparator: ' \u00B7 '
      };
    case 'standard':
    default:
      return {
        showEmoji: false,
        showProviderNames: true,
        showFiveHour: true,
        showSevenDay: true,
        sevenDayFirst: true,
        showPercentSymbol: true,
        showCountdownInline: true,
        showSourceInline: false,
        showStaleInline: false,
        providerNameStyle: 'full',
        showWindowLabels: true,
        showWindowEmoji: true,
        countdownBeforeValue: true,
        windowSeparator: ' \u00B7 '
      };
  }
}

function formatProviderLabel(state: ProviderUsageState, options: ResolvedDisplayParts, _formatOptions?: FormatOptions): string {
  const sources = _formatOptions?.normalizedSources;
  if (options.providerNameStyle === 'full') {
    return sources?.[state.provider]?.label ?? (state.provider === 'claude' ? 'Claude' : 'Codex');
  }
  return sources?.[state.provider]?.shortLabel ?? (state.provider === 'claude' ? 'C' : 'X');
}

function formatProviderWindows(
  state: ProviderUsageState,
  options: FormatOptions,
  resolved: ResolvedDisplayParts
): string[] {
  const displayedWindows = getDisplayedWindows(state, resolved);
  if (!displayedWindows.some(window => isUsableWindow(window.value))) {
    return [];
  }
  return displayedWindows.map(window => formatWindow(window.label, window.value, options, resolved, state));
}

function getDisplayedWindows(
  state: ProviderUsageState,
  resolved: ResolvedDisplayParts
): Array<{ label: string; value: LimitWindow | undefined }> {
  const windows: Array<{ label: string; value: LimitWindow | undefined }> = [];
  if (resolved.sevenDayFirst) {
    if (resolved.showSevenDay) windows.push({ label: '7d', value: state.sevenDay });
    if (resolved.showFiveHour) windows.push({ label: '5h', value: state.fiveHour });
  } else {
    if (resolved.showFiveHour) windows.push({ label: '5h', value: state.fiveHour });
    if (resolved.showSevenDay) windows.push({ label: '7d', value: state.sevenDay });
  }

  if (state.sevenDayOpus?.usedPercentage !== undefined) {
    windows.push({ label: 'opus 7d', value: state.sevenDayOpus });
  }

  return windows;
}

function formatWindow(
  label: string,
  window: LimitWindow | undefined,
  options: FormatOptions,
  resolved: ResolvedDisplayParts,
  state?: ProviderUsageState
): string {
  if (label === '5h' && state && isFiveHourBlockedBySevenDay(state, options)) {
    const prefix = resolved.showWindowLabels && !resolved.countdownBeforeValue ? `${label} ` : '';
    return `${prefix}${quotaIndicatorForRemaining(undefined, true)}blocked`.trim();
  }

  const prefix = resolved.showWindowLabels && !resolved.countdownBeforeValue ? `${label} ` : '';
  if (!window || window.usedPercentage === undefined) {
    const indicator = resolved.showWindowEmoji ? quotaIndicatorForRemaining(undefined, true) : '';
    return `${prefix}${indicator}?`;
  }

  const used = clamp(window.usedPercentage, 0, 100);
  const remaining = clamp(100 - used, 0, 100);
  const shown = options.statusMode === 'remaining' ? remaining : used;
  const value = formatWindowPercent(shown, resolved.showPercentSymbol, options.statusMode === 'remaining');
  const suffix =
    resolved.showProviderNames && resolved.showWindowLabels && !resolved.countdownBeforeValue
      ? ` ${options.statusMode === 'remaining' ? 'left' : 'used'}`
      : '';
  const reset = formatInlineReset(window.resetsAtEpochSeconds, resolved.showCountdownInline, resolved.countdownBeforeValue);
  const indicator = resolved.showWindowEmoji ? quotaIndicatorForRemaining(remaining) : '';

  if (resolved.countdownBeforeValue) {
    return joinStatusParts([prefix.trim(), reset, `${indicator}${value}${suffix}`]);
  }

  const valueWithIndicator = `${indicator}${value}${suffix}`;
  return `${joinStatusParts([prefix.trim(), valueWithIndicator])}${reset ? ` ${reset}` : ''}`;
}

function formatCountdownValue(epochSeconds: number | undefined): string {
  return formatCountdown(epochSeconds, 'now');
}

function formatInlineReset(
  epochSeconds: number | undefined,
  showCountdownInline: boolean,
  countdownBeforeValue: boolean
): string {
  if (!showCountdownInline) {
    return '';
  }

  const value = formatCountdownValue(epochSeconds);
  return countdownBeforeValue ? value : `(${value})`;
}

function providerAlertSeverity(
  state: ProviderUsageState,
  options: FormatOptions,
  resolved = resolveDisplayParts(options)
): StatusSeverity {
  const displayedWindows = getDisplayedWindows(state, resolved)
    .map(window => derivePresentableQuotaWindowState(state, window.value, options));
  const critical = displayedWindows.some(window => window.severity === 'critical');

  if (critical) {
    return 'critical';
  }

  const warning = displayedWindows.some(window => window.severity === 'warning');

  if (warning) {
    return 'warning';
  }

  const low = displayedWindows.some(window => window.severity === 'low');

  return low ? 'low' : 'normal';
}

function providerQuotaEmoji(state: ProviderUsageState, resolved: ResolvedDisplayParts): string {
  if (!state.fiveHour && !state.sevenDay) {
    return '\u26AB';
  }

  const remaining = getDisplayedWindows(state, resolved)
    .map(window => window.value)
    .filter((window): window is LimitWindow => isUsableWindow(window))
    .map(window => 100 - clamp(window.usedPercentage as number, 0, 100));
  if (remaining.length === 0) {
    return '\u26AB';
  }

  return quotaIndicatorForRemaining(Math.min(...remaining));
}

function windowSeverity(window: LimitWindow, options: FormatOptions): StatusSeverity {
  const remaining = 100 - clamp(window.usedPercentage as number, 0, 100);
  if (remaining <= options.criticalRemainingPercent) {
    return 'critical';
  }
  if (remaining <= options.warnRemainingPercent) {
    return 'warning';
  }
  if (remaining <= options.lowRemainingPercent) {
    return 'low';
  }
  return 'normal';
}

function maxSeverity(left: StatusSeverity, right: StatusSeverity): StatusSeverity {
  const rank: Record<StatusSeverity, number> = { normal: 0, low: 1, warning: 2, critical: 3 };
  return rank[right] > rank[left] ? right : left;
}

export function quotaLevelForRemaining(remainingPercent: number | undefined, unavailable = false): QuotaIndicatorLevel {
  if (unavailable || remainingPercent === undefined) return 'unavailable';
  if (remainingPercent >= 91) return 'purple';
  if (remainingPercent >= 71) return 'blue';
  if (remainingPercent >= 51) return 'green';
  if (remainingPercent >= 31) return 'yellow';
  if (remainingPercent >= 11) return 'orange';
  return 'red';
}

export function quotaIndicatorForRemaining(remainingPercent: number | undefined, unavailable = false): string {
  switch (quotaLevelForRemaining(remainingPercent, unavailable)) {
    case 'purple':
      return '\uD83D\uDFE3';
    case 'blue':
      return '\uD83D\uDD35';
    case 'green':
      return '\uD83D\uDFE2';
    case 'yellow':
      return '\uD83D\uDFE1';
    case 'orange':
      return '\uD83D\uDFE0';
    case 'red':
      return '\uD83D\uDD34';
    default:
      return '\u26AB';
  }
}

const PROGRESS_FILLED = '▰';
const PROGRESS_EMPTY = '▱';

const SEVERITY_COLORS: Record<StatusSeverity, string> = {
  normal: '#4CAF50',
  low: '#FFC107',
  warning: '#FF9800',
  critical: '#F44336'
};

function renderProgressBarColored(remainingPercent: number, severity: StatusSeverity, width = 10): string {
  const clamped = clamp(remainingPercent, 0, 100);
  const filled = Math.round((clamped / 100) * width);
  const safeFilled = clamped > 0 && filled < 1 ? 1 : Math.max(0, filled);
  const empty = width - safeFilled;
  const color = SEVERITY_COLORS[severity];
  const filledBlocks = PROGRESS_FILLED.repeat(safeFilled);
  const emptyBlocks = PROGRESS_EMPTY.repeat(Math.max(0, empty));
  if (empty === width) {
    return emptyBlocks;
  }
  return `<span style="color:${color}">${filledBlocks}</span>${emptyBlocks}`;
}

function formatCombinedTooltip(
  states: ProviderUsageState[],
  options: FormatOptions,
  remoteRows?: RemoteQuotaRow[]
): string {
  const lines = ['## PromptFuel', '', ...formatCombinedQuotaSummaryLines(states, options, remoteRows)];

  // model/API table is local-only; remote snapshot data does not contribute
  const breakdown = options.modelBreakdown ? formatCombinedModelBreakdown(options.modelBreakdown, states) : [];
  if (breakdown.length > 0) {
    lines.push('', ...breakdown);
  }

  const details = formatSharedDetails(states, options);
  if (details.length > 0) {
    lines.push('', '**Details**', '', ...details);
  }

  const freshness = formatFreshnessLine(states, options.nextResetRefreshEpochMs);
  if (freshness) {
    lines.push('', freshness);
  }

  return lines.join('\n');
}

function formatCombinedQuotaSummaryLines(
  states: ProviderUsageState[],
  options: FormatOptions,
  remoteRows?: RemoteQuotaRow[]
): string[] {
  // Convention: quota tables use blank/invisible headers; model/API-estimate tables use visible headers.
  const rows = [
    '**Quota**',
    '',
    '|  |  |  |  |  |  |  |  |',
    '|:---|:---:|:---:|---:|:---|:---|:---|:---|'
  ];

  for (const state of states) {
    rows.push(formatCombinedQuotaWindowRow(state, '7d', state.sevenDay, options));
    if (isFiveHourBlockedBySevenDay(state, options)) {
      rows.push(formatCombinedBlockedFiveHourRow(state, options));
    } else {
      rows.push(formatCombinedQuotaWindowRow(state, '5h', state.fiveHour, options));
    }
    if (state.sevenDayOpus?.usedPercentage !== undefined) {
      rows.push(formatCombinedQuotaWindowRow(state, 'opus 7d', state.sevenDayOpus, options));
    }
  }

  if (remoteRows && remoteRows.length > 0) {
    for (const row of remoteRows) {
      const snapNote = row.stale
        ? 'snap ⚠ stale'
        : `snap ${row.snapshotAgeLabel ?? ''}`.trimEnd();
      rows.push(formatCombinedRemoteQuotaRow(
        row.label,
        '7d',
        row.sevenDayRemainingPercent,
        row.sevenDayResetEpochSeconds,
        options,
        snapNote
      ));
      rows.push(formatCombinedRemoteQuotaRow(
        row.label,
        '5h',
        row.fiveHourRemainingPercent,
        row.fiveHourResetEpochSeconds,
        options,
        snapNote
      ));
    }
  }

  return rows;
}

function formatCombinedRemoteQuotaRow(
  label: string,
  windowLabel: '7d' | '5h',
  remainingPercent: number | undefined,
  resetEpochSeconds: number | undefined,
  options: FormatOptions,
  snapshotNote: string
): string {
  if (remainingPercent === undefined) {
    return `| ${label} | ${windowLabel} | ${quotaIndicatorForRemaining(undefined, true)} | unavailable | | | | ${snapshotNote} |`;
  }
  const clamped = clamp(remainingPercent, 0, 100);
  const severity = remainingSeverity(clamped, options);
  const emoji = quotaIndicatorForRemaining(clamped);
  const pct = formatWindowPercent(clamped, true, true);
  const bar = renderProgressBarColored(clamped, severity);
  const countdown = formatTableCountdown(resetEpochSeconds);
  const resetTime = formatTableResetTime(resetEpochSeconds);
  return `| ${label} | ${windowLabel} | ${emoji} | **${pct}** | ${bar} | ${countdown} | ${resetTime} | ${snapshotNote} |`;
}

function remainingSeverity(remaining: number, options: FormatOptions): StatusSeverity {
  if (remaining <= options.criticalRemainingPercent) return 'critical';
  if (remaining <= options.warnRemainingPercent) return 'warning';
  if (remaining <= options.lowRemainingPercent) return 'low';
  return 'normal';
}

function formatCombinedBlockedFiveHourRow(state: ProviderUsageState, options: FormatOptions): string {
  const provider = providerDisplayName(state, options);
  const w = state.fiveHour;
  const pct = w && w.usedPercentage !== undefined ? 100 - clamp(w.usedPercentage, 0, 100) : 0;
  const bar = renderProgressBarColored(pct, 'critical');
  const countdown = w ? formatTableCountdown(w.resetsAtEpochSeconds) : 'unknown';
  const resetTime = w ? formatTableResetTime(w.resetsAtEpochSeconds) : '';
  return `| ${provider} | 5h | ${quotaIndicatorForRemaining(undefined, true)} | blocked | ${bar} | ${countdown} | ${resetTime} | |`;
}

function formatCombinedQuotaWindowRow(
  state: ProviderUsageState,
  label: string,
  window: LimitWindow | undefined,
  options: FormatOptions
): string {
  const provider = providerDisplayName(state, options);
  if (!window || window.usedPercentage === undefined) {
    return `| ${provider} | ${label} | ${quotaIndicatorForRemaining(undefined, true)} | unavailable | | | | |`;
  }

  const used = clamp(window.usedPercentage, 0, 100);
  const remaining = clamp(100 - used, 0, 100);
  const severity = windowSeverity(window, options);
  const emoji = quotaIndicatorForRemaining(remaining);
  const pct = formatWindowPercent(remaining, true, true);
  const bar = renderProgressBarColored(remaining, severity);
  const countdown = formatTableCountdown(window.resetsAtEpochSeconds);
  const resetTime = formatTableResetTime(window.resetsAtEpochSeconds);

  return `| ${provider} | ${label} | ${emoji} | **${pct}** | ${bar} | ${countdown} | ${resetTime} | |`;
}

function formatProviderTooltip(state: ProviderUsageState, options: FormatOptions): string {
  const label = options.normalizedSources?.[state.provider]?.label ?? (state.provider === 'claude' ? 'Claude' : 'Codex');
  const lines = [`## ${label} Quota`, '', ...formatQuotaSummaryLines(state, options)];
  const breakdown = options.modelBreakdown ? formatModelBreakdown(options.modelBreakdown, state.provider) : [];
  if (breakdown.length > 0) {
    lines.push('', ...breakdown);
  }
  const details = formatSharedDetails([state], options);
  if (details.length > 0) {
    lines.push('', '**Details**', '', ...details);
  }

  const freshness = formatFreshnessLine([state], options.nextResetRefreshEpochMs);
  if (freshness) {
    lines.push('', freshness);
  }

  return lines.join('\n');
}

export interface RemoteProviderTooltipInput {
  label: string;
  provider: ProviderName;
  sevenDayRemainingPercent?: number;
  fiveHourRemainingPercent?: number;
  sevenDayResetEpochSeconds?: number;
  fiveHourResetEpochSeconds?: number;
  stale: boolean;
  staleReason?: string;
  snapshotAgeLabel: string;
  snapshotEpochMs?: number;
  modelContributions?: Array<{
    model: string;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    assistantMessages?: number;
  }>;
}

export function formatRemoteProviderTooltip(input: RemoteProviderTooltipInput): string {
  const lines: string[] = [`## ${input.label} Quota`];

  const fakeState: ProviderUsageState = {
    provider: input.provider,
    source: input.stale ? 'stale snapshot' : 'snapshot',
    lastUpdatedEpochMs: input.snapshotEpochMs,
    sevenDay: input.sevenDayRemainingPercent !== undefined ? {
      usedPercentage: 100 - input.sevenDayRemainingPercent,
      resetsAtEpochSeconds: input.sevenDayResetEpochSeconds,
      sourceKind: input.stale ? 'stale' : 'cache',
      sourceUpdatedEpochMs: input.snapshotEpochMs
    } : undefined,
    fiveHour: input.fiveHourRemainingPercent !== undefined ? {
      usedPercentage: 100 - input.fiveHourRemainingPercent,
      resetsAtEpochSeconds: input.fiveHourResetEpochSeconds,
      sourceKind: input.stale ? 'stale' : 'cache',
      sourceUpdatedEpochMs: input.snapshotEpochMs
    } : undefined
  };

  const formatOptions: FormatOptions = {
    displayMode: 'standard',
    statusMode: 'remaining',
    lowRemainingPercent: 50,
    warnRemainingPercent: 30,
    criticalRemainingPercent: 10,
    emptyRemainingPercent: 1
  };

  lines.push('', ...formatQuotaSummaryLines(fakeState, formatOptions));

  const models = input.stale ? [] : (input.modelContributions ?? []).filter(m => m.tokens > 0);
  if (models.length > 0) {
    const modelBreakdown: ModelBreakdownData = {
      [input.provider]: models.map(mc => ({
        label: mc.model,
        totalTokens: mc.tokens,
        assistantMessages: mc.assistantMessages,
        remoteTokens: mc.tokens,
        costUsd: estimateRemoteContributionCost(input.provider, mc)
      }))
    };
    const breakdownLines = formatModelBreakdown(modelBreakdown, input.provider);
    if (breakdownLines.length > 0) {
      lines.push('', ...breakdownLines);
    }
  }

  lines.push('', '**Details**', '');

  const sourceLabel = input.stale
    ? 'snapshot-backed \u00B7 stale'
    : 'snapshot-backed';
  lines.push(`- Source: ${sourceLabel}`);

  if (input.snapshotAgeLabel) {
    const freshnessLabel = input.stale
      ? `stale snapshot (${input.snapshotAgeLabel})`
      : `snapshot (${input.snapshotAgeLabel} ago)`;
    lines.push(`- Freshness: ${freshnessLabel}`);
  }

  if (input.snapshotEpochMs && input.snapshotEpochMs > 0) {
    lines.push(`- Updated: ${formatClockTime(input.snapshotEpochMs)}`);
  }

  if (input.stale) {
    lines.push(input.staleReason
      ? `- Note: Snapshot stale: ${input.staleReason}`
      : '- Note: Snapshot stale');
  }

  if (models.some(model => estimateRemoteContributionCost(input.provider, model) === undefined)) {
    lines.push('- Note: Snapshot API estimate unavailable for rows without model/token components.');
  }

  if (input.snapshotEpochMs && input.snapshotEpochMs > 0) {
    let freshnessLine = `Updated ${formatAgeLabel(input.snapshotEpochMs)} ago`;
    if (input.stale) {
      freshnessLine += ' \u00B7 \u26A0 stale';
    }
    lines.push('', freshnessLine);
  }

  return lines.join('\n');
}

function estimateRemoteContributionCost(
  provider: ProviderName,
  model: {
    model: string;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  }
): number | undefined {
  const inputTokens = model.inputTokens ?? 0;
  const outputTokens = model.outputTokens ?? 0;
  const cacheCreationTokens = model.cacheCreationTokens ?? 0;
  const cacheReadTokens = model.cacheReadTokens ?? 0;
  const componentTotal = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  if (!model.model || componentTotal <= 0 || componentTotal !== model.tokens) {
    return undefined;
  }
  return provider === 'claude'
    ? estimateClaudeCostUsd(inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, [model.model]).costUsd
    : estimateCodexCostUsd(inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, [model.model]).costUsd;
}

function formatFreshnessLine(states: ProviderUsageState[], nextResetRefreshEpochMs?: number): string | undefined {
  const epochMs = Math.max(
    ...states.flatMap(state => [
      state.sevenDay?.sourceUpdatedEpochMs ?? state.lastUpdatedEpochMs ?? 0,
      state.fiveHour?.sourceUpdatedEpochMs ?? state.lastUpdatedEpochMs ?? 0,
      state.lastAuthenticatedRefreshEpochMs ?? 0
    ])
  );
  if (!epochMs || epochMs <= 0) {
    return undefined;
  }

  let line = `Updated ${formatAgeLabel(epochMs)} ago`;
  if (nextResetRefreshEpochMs && nextResetRefreshEpochMs > Date.now()) {
    const next = formatRelativeTime(nextResetRefreshEpochMs / 1000);
    if (next && next !== 'now') {
      line += ` · refresh ${next}`;
    }
  }

  return line;
}

export function addThousandsSeparators(numStr: string): string {
  const parts = numStr.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${addThousandsSeparators((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${addThousandsSeparators((value / 1_000).toFixed(1))}K`;
  }
  return String(Math.round(value));
}

function formatModelBreakdown(breakdown: ModelBreakdownData, provider: string): string[] {
  const rows = breakdown[provider];
  if (!rows || rows.length === 0) return [];

  const label = provider === 'claude' ? 'Claude' : 'Codex';
  const includesRemote = rows.some(row => (row.remoteTokens ?? 0) > 0);
  const hasIncompleteRemoteCost = rows.some(row => (row.remoteTokens ?? 0) > 0 && row.costUsd === undefined);
  const lines: string[] = [
    '',
    includesRemote
      ? `**Models** (${label} ${STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS}d; snapshot history included; API-equivalent estimate, not billing)`
      : `**Models** (${label} ${STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS}d; API-equivalent estimate, not billing)`,
    '',
    '| Model | Tokens | Msgs | API est. |',
    '|:---|---:|---:|---:|'
  ];

  const capped = rows.slice(0, 5);
  for (const row of capped) {
    const modelLabel = escapeMarkdownHtml(row.label);
    const tokens = formatTokenCount(row.totalTokens);
    const msgs = row.assistantMessages !== undefined ? `${row.assistantMessages}` : '';
    const cost = row.costUsd !== undefined ? formatCostShort(row.costUsd) : '';
    lines.push(`| ${modelLabel} | **${tokens}** | ${msgs} | ${cost} |`);
  }

  if (capped.some(r => r.isFallback)) {
    lines.push('', '_Fallback pricing used for unrecognized models._');
  }
  if (hasIncompleteRemoteCost) {
    lines.push('', '_API estimate unavailable for rows without model/token components._');
  }

  return lines;
}

function formatCombinedModelBreakdown(
  breakdown: ModelBreakdownData,
  states: ProviderUsageState[]
): string[] {
  const providerKeys = [
    ...states.map(state => state.provider),
    ...Object.keys(breakdown).filter(provider =>
      !states.some(state => state.provider === provider) &&
      (breakdown[provider] ?? []).some(row => (row.remoteTokens ?? 0) > 0)
    )
  ];
  const providerOrder = new Map(providerKeys.map((provider, index) => [provider, index]));
  const rows = providerKeys.flatMap(provider =>
    (breakdown[provider] ?? []).slice(0, 5).map(row => ({
      provider,
      providerLabel: provider === 'claude' ? 'Claude' : 'Codex',
      row
    }))
  );

  if (rows.length === 0) {
    return [];
  }
  const includesRemote = rows.some(item => (item.row.remoteTokens ?? 0) > 0);
  const hasIncompleteRemoteCost = rows.some(item => (item.row.remoteTokens ?? 0) > 0 && item.row.costUsd === undefined);

  rows.sort((a, b) => {
    const providerDelta = (providerOrder.get(a.provider) ?? 0) - (providerOrder.get(b.provider) ?? 0);
    return providerDelta !== 0 ? providerDelta : b.row.totalTokens - a.row.totalTokens;
  });

  const lines: string[] = [
    includesRemote
      ? `**Models (${STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS}d; snapshot history included; API-equivalent estimate, not billing)**`
      : `**Models (${STATUS_HOVER_MODEL_ESTIMATE_WINDOW_DAYS}d; API-equivalent estimate, not billing)**`,
    '',
    '| Provider | Model | Tokens | Msgs/Turns | API est. |',
    '|:---|:---|---:|---:|---:|'
  ];

  for (const item of rows) {
    const modelLabel = escapeMarkdownHtml(item.row.label);
    const tokens = formatTokenCount(item.row.totalTokens);
    const msgs = item.row.assistantMessages !== undefined ? `${item.row.assistantMessages}` : '';
    const cost = item.row.costUsd !== undefined ? formatCostShort(item.row.costUsd) : '';
    lines.push(`| ${item.providerLabel} | ${modelLabel} | **${tokens}** | ${msgs} | ${cost} |`);
  }

  if (rows.some(r => r.row.isFallback)) {
    lines.push('', '_Fallback pricing used for unrecognized models._');
  }
  if (hasIncompleteRemoteCost) {
    lines.push('', '_API estimate unavailable for rows without model/token components._');
  }

  return lines;
}

function providerDisplayName(state: Pick<ProviderUsageState, 'provider'>, formatOptions?: FormatOptions): string {
  return formatOptions?.normalizedSources?.[state.provider]?.label ?? (state.provider === 'claude' ? 'Claude' : 'Codex');
}

function formatCostShort(costUsd: number): string {
  if (costUsd >= 1) return `$${addThousandsSeparators(costUsd.toFixed(2))}`;
  if (costUsd >= 0.01) return `¢${(costUsd * 100).toFixed(1)}`;
  return '&lt;¢1';
}

function isFiveHourBlockedBySevenDay(state: ProviderUsageState, options: FormatOptions): boolean {
  if (!state.sevenDay || state.sevenDay.usedPercentage === undefined) {
    return false;
  }
  const remaining = 100 - clamp(state.sevenDay.usedPercentage, 0, 100);
  return remaining <= options.emptyRemainingPercent;
}

function formatQuotaSummaryLines(state: ProviderUsageState, options: FormatOptions): string[] {
  // Convention: quota tables use blank/invisible headers; model/API-estimate tables use visible headers.
  const rows = [
    '|  |  |  |  |  |  |',
    '|:---|:---:|---:|:---:|:---|:---|',
    formatQuotaWindowRow('7d', state.sevenDay, options, state)
  ];

  if (isFiveHourBlockedBySevenDay(state, options)) {
    rows.push(formatBlockedFiveHourRow(state, options));
  } else {
    rows.push(formatQuotaWindowRow('5h', state.fiveHour, options, state));
  }

  if (state.sevenDayOpus?.usedPercentage !== undefined) {
    rows.push(formatQuotaWindowRow('opus 7d', state.sevenDayOpus, options, state));
  }

  return rows;
}

function formatBlockedFiveHourRow(state: ProviderUsageState, options: FormatOptions): string {
  const w = state.fiveHour;
  const pct = w && w.usedPercentage !== undefined ? 100 - clamp(w.usedPercentage, 0, 100) : 0;
  const sev = w ? windowSeverity(w, options) : 'critical';
  const bar = renderProgressBarColored(pct, sev);
  const countdown = w ? formatTableCountdown(w.resetsAtEpochSeconds) : 'unknown';
  const resetTime = w ? formatTableResetTime(w.resetsAtEpochSeconds) : '';
  return `| 5h | ${quotaIndicatorForRemaining(undefined, true)} | blocked | ${bar} | ${countdown} | ${resetTime} |`;
}

function formatQuotaWindowRow(
  label: string,
  window: LimitWindow | undefined,
  options: FormatOptions,
  _state: ProviderUsageState
): string {
  if (!window || window.usedPercentage === undefined) {
    return `| ${label} | ${quotaIndicatorForRemaining(undefined, true)} | unavailable | | | |`;
  }

  const used = clamp(window.usedPercentage, 0, 100);
  const remaining = clamp(100 - used, 0, 100);
  const severity = windowSeverity(window, options);
  const emoji = quotaIndicatorForRemaining(remaining);
  const pct = formatWindowPercent(remaining, true, true);
  const bar = renderProgressBarColored(remaining, severity);
  const countdown = formatTableCountdown(window.resetsAtEpochSeconds);
  const resetTime = formatTableResetTime(window.resetsAtEpochSeconds);

  return `| ${label} | ${emoji} | **${pct}** | ${bar} | ${countdown} | ${resetTime} |`;
}

function formatTableCountdown(epochSeconds: number | undefined): string {
  if (!epochSeconds) {
    return 'unknown';
  }

  const diff = epochSeconds * 1000 - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 'now';
  }

  return `**${formatCountdown(epochSeconds)}**`;
}

function formatTableResetTime(epochSeconds: number | undefined): string {
  if (!epochSeconds) {
    return '';
  }

  const ms = epochSeconds * 1000;
  const diff = ms - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return '';
  }

  return formatResetTime(epochSeconds);
}


function formatWindowPercent(value: number, showPercentSymbol: boolean, preserveTinyPositive: boolean): string {
  if (preserveTinyPositive && value > 0 && Math.round(value) === 0) {
    return showPercentSymbol ? '<1%' : '<1';
  }

  return `${Math.round(value)}${showPercentSymbol ? '%' : ''}`;
}

function hasUsableQuota(state: ProviderUsageState): boolean {
  return isUsableWindow(state.fiveHour) || isUsableWindow(state.sevenDay);
}

function isUsableWindow(window: LimitWindow | undefined): boolean {
  return window?.usedPercentage !== undefined;
}

function formatSharedDetails(states: ProviderUsageState[], options: FormatOptions): string[] {
  const details = [`- Source: ${formatSourceSummary(states)}`];
  const freshness = formatQuotaFreshnessSummary(states, options);
  if (freshness) {
    details.push(`- Freshness: ${freshness}`);
  }
  const updated = formatMostRecentTime(states);
  if (updated) {
    details.push(`- Updated: ${updated}`);
  }

  const nextRefresh = formatNextRefresh(states);
  if (nextRefresh) {
    details.push(`- Next refresh: ${nextRefresh}`);
  }

  const nextResetRefresh = formatNextResetRefresh(options.nextResetRefreshEpochMs);
  if (nextResetRefresh) {
    details.push(`- Next reset refresh: ${nextResetRefresh}`);
  }

  const status = formatStatusSummary(states);
  if (status) {
    details.push(`- Status: ${status}`);
  }

  const note = formatNotesLine(states, options);
  if (note) {
    details.push(note);
  }

  return details;
}

function formatNotesLine(states: ProviderUsageState[], options: FormatOptions): string | undefined {
  const parts: string[] = [];
  const expired = formatExpiredFallbackNote(states);
  if (expired) parts.push(expired);
  const fallback = formatAuthenticatedFallbackNote(states);
  if (fallback) parts.push(fallback);
  const ignored = formatIgnoredQuotaSource(states);
  if (ignored) parts.push(ignored);
  const blocked = formatFiveHourBlockedNote(states, options);
  if (blocked) parts.push(blocked);
  if (parts.length === 0) return undefined;
  return `- Note: ${parts.join('; ')}`;
}

function formatFiveHourBlockedNote(states: ProviderUsageState[], options: FormatOptions): string | undefined {
  for (const state of states) {
    if (isFiveHourBlockedBySevenDay(state, options)) {
      const rawRemaining = state.fiveHour?.usedPercentage !== undefined
        ? `${Math.round(100 - clamp(state.fiveHour.usedPercentage, 0, 100))}%`
        : 'unknown';
      const resetStr = state.fiveHour?.resetsAtEpochSeconds
        ? `, resets in ${formatCountdown(state.fiveHour.resetsAtEpochSeconds, 'now')}`
        : '';
      return `5h blocked by 7d cap; raw 5h ${rawRemaining} left${resetStr}`;
    }
  }
  return undefined;
}

function formatSourceSummary(states: ProviderUsageState[]): string {
  const normalized = unique(
    states.flatMap(state => quotaSourceLabels(state)).map(source => normalizeSourceSummary(source))
  );
  if (normalized.length === 0) {
    return 'unknown';
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  return 'mixed sources';
}

function formatMostRecentTime(states: ProviderUsageState[]): string | undefined {
  const epochMs = Math.max(
    ...states.flatMap(state => [
      state.sevenDay?.sourceUpdatedEpochMs ?? 0,
      state.fiveHour?.sourceUpdatedEpochMs ?? 0,
      state.lastUpdatedEpochMs ?? 0
    ])
  );
  return epochMs > 0 ? formatClockTime(epochMs) : undefined;
}

function formatNextRefresh(states: ProviderUsageState[]): string | undefined {
  const candidates = states
    .map(state => state.nextAuthenticatedRefreshEpochMs)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  if (candidates.length > 0) {
    return formatClockTime(Math.min(...candidates));
  }
  return undefined;
}

function formatNextResetRefresh(epochMs: number | undefined): string | undefined {
  if (!epochMs || !Number.isFinite(epochMs)) {
    return undefined;
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }

  return `${formatClockTime(epochMs)} (${formatRelativeTime(epochMs / 1000) ?? 'now'})`;
}

function formatStatusSummary(states: ProviderUsageState[]): string | undefined {
  const noteworthy = unique(
    states
      .map(state => summarizeProviderStatus(state))
      .filter((value): value is string => Boolean(value))
  );

  if (noteworthy.length === 0) {
    return undefined;
  }
  if (noteworthy.length === 1) {
    return noteworthy[0];
  }
  return 'mixed';
}

function summarizeProviderStatus(state: ProviderUsageState): string | undefined {
  const incident = providerIncident(state);
  if (incident) {
    return formatProviderIncident(incident);
  }
  if (state.stale) {
    return 'stale snapshot';
  }
  if (!state.fiveHour && !state.sevenDay) {
    return 'quota unavailable';
  }
  return undefined;
}

function formatQuotaFreshnessSummary(states: ProviderUsageState[], options: FormatOptions): string | undefined {
  const labels = unique(
    states
      .flatMap(state =>
        [state.sevenDay, state.fiveHour]
          .filter(isUsableWindow)
          .map(window => formatFreshnessLabel(derivePresentableQuotaWindowState(state, window, options).freshness))
      )
      .filter((value): value is string => Boolean(value))
  );

  if (labels.length === 0) {
    return undefined;
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return 'mixed';
}

function quotaFreshnessForWindow(
  state: ProviderUsageState,
  window: LimitWindow | undefined
): PresentableQuotaFreshness {
  if (!window || window.usedPercentage === undefined) {
    return 'unknown';
  }

  switch (window.sourceKind) {
    case 'authenticated':
      return state.stale ? 'cached' : 'live';
    case 'cache':
      return 'cached';
    case 'statusLine':
    case 'hook':
    case 'localSession':
      return state.stale ? 'stale' : 'local';
    case 'stale':
      return 'stale';
    default:
      return state.stale ? 'stale' : 'unknown';
  }
}

function formatFreshnessLabel(freshness: PresentableQuotaFreshness): string | undefined {
  switch (freshness) {
    case 'live':
      return 'live';
    case 'cached':
      return 'cached';
    case 'local':
      return 'local';
    case 'stale':
      return 'stale';
    default:
      return undefined;
  }
}

function providerIncident(state: ProviderUsageState): PresentableQuotaIncident | undefined {
  switch (state.authenticatedStatus) {
    case 'auth_expired':
    case 'network_error':
    case 'http_error':
    case 'parse_error':
    case 'backoff':
    case 'disabled':
    case 'not_configured':
      return state.authenticatedStatus;
    default:
      break;
  }

  return state.error ? 'provider_error' : undefined;
}

function formatProviderIncident(incident: PresentableQuotaIncident): string {
  switch (incident) {
    case 'auth_expired':
      return 'auth expired';
    case 'network_error':
      return 'network error';
    case 'http_error':
      return 'HTTP error';
    case 'parse_error':
      return 'parse error';
    case 'backoff':
      return 'refresh backoff';
    case 'disabled':
      return 'provider disabled';
    case 'not_configured':
      return 'provider not configured';
    default:
      return 'provider error';
  }
}

function formatAuthenticatedFallbackNote(states: ProviderUsageState[]): string | undefined {
  const notes = unique(
    states
      .map(state => authenticatedFallbackNote(state))
      .filter((value): value is string => Boolean(value))
  );
  if (notes.length === 0) {
    return undefined;
  }
  if (notes.length === 1) {
    return notes[0];
  }
  return 'Live refresh failed; using last known quota';
}

function formatExpiredFallbackNote(states: ProviderUsageState[]): string | undefined {
  const windows = states.flatMap(state => expiredFallbackWindowLabels(state));
  if (windows.length === 0) {
    return undefined;
  }

  return `Expired cached fallback shown for ${unique(windows).join(', ')}; waiting for post-reset quota data.`;
}

function expiredFallbackWindowLabels(state: ProviderUsageState): string[] {
  const provider = state.provider === 'claude' ? 'Claude' : 'Codex';
  return [
    { label: '7d', window: state.sevenDay },
    { label: '5h', window: state.fiveHour }
  ]
    .filter(item => isExpiredFallbackWindow(item.window))
    .map(item => `${provider} ${item.label}`);
}

function isExpiredFallbackWindow(window: LimitWindow | undefined): boolean {
  if (!window || (window.sourceKind !== 'cache' && window.sourceKind !== 'stale')) {
    return false;
  }
  const reset = window.resetsAtEpochSeconds;
  if (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0) {
    return false;
  }
  return reset * 1000 + RESET_EXPIRY_GRACE_MS < Date.now();
}

function authenticatedFallbackNote(state: ProviderUsageState): string | undefined {
  if (!state.authenticatedStatus || ['success', 'disabled', 'skipped', 'not_configured'].includes(state.authenticatedStatus)) {
    return undefined;
  }
  if (!hasUsableQuota(state)) {
    return undefined;
  }
  if (state.authenticatedStatus === 'backoff') {
    return `Auth refresh in backoff; showing ${fallbackQuotaDescription(state)}`;
  }
  if (state.authenticatedStatus === 'auth_expired') {
    return 'Auth expired; showing last known quota';
  }
  return `Live refresh failed; using ${fallbackQuotaDescription(state)}`;
}

function fallbackQuotaDescription(state: ProviderUsageState): string {
  if (expiredFallbackWindowLabels(state).length > 0) {
    return 'expired cached quota';
  }
  const sourceKinds = unique([state.fiveHour?.sourceKind, state.sevenDay?.sourceKind].filter((value): value is QuotaSourceKind => Boolean(value)));
  if (sourceKinds.includes('cache')) {
    return 'cached quota';
  }
  if (sourceKinds.every(kind => kind === 'localSession' || kind === 'statusLine' || kind === 'hook')) {
    return 'local quota';
  }
  return 'last known quota';
}


function formatResetTime(epochSeconds: number | undefined): string {
  if (!epochSeconds) {
    return 'time unknown';
  }

  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.valueOf())) {
    return 'time unknown';
  }

  return isSameLocalDay(date, new Date())
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.valueOf())
    ? 'unknown'
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function normalizeSourceSummary(source: string | undefined): string {
  const value = (source ?? '').toLowerCase();
  if (!value) {
    return 'unknown';
  }
  if (value.includes('authenticated')) {
    return value.includes('stale') ? 'stale cached authenticated quota' : 'live authenticated refresh';
  }
  if (value.includes('session')) {
    return 'local session snapshot';
  }
  if (value.includes('bridge')) {
    return 'local bridge snapshot';
  }
  if (value.includes('cache')) {
    return 'cached quota snapshot';
  }
  if (value.includes('local')) {
    return 'local state';
  }
  return escapeMarkdownHtml(source ?? 'unknown');
}

function quotaSourceLabels(state: ProviderUsageState): string[] {
  const labels = [state.sevenDay?.sourceLabel, state.fiveHour?.sourceLabel]
    .filter((value): value is string => Boolean(value));
  return labels.length > 0 ? unique(labels) : [state.source ?? 'unknown'];
}

function formatIgnoredQuotaSource(states: ProviderUsageState[]): string | undefined {
  const ignored = unique(
    states
      .map(state => state.ignoredQuotaSource)
      .filter((value): value is string => Boolean(value))
      .map(escapeMarkdownHtml)
  );
  if (ignored.length === 0) {
    return undefined;
  }
  if (ignored.length === 1) {
    return ignored[0];
  }
  return 'Lower-authority quota snapshots ignored';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function joinStatusParts(parts: Array<string | undefined>): string {
  return parts.filter((value): value is string => Boolean(value)).join(' ');
}

function formatSourceInline(state: ProviderUsageState): string {
  const source = (state.source ?? '').toLowerCase();
  if (source.includes('authenticated')) {
    return '@live';
  }
  if (source.includes('session')) {
    return '@session';
  }
  if (source.includes('bridge')) {
    return '@bridge';
  }
  if (source.includes('cache')) {
    return '@cache';
  }
  if (source.includes('local')) {
    return '@device';
  }
  return '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeMarkdownHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface ResolvedDisplayParts {
  showEmoji: boolean;
  showProviderNames: boolean;
  showFiveHour: boolean;
  showSevenDay: boolean;
  sevenDayFirst: boolean;
  showPercentSymbol: boolean;
  showCountdownInline: boolean;
  showSourceInline: boolean;
  showStaleInline: boolean;
  providerNameStyle: 'short' | 'full';
  showWindowLabels: boolean;
  showWindowEmoji: boolean;
  countdownBeforeValue: boolean;
  windowSeparator: string;
}
