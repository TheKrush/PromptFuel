const fs = require('fs');
const path = require('path');

// ── Context ──────────────────────────────────────────────
const eventName = process.env.GITHUB_EVENT_NAME || '';
const eventPath = process.env.GITHUB_EVENT_PATH || '';
const changedRaw = (process.env.CHANGED_FILES || '').trim();
const changedFiles = changedRaw ? changedRaw.split(/\s+/).filter(Boolean) : [];

// ── Commit message ───────────────────────────────────────
let commitMessage = '';
try {
  if (eventPath && fs.existsSync(eventPath)) {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (eventName === 'push' && event.head_commit) {
      commitMessage = event.head_commit.message || '';
    } else if (eventName === 'pull_request' && event.pull_request) {
      commitMessage = (event.pull_request.title || '') + '\n' + (event.pull_request.body || '');
    }
  }
} catch {
  // ignore parse errors
}

const lowerMsg = commitMessage.toLowerCase();
const tags = (commitMessage.match(/\[([^\]]+)\]/g) || []).map(t => t.toLowerCase());
const hasTag = (t) => tags.includes(t.toLowerCase());

// ── Path helpers ─────────────────────────────────────────
const isSource = (f) => f.startsWith('src/') || f === 'package.json' || f === 'package-lock.json' || f === 'tsconfig.json';
const isManifest = (f) => f === 'package.json' || f === '.vscodeignore' || f === 'README.md' || f === 'LICENSE' || f === 'SECURITY.md';
const isWorkflow = (f) => f.startsWith('.github/workflows/') || f.startsWith('.github/scripts/') || f.startsWith('scripts/');
const isDocAsset = (f) =>
  f === 'CODE_OF_CONDUCT.md' || f === 'CONTRIBUTING.md' ||
  f.endsWith('.png') || f.startsWith('DO_NOT_DELETE/') ||
  f === 'images.txt' || f === '.gitignore';

const hasSource = changedFiles.some(isSource);
const hasManifest = changedFiles.some(isManifest);
const hasWorkflow = changedFiles.some(isWorkflow);
const docsOnly = changedFiles.length > 0 && changedFiles.every(isDocAsset);

// ── Decisions ────────────────────────────────────────────
let runCompile = false;
let runManifest = false;
let runPackage = false;
let skipReason = '';

if (eventName === 'workflow_dispatch') {
  runCompile = true;
  runManifest = true;
  runPackage = true;
  skipReason = 'workflow_dispatch: running all steps';
} else if (hasTag('[skip-ci]')) {
  skipReason = '[skip-ci] tag present';
} else if (hasTag('[full-ci]')) {
  runCompile = true;
  runManifest = true;
  runPackage = true;
  skipReason = '[full-ci] tag: running all steps';
} else if (docsOnly) {
  skipReason = 'docs/assets-only changes';
} else if (changedFiles.length === 0) {
  runCompile = true;
  runManifest = true;
  runPackage = true;
  skipReason = 'no changed files detected: running all steps';
} else {
  if (hasSource || hasWorkflow) runCompile = true;
  if (hasManifest || hasWorkflow) runManifest = true;
  if (hasSource || hasManifest || hasWorkflow) runPackage = true;

  const running = [];
  if (runCompile) running.push('compile');
  if (runManifest) running.push('manifest');
  if (runPackage) running.push('package');
  skipReason = running.length > 0
    ? `changed paths: ${running.join(', ')}`
    : 'no relevant changes';
}

// ── Tag overrides ────────────────────────────────────────
if (hasTag('[manifest]')) { runManifest = true; skipReason += ' [manifest]'; }
if (hasTag('[pack]'))     { runPackage = true;  skipReason += ' [pack]'; }
if (hasTag('[no-pack]'))  { runPackage = false; skipReason += ' [no-pack]'; }

// ── GITHUB_OUTPUT ────────────────────────────────────────
if (process.env.GITHUB_OUTPUT) {
  const output = [
    `run_compile=${runCompile}`,
    `run_manifest=${runManifest}`,
    `run_package=${runPackage}`,
    `skip_reason=${skipReason}`,
  ].join('\n') + '\n';
  fs.appendFileSync(process.env.GITHUB_OUTPUT, output, 'utf8');
}

// ── Summary ──────────────────────────────────────────────
console.log('::group::📋 Workflow Controller');
console.log(`  Event:    ${eventName}`);
console.log(`  Files:    ${changedFiles.length > 0 ? changedFiles.join(', ') : '(none)'}`);
console.log(`  Tags:     ${tags.length > 0 ? tags.join(', ') : '(none)'}`);
console.log(`  Compile:  ${runCompile}`);
console.log(`  Manifest: ${runManifest}`);
console.log(`  Package:  ${runPackage}`);
console.log(`  Reason:   ${skipReason}`);
console.log('::endgroup::');
