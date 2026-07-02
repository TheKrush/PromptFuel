const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
let exitCode = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  exitCode = 1;
}

const mojibakeSignatures = ['Â', 'â€', 'âš', 'â–', 'Ã©', 'Ã¢'];

let filesScanned = 0;
for (const relative of ['src', 'scripts', 'data']) {
  const root = path.join(repo, relative);
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (!/\.(ts|js|cjs|json)$/.test(file)) continue;
    if (path.relative(repo, file) === path.join('scripts', 'check-encoding.cjs')) continue;
    filesScanned++;

    const buf = fs.readFileSync(file);
    const relPath = path.relative(repo, file);

    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      fail(`UTF-8 BOM found at start of ${relPath}`);
    }

    const text = buf.toString('utf8');
    for (const signature of mojibakeSignatures) {
      if (text.includes(signature)) {
        fail(`mojibake signature ${JSON.stringify(signature)} found in ${relPath}`);
      }
    }
  }
}

if (exitCode === 0) {
  console.log(`PASS: No BOM or mojibake signatures found in ${filesScanned} files.`);
}

process.exit(exitCode);

function* walk(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    yield root;
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === '.git') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}
