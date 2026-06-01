import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderReader, ReadResult } from '../core/providerReader';
import { parseCodexUsage } from './codexUsageParser';

export function defaultCodexSessionsPath(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export class CodexLocalReader implements ProviderReader {
  readonly providerId = 'codex';
  private readonly sessionsRoot: string;

  constructor(sessionsRoot?: string) {
    this.sessionsRoot = sessionsRoot ?? defaultCodexSessionsPath();
  }

  async read(): Promise<ReadResult> {
    try {
      await fsp.access(this.sessionsRoot);
    } catch {
      return { providerId: 'codex', status: 'not-found' };
    }

    const { aggregate, localHistoryWindows, modelAggregates, localHistoryModelWindows, historyBuckets, stats } = await parseCodexUsage(this.sessionsRoot);

    if (stats.recordsMatched === 0) {
      return {
        providerId: 'codex',
        status: 'no-data',
        filesFound: stats.filesInspected,
        parseErrors: stats.parseErrors,
        recordsRead: stats.recordsRead,
        recordsMatched: 0,
      };
    }

    return {
      providerId: 'codex',
      status: 'ok',
      filesFound: stats.filesInspected,
      parseErrors: stats.parseErrors,
      recordsRead: stats.recordsRead,
      recordsMatched: stats.recordsMatched,
      totalTokens: aggregate.totalTokens,
      totalInputTokens: aggregate.totalInputTokens,
      totalOutputTokens: aggregate.totalOutputTokens,
      totalAssistantMessages: aggregate.totalAssistantMessages,
      localHistoryWindows,
      modelAggregates,
      localHistoryModelWindows,
      historyBuckets,
    };
  }
}
