import type { UsageDashboardModel, UsageDashboardProvider, UsageDashboardWindow } from '../usageDashboardModel';
import { sourceInfo } from './format';

export function annotateSourceConfidence(
  model: UsageDashboardModel
): UsageDashboardModel {
  model.details.source = sourceInfo(
    'snapshotOnly',
    'Current normalized provider snapshot',
    'Snapshot counters are not daily history.'
  );

  for (const card of model.details.cards) {

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
