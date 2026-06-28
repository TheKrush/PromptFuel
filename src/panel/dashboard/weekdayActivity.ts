import { formatPercent } from './format';

interface WeekdaySourceModel {
  label?: string;
  model?: string;
  pricingModel?: string;
  provider?: 'claude' | 'codex';
  providerLabel?: string;
  totalTokens?: number;
  assistantMessages?: number;
}

interface WeekdaySource {
  dateKey?: string;
  totalTokens?: number;
  assistantMessages?: number;
  models?: WeekdaySourceModel[];
}

export interface WeekdayModelTotal {
  label: string;
  model: string;
  pricingModel?: string;
  provider?: 'claude' | 'codex';
  providerLabel?: string;
  totalTokens: number;
  assistantMessages: number;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface WeekdayActivityEntry {
  weekday: number;          // 0=Sun .. 6=Sat (canonical; render rotates for display)
  label: string;            // 'Sun', 'Mon', ...
  longLabel: string;        // 'Sunday', 'Monday', ...
  totalTokens: number;
  assistantMessages: number;
  percent: number;          // 0..1 share of grandTotalTokens
  percentLabel: string;     // formatted e.g. '42%'
  activeDays: number;       // distinct dates with activity (for tooltip)
  models: WeekdayModelTotal[];  // aggregated model totals — preserved for future stacked render
}

export interface WeekdayActivityBreakdown {
  available: boolean;
  entries: WeekdayActivityEntry[];  // always length 7, Sun..Sat order
  grandTotalTokens: number;
  busiestWeekday?: number;          // index of weekday with most tokens
}

export function buildWeekdayActivityBreakdown(
  points: WeekdaySource[] | undefined
): WeekdayActivityBreakdown {
  const totals: { tokens: number; messages: number }[] = Array.from(
    { length: 7 },
    () => ({ tokens: 0, messages: 0 })
  );
  const activeDateKeys: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  const modelMaps: Map<string, WeekdayModelTotal>[] = Array.from({ length: 7 }, () => new Map());

  for (const point of points ?? []) {
    const weekday = parseDateKeyWeekday(point.dateKey);
    if (weekday === -1) {
      continue;
    }
    const tokens = Math.max(0, point.totalTokens ?? 0);
    const msgs = Math.max(0, point.assistantMessages ?? 0);
    totals[weekday].tokens += tokens;
    totals[weekday].messages += msgs;
    if ((tokens > 0 || msgs > 0) && point.dateKey) {
      activeDateKeys[weekday].add(point.dateKey);
    }
    for (const model of (point.models ?? [])) {
      const rawModel = model.model || model.label || 'unknown';
      const key = model.provider ? `${model.provider}\0${rawModel}` : rawModel;
      const existing = modelMaps[weekday].get(key) ?? {
        label: model.label || rawModel,
        model: rawModel,
        pricingModel: model.pricingModel,
        provider: model.provider,
        providerLabel: model.providerLabel,
        totalTokens: 0,
        assistantMessages: 0
      };
      existing.totalTokens += Math.max(0, model.totalTokens ?? 0);
      existing.assistantMessages += Math.max(0, model.assistantMessages ?? 0);
      modelMaps[weekday].set(key, existing);
    }
  }

  const grandTotalTokens = totals.reduce((sum, t) => sum + t.tokens, 0);

  const entries: WeekdayActivityEntry[] = totals.map((t, i) => {
    const percent = grandTotalTokens > 0 ? t.tokens / grandTotalTokens : 0;
    return {
      weekday: i,
      label: WEEKDAY_SHORT[i],
      longLabel: WEEKDAY_LONG[i],
      totalTokens: t.tokens,
      assistantMessages: t.messages,
      percent,
      percentLabel: formatPercent(percent),
      activeDays: activeDateKeys[i].size,
      models: Array.from(modelMaps[i].values()).sort((a, b) => b.totalTokens - a.totalTokens)
    };
  });

  let busiestWeekday: number | undefined;
  if (grandTotalTokens > 0) {
    busiestWeekday = entries.reduce(
      (maxIdx, e) => e.totalTokens > entries[maxIdx].totalTokens ? e.weekday : maxIdx,
      0
    );
  }

  return {
    available: grandTotalTokens > 0,
    entries,
    grandTotalTokens,
    busiestWeekday
  };
}

function parseDateKeyWeekday(dateKey: string | undefined): number {
  if (!dateKey) { return -1; }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) { return -1; }
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(d.getTime())) { return -1; }
  return d.getDay();
}
