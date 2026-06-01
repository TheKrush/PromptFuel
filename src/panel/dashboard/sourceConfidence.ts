import type { ClaudeTodayUsageBucket } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedDayBucket } from '../../providers/codexCorrelatedDayBucketScanner';
import type { RemoteUsageProjection } from '../../snapshot/remoteUsageProjection';
import type { UsageDashboardModel, UsageDashboardProvider, UsageDashboardWindow, UsageDashboardSourceInfo } from '../usageDashboardModel';
import { sourceInfo } from './format';
import { buildTodaySectionSource } from './today';

export function annotateSourceConfidence(
  model: UsageDashboardModel,
  claudeTodayUsage?: ClaudeTodayUsageBucket,
  codexTodayUsage?: CodexCorrelatedDayBucket,
  remoteUsage?: RemoteUsageProjection
): UsageDashboardModel {
  const claudeTodayAvailable = Boolean(claudeTodayUsage?.available);
  const codexTodayAvailable = Boolean(codexTodayUsage?.available);
  const hasRemoteToday = Boolean(remoteUsage?.claudeToday || remoteUsage?.codexToday);
  const claudeTodaySource = claudeTodayUsage?.available
    ? sourceInfo(
      'trustedCompletedTurnUsage',
      'Claude assistant-message JSONL day bucket',
      'Completed Claude assistant records with message.usage only'
    )
    : sourceInfo(
      'unavailable',
      'Claude assistant-message day bucket unavailable',
      undefined,
      claudeTodayUsage?.error ?? 'No trusted completed-turn usage data is available for today.'
    );

  const codexTodaySource = codexTodayUsage?.available
    ? sourceInfo(
      'correlatedDayBucket',
      'Codex correlated day-bucket history',
      'Correlated from ordered Codex JSONL event logs; not Claude-equivalent completed-turn records.'
    )
    : sourceInfo(
      'unavailable',
      'Codex correlated day-bucket usage unavailable',
      undefined,
      codexTodayUsage?.error ?? 'No Codex correlated usage data is available yet.'
    );

  model.today.source = buildTodaySectionSource(claudeTodayAvailable, codexTodayAvailable, hasRemoteToday, claudeTodaySource, codexTodaySource);

  for (const card of model.today.cards) {
    if (card.source) {
      continue;
    }
    if (card.key === 'todayApiEquivalent' || card.key === 'codexTodayApiEquivalent') {
      card.source = card.available
        ? sourceInfo(
          'apiEquivalentEstimate',
          card.key === 'todayApiEquivalent' ? 'Claude API-equivalent estimate' : 'Codex API-equivalent estimate',
          'Estimate from token counts and published model pricing; not actual billing.'
        )
        : sourceInfo(
          'unavailable',
          'API-equivalent estimate unavailable',
          undefined,
          card.detail ?? 'No today usage data available; cannot estimate API-equivalent cost.'
        );
      continue;
    }

    if (card.key.startsWith('codex')) {
      card.source = card.available
        ? codexTodaySource
        : sourceInfo(
          'unavailable',
          'Codex today usage unavailable',
          undefined,
          codexTodayUsage?.error ?? 'No Codex today usage data is available yet.'
        );
      continue;
    }

    card.source = card.available
      ? claudeTodaySource
      : sourceInfo(
        'unavailable',
        'Claude today usage unavailable',
        undefined,
        claudeTodayUsage?.error ?? 'No Claude today usage data is available yet.'
      );
  }

  model.details.source = sourceInfo(
    'snapshotOnly',
    'Current normalized provider snapshot',
    'Snapshot counters are not daily history.'
  );

  for (const card of model.details.cards) {
    if (card.key === 'historyApiEquivalent' || card.key === 'codexHistoryApiEquivalent') {
      card.source = card.available
        ? sourceInfo(
          'apiEquivalentEstimate',
          card.key === 'historyApiEquivalent' ? 'Claude history API-equivalent estimate' : 'Codex history API-equivalent estimate',
          'Estimate from per-model token counts and published model pricing; not actual billing.'
        )
        : card.source;
      continue;
    }

    if (card.source) {
      continue;
    }

    if (card.key === 'apiEquivalent') {
      card.source = card.available
        ? sourceInfo(
          'apiEquivalentEstimate',
          'API-equivalent estimate from provider tracing',
          'Estimate only; not actual billing.'
        )
        : sourceInfo(
          'unavailable',
          'API-equivalent estimate unavailable',
          undefined,
          'No safe cost estimate is available yet.'
        );
      continue;
    }

    card.source = card.available
      ? sourceInfo(
        'snapshotOnly',
        'Current normalized provider snapshot',
        'Snapshot counters are not daily history.'
      )
      : sourceInfo(
        'unavailable',
        'Provider snapshot unavailable',
        undefined,
        'No safe token data is available yet.'
      );
  }

  for (const provider of model.details.providers) {
    provider.source = provider.available
      ? sourceInfo(
        'snapshotOnly',
        `${provider.label} current normalized provider snapshot`,
        'Snapshot counters are not daily history.'
      )
      : sourceInfo(
        'unavailable',
        `${provider.label} provider counters unavailable`,
        undefined,
        'No safe normalized provider counters are available yet.'
      );
  }

  for (const provider of model.providers) {
    for (const window of provider.windows) {
      window.source = window.available
        ? sourceInfo(
          'quotaState',
          `${provider.label} ${window.label} quota window`,
          'Quota state only; not daily usage history.'
        )
        : sourceInfo(
          'unavailable',
          `${provider.label} ${window.label} quota window unavailable`,
          undefined,
          quotaWindowUnavailableReason(provider, window)
        );
    }
  }

  return model;
}

function quotaWindowUnavailableReason(
  provider: UsageDashboardProvider,
  window: UsageDashboardWindow
): string {
  if (window.resetIso || window.resetLabel) {
    return `${provider.label} ${window.label} quota has reset metadata but no usable percentage.`;
  }
  return `${provider.label} ${window.label} quota is missing from the current provider state.`;
}
