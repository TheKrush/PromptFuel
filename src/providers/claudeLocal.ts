import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderReader, ReadResult } from '../core/providerReader';
import { parseClaudeUsage } from './claudeUsageParser';

export function defaultClaudeProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export class ClaudeLocalReader implements ProviderReader {
  readonly providerId = 'claude';
  private readonly projectsRoot: string;

  constructor(projectsRoot?: string) {
    this.projectsRoot = projectsRoot ?? defaultClaudeProjectsPath();
  }

  async read(): Promise<ReadResult> {
    try {
      await fsp.access(this.projectsRoot);
    } catch {
      return { providerId: 'claude', status: 'not-found' };
    }

    const { aggregate, localHistoryWindows, modelAggregates, localHistoryModelWindows, stats } = await parseClaudeUsage(this.projectsRoot);

    if (stats.recordsMatched === 0) {
      return {
        providerId: 'claude',
        status: 'no-data',
        filesFound: stats.filesInspected,
        parseErrors: stats.parseErrors,
        recordsRead: stats.recordsRead,
        recordsMatched: 0,
      };
    }

    return {
      providerId: 'claude',
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
    };
  }
}
