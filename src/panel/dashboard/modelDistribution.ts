import type { ClaudeUsageHistory } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory } from '../../providers/codexCorrelatedDayBucketScanner';
import type { RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardModelDistributionChart } from '../usageDashboardModel';
import { sourceInfo, formatPercent, shortenClaudeModel, shortenCodexModel, accumulateLocalHistoryModelRows } from './format';

export function buildClaudeModelDistribution(claudeUsageHistory: ClaudeUsageHistory | undefined, remoteModelEntries?: RemoteModelEntry[]): UsageDashboardModelDistributionChart {
  const hasRemote = Boolean(remoteModelEntries?.length);
  const localAvailable = Boolean(claudeUsageHistory?.available && claudeUsageHistory.days.some(day => day.modelUsage.some(m => displayTotalTokens(m) > 0)));

  const source = localAvailable && hasRemote
    ? sourceInfo('mixedDayBucket', 'Claude history model distribution — merged', 'Local day-bucket model data merged with snapshot contributions.')
    : localAvailable
      ? sourceInfo('trustedCompletedTurnUsage', 'Claude assistant-message JSONL history buckets', 'Completed Claude assistant records with message.usage only')
      : hasRemote
        ? sourceInfo('snapshotOnly', 'Snapshot model distribution', 'Model distribution from selected imported snapshots only.')
        : sourceInfo('unavailable', 'Claude assistant-message history unavailable', undefined, claudeUsageHistory?.error ?? 'No trusted completed-turn history is available yet.');

  if (!localAvailable && !hasRemote) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      totalTokens: 0,
      segments: [],
      unavailableReason: source.unavailableReason ?? 'No Claude model distribution is available for this range.',
      source
    };
  }

  const modelTotals = new Map<string, { totalTokens: number; assistantMessages: number }>();

  if (localAvailable) {
    accumulateLocalHistoryModelRows(modelTotals, claudeUsageHistory!.days);
  }

  if (hasRemote) {
    for (const entry of remoteModelEntries!) {
      const existing = modelTotals.get(entry.model);
      if (existing) {
        existing.totalTokens += entry.tokens;
        existing.assistantMessages += entry.assistantMessages ?? 0;
      } else {
        modelTotals.set(entry.model, { totalTokens: entry.tokens, assistantMessages: entry.assistantMessages ?? 0 });
      }
    }
  }

  const allEntries = Array.from(modelTotals.entries())
    .filter(([, v]) => v.totalTokens > 0)
    .map(([model, v]) => ({ model, totalTokens: v.totalTokens, assistantMessages: v.assistantMessages }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  if (allEntries.length === 0) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      totalTokens: 0,
      segments: [],
      unavailableReason: 'No Claude model distribution is available for this range.',
      source
    };
  }

  const top = allEntries.slice(0, 5);
  const otherTotal = allEntries.slice(5).reduce((sum, e) => ({ model: 'Other', totalTokens: sum.totalTokens + e.totalTokens, assistantMessages: sum.assistantMessages + e.assistantMessages }), { model: 'Other', totalTokens: 0, assistantMessages: 0 });
  const entries = otherTotal.totalTokens > 0 ? [...top, otherTotal] : top;
  const grandTotal = allEntries.reduce((sum, e) => sum + e.totalTokens, 0);

  return {
    available: entries.length > 0,
    title: 'Model distribution',
    rangeLabel: '1M / 30d',
    totalTokens: grandTotal,
    segments: entries.map(model => {
      const percent = model.totalTokens / grandTotal;
      return {
        label: model.model === 'Other' ? 'Other' : shortenClaudeModel(model.model),
        model: model.model,
        totalTokens: model.totalTokens,
        assistantMessages: model.assistantMessages,
        percent,
        percentLabel: formatPercent(percent)
      };
    }),
    source
  };
}

export function buildCodexModelDistribution(codexCorrelatedHistory: CodexCorrelatedHistory | undefined, remoteModelEntries?: RemoteModelEntry[]): UsageDashboardModelDistributionChart {
  const hasRemote = Boolean(remoteModelEntries?.length);
  const localAvailable = Boolean(codexCorrelatedHistory?.available && codexCorrelatedHistory.days.some(day => day.modelUsage.some(m => displayTotalTokens(m) > 0)));

  const source = localAvailable && hasRemote
    ? sourceInfo('mixedDayBucket', 'Codex history model distribution — merged', 'Local correlated day-bucket model data merged with snapshot contributions.')
    : localAvailable
      ? sourceInfo('correlatedDayBucket', 'Codex correlated day-bucket history', 'Correlated from ordered Codex JSONL event logs; not Claude-equivalent completed-turn records.')
      : hasRemote
        ? sourceInfo('snapshotOnly', 'Codex snapshot model distribution', 'Model distribution from selected imported Codex snapshots only.')
        : sourceInfo('unavailable', 'Codex correlated day-bucket history unavailable', undefined, codexCorrelatedHistory?.error ?? 'No Codex correlated model distribution is available yet.');

  if (!localAvailable && !hasRemote) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      totalTokens: 0,
      segments: [],
      unavailableReason: source.unavailableReason ?? 'No Codex model distribution is available for this range.',
      source
    };
  }

  const modelTotals = new Map<string, { totalTokens: number; assistantMessages: number }>();

  if (localAvailable) {
    accumulateLocalHistoryModelRows(modelTotals, codexCorrelatedHistory!.days);
  }

  if (hasRemote) {
    for (const entry of remoteModelEntries!) {
      const existing = modelTotals.get(entry.model);
      if (existing) {
        existing.totalTokens += entry.tokens;
        existing.assistantMessages += entry.assistantMessages ?? 0;
      } else {
        modelTotals.set(entry.model, { totalTokens: entry.tokens, assistantMessages: entry.assistantMessages ?? 0 });
      }
    }
  }

  const allEntries = Array.from(modelTotals.entries())
    .filter(([, v]) => v.totalTokens > 0)
    .map(([model, v]) => ({ model, totalTokens: v.totalTokens, assistantMessages: v.assistantMessages }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  if (allEntries.length === 0) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      totalTokens: 0,
      segments: [],
      unavailableReason: 'No Codex model distribution is available for this range.',
      source
    };
  }

  const top = allEntries.slice(0, 5);
  const otherTotal = allEntries.slice(5).reduce((sum, e) => ({ model: 'Other', totalTokens: sum.totalTokens + e.totalTokens, assistantMessages: sum.assistantMessages + e.assistantMessages }), { model: 'Other', totalTokens: 0, assistantMessages: 0 });
  const entries = otherTotal.totalTokens > 0 ? [...top, otherTotal] : top;
  const grandTotal = allEntries.reduce((sum, e) => sum + e.totalTokens, 0);

  return {
    available: entries.length > 0,
    title: 'Model distribution',
    rangeLabel: '1M / 30d',
    totalTokens: grandTotal,
    segments: entries.map(model => {
      const percent = model.totalTokens / grandTotal;
      return {
        label: shortenCodexModel(model.model),
        model: model.model,
        totalTokens: model.totalTokens,
        assistantMessages: model.assistantMessages,
        percent,
        percentLabel: formatPercent(percent)
      };
    }),
    source
  };
}
