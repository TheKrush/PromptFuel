import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderReader, ReadResult } from '../core/providerReader';

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

    const count = await countJsonlFiles(this.projectsRoot, 4);
    if (count === 0) {
      return { providerId: 'claude', status: 'no-data', filesFound: 0 };
    }
    return { providerId: 'claude', status: 'ok', filesFound: count };
  }
}

async function countJsonlFiles(root: string, maxDepth: number): Promise<number> {
  let count = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        count++;
      }
    }
  }

  await walk(root, 0);
  return count;
}
