import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderReader, ReadResult } from '../core/providerReader';

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

    const count = await countJsonlFiles(this.sessionsRoot, 3);
    if (count === 0) {
      return { providerId: 'codex', status: 'no-data', filesFound: 0 };
    }
    return { providerId: 'codex', status: 'ok', filesFound: count };
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
