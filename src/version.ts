import * as fs from 'node:fs';
import * as path from 'node:path';

const pkgPath = path.join(__dirname, '..', 'package.json');
let rawVersion: string;
try {
  rawVersion = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
} catch {
  rawVersion = '0.0.0';
}

export const EXTENSION_VERSION: string = rawVersion;
export const USER_AGENT = `PromptFuel-VSCode/${rawVersion}`;
