import * as fsp from 'node:fs/promises';

export async function fileEndsWithLineBreak(file: string): Promise<boolean> {
  const handle = await fsp.open(file, 'r');
  try {
    const stats = await handle.stat();
    if (stats.size === 0) {
      return true;
    }

    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, stats.size - 1);
    return buffer[0] === 10 || buffer[0] === 13;
  } finally {
    await handle.close();
  }
}

export function normalizeJsonlLine(line: string): string | undefined {
  const normalized = trimBoundaryNuls(line);
  if (!normalized.trim()) {
    return undefined;
  }
  return normalized;
}

function trimBoundaryNuls(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value.charCodeAt(start) === 0) {
    start++;
  }

  while (end > start && value.charCodeAt(end - 1) === 0) {
    end--;
  }

  if (start === 0 && end === value.length) {
    return value;
  }

  return value.slice(start, end);
}
