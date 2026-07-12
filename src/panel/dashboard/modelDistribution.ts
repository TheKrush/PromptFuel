import type { ClaudeUsageHistory } from '../../providers/claudeDayBucketScanner';
import type { CodexCorrelatedHistory } from '../../providers/codexCorrelatedDayBucketScanner';
import type { RemoteModelEntry } from '../../snapshot/remoteUsageProjection';
import { displayTotalTokens } from '../../snapshot/tokenMath';
import type { UsageDashboardModelDistributionChart } from '../usageDashboardModel';
import { sourceInfo, formatPercent, shortenClaudeModel, shortenCodexModel } from './format';
import { modelPricingFields } from './pricingFields';

interface LocalHistoryModelUsageRow {
  model: string;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface ModelDistributionTotal {
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  assistantMessages: number;
}

function mergeModelDistributionTotal(
  modelTotals: Map<string, ModelDistributionTotal>,
  entry: ModelDistributionTotal
): void {
  const existing = modelTotals.get(entry.model);
  if (existing) {
    existing.totalTokens += entry.totalTokens;
    existing.inputTokens += entry.inputTokens;
    existing.outputTokens += entry.outputTokens;
    existing.cacheCreationInputTokens += entry.cacheCreationInputTokens;
    existing.cacheReadInputTokens += entry.cacheReadInputTokens;
    existing.assistantMessages += entry.assistantMessages;
  } else {
    modelTotals.set(entry.model, { ...entry });
  }
}

function accumulateLocalModelRows(
  modelTotals: Map<string, ModelDistributionTotal>,
  days: ReadonlyArray<{ modelUsage: ReadonlyArray<LocalHistoryModelUsageRow> }>
): void {
  for (const day of days) {
    for (const model of day.modelUsage) {
      const totalTokens = displayTotalTokens(model);
      if (!model.model || totalTokens <= 0) {
        continue;
      }
      mergeModelDistributionTotal(modelTotals, {
        model: model.model,
        totalTokens,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheCreationInputTokens: model.cacheCreationInputTokens,
        cacheReadInputTokens: model.cacheReadInputTokens,
        assistantMessages: model.assistantMessages
      });
    }
  }
}

function accumulateRemoteModelRows(
  modelTotals: Map<string, ModelDistributionTotal>,
  entries: RemoteModelEntry[]
): void {
  for (const entry of entries) {
    mergeModelDistributionTotal(modelTotals, {
      model: entry.model,
      totalTokens: entry.tokens,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationInputTokens: entry.cacheCreationTokens,
      cacheReadInputTokens: entry.cacheReadTokens,
      assistantMessages: entry.assistantMessages ?? 0
    });
  }
}

export function buildClaudeModelDistribution(
  claudeUsageHistory: ClaudeUsageHistory | undefined,
  remoteModelEntries?: RemoteModelEntry[],
  providerLabel = 'Claude'
): UsageDashboardModelDistributionChart {
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
      providerLabel,
      totalTokens: 0,
      segments: [],
      unavailableReason: source.unavailableReason ?? 'No Claude model distribution is available for this range.',
      source
    };
  }

  const modelTotals = new Map<string, ModelDistributionTotal>();

  if (localAvailable) {
    accumulateLocalModelRows(modelTotals, claudeUsageHistory!.days);
  }

  if (hasRemote) {
    accumulateRemoteModelRows(modelTotals, remoteModelEntries!);
  }

  const allEntries = Array.from(modelTotals.entries())
    .filter(([, v]) => v.totalTokens > 0)
    .map(([, v]) => v)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  if (allEntries.length === 0) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      providerLabel,
      totalTokens: 0,
      segments: [],
      unavailableReason: 'No Claude model distribution is available for this range.',
      source
    };
  }

  const grandTotal = allEntries.reduce((sum, e) => sum + e.totalTokens, 0);

  return {
    available: true,
    title: 'Model distribution',
    rangeLabel: '1M / 30d',
    providerLabel,
    totalTokens: grandTotal,
    segments: allEntries.map(model => {
      const percent = model.totalTokens / grandTotal;
      return {
        label: shortenClaudeModel(model.model),
        model: model.model,
        provider: 'claude' as const,
        providerLabel,
        totalTokens: model.totalTokens,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheCreationInputTokens: model.cacheCreationInputTokens,
        cacheReadInputTokens: model.cacheReadInputTokens,
        assistantMessages: model.assistantMessages,
        percent,
        percentLabel: formatPercent(percent),
        ...modelPricingFields('claude', model.model, model)
      };
    }),
    source
  };
}

export function buildCodexModelDistribution(
  codexCorrelatedHistory: CodexCorrelatedHistory | undefined,
  remoteModelEntries?: RemoteModelEntry[],
  providerLabel = 'Codex'
): UsageDashboardModelDistributionChart {
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
      providerLabel,
      totalTokens: 0,
      segments: [],
      unavailableReason: source.unavailableReason ?? 'No Codex model distribution is available for this range.',
      source
    };
  }

  const modelTotals = new Map<string, ModelDistributionTotal>();

  if (localAvailable) {
    accumulateLocalModelRows(modelTotals, codexCorrelatedHistory!.days);
  }

  if (hasRemote) {
    accumulateRemoteModelRows(modelTotals, remoteModelEntries!);
  }

  const allEntries = Array.from(modelTotals.entries())
    .filter(([, v]) => v.totalTokens > 0)
    .map(([, v]) => v)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  if (allEntries.length === 0) {
    return {
      available: false,
      title: 'Model distribution',
      rangeLabel: '1M / 30d',
      providerLabel,
      totalTokens: 0,
      segments: [],
      unavailableReason: 'No Codex model distribution is available for this range.',
      source
    };
  }

  const grandTotal = allEntries.reduce((sum, e) => sum + e.totalTokens, 0);

  return {
    available: true,
    title: 'Model distribution',
    rangeLabel: '1M / 30d',
    providerLabel,
    totalTokens: grandTotal,
    segments: allEntries.map(model => {
      const percent = model.totalTokens / grandTotal;
      return {
        label: shortenCodexModel(model.model),
        model: model.model,
        provider: 'codex' as const,
        providerLabel,
        totalTokens: model.totalTokens,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheCreationInputTokens: model.cacheCreationInputTokens,
        cacheReadInputTokens: model.cacheReadInputTokens,
        assistantMessages: model.assistantMessages,
        percent,
        percentLabel: formatPercent(percent),
        ...modelPricingFields('codex', model.model, model)
      };
    }),
    source
  };
}
