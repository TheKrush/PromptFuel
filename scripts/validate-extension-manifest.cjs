const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

let exitCode = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  exitCode = 1;
}

// Load package.json
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

// Identity checks
if (pkg.name !== 'prompt-fuel') fail(`name is "${pkg.name}", expected "prompt-fuel"`);
if (pkg.displayName !== 'PromptFuel') fail(`displayName is "${pkg.displayName}", expected "PromptFuel"`);
if (pkg.publisher !== 'thekrush') fail(`publisher is "${pkg.publisher}", expected "thekrush"`);
if (!pkg.description?.includes('live quota')) {
  fail(`description is "${pkg.description}", expected to include "live quota"`);
}
if (pkg.description?.includes('opt-in')) {
  fail(`description is "${pkg.description}", should not include "opt-in"`);
}
if (pkg.description?.includes('displayMode')) {
  fail(`description is "${pkg.description}", should not include "displayMode"`);
}
if (pkg.description?.toLowerCase().includes('api-equivalent')) {
  fail(`description is "${pkg.description}", should not mention unimplemented API-equivalent estimates`);
}
if (pkg.description?.toLowerCase().includes('api estimates')) {
  fail(`description is "${pkg.description}", should not mention unimplemented API estimates`);
}

// Command checks
const commands = pkg.contributes?.commands || [];
const expectedCommands = new Map([
  ['promptFuel.openDashboard', 'PromptFuel: Open Usage Dashboard'],
  ['promptFuel.refresh', 'PromptFuel: Refresh Now'],
  ['promptFuel.openDataFolder', 'PromptFuel: Open Data Folder'],
  ['promptFuel.openSnapshotImportsFolder', 'PromptFuel: Open Snapshot Imports Folder'],
]);
for (const cmd of commands) {
  if (!cmd.command.startsWith('promptFuel.')) {
    fail(`command "${cmd.command}" does not start with "promptFuel."`);
  }
  if (!cmd.title.startsWith('PromptFuel:')) {
    fail(`command title "${cmd.title}" does not start with "PromptFuel:"`);
  }
}
for (const [command, title] of expectedCommands) {
  const contributed = commands.find(cmd => cmd.command === command);
  if (!contributed) {
    fail(`required command "${command}" is not contributed`);
    continue;
  }
  if (contributed.title !== title) {
    fail(`command "${command}" title is "${contributed.title}", expected "${title}"`);
  }
}

const extensionSource = fs.readFileSync(path.join(REPO, 'src/extension.ts'), 'utf8');
for (const command of expectedCommands.keys()) {
  if (!extensionSource.includes(`registerCommand(\n    '${command}'`)) {
    fail(`required command "${command}" is not registered in src/extension.ts`);
  }
}

// Configuration setting key checks
const properties = pkg.contributes?.configuration?.properties || {};
const expectedSettings = [
  'promptFuel.enabledProviders',
  'promptFuel.liveQuotaEnabled',
  'promptFuel.refreshIntervalMinutes',
];
const actualSettings = Object.keys(properties).sort();
if (actualSettings.join(',') !== expectedSettings.join(',')) {
  fail(`contributed settings should be exactly ${JSON.stringify(expectedSettings)}, got ${JSON.stringify(actualSettings)}`);
}
for (const key of Object.keys(properties)) {
  if (!key.startsWith('promptFuel.')) {
    fail(`setting "${key}" does not start with "promptFuel."`);
  }
}
if (properties['promptFuel.liveQuotaEnabled']?.default !== true) {
  fail('setting "promptFuel.liveQuotaEnabled" default should be true');
}
if (Object.hasOwn(properties, 'promptFuel.displayMode')) {
  fail('setting "promptFuel.displayMode" should not be contributed');
}
if (properties['promptFuel.refreshIntervalMinutes']?.default !== 5) {
  fail('setting "promptFuel.refreshIntervalMinutes" default should be 5');
}
const defaultProviders = properties['promptFuel.enabledProviders']?.default;
if (!Array.isArray(defaultProviders) || defaultProviders.join(',') !== 'claude,codex') {
  fail('setting "promptFuel.enabledProviders" default should be ["claude","codex"]');
}

if (!Array.isArray(pkg.activationEvents) || pkg.activationEvents.join(',') !== 'onStartupFinished') {
  fail(`activationEvents should be ["onStartupFinished"], got ${JSON.stringify(pkg.activationEvents)}`);
}

// File existence checks
for (const file of ['README.md', 'LICENSE', 'src/extension.ts', 'CHANGELOG.md', 'SUPPORT.md']) {
  if (!fs.existsSync(path.join(REPO, file))) {
    fail(`required file "${file}" not found`);
  }
}

const vscodeIgnorePath = path.join(REPO, '.vscodeignore');
if (fs.existsSync(vscodeIgnorePath)) {
  const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
  for (const include of ['!out/snapshots/*.js', '!out/snapshots/*.js.map']) {
    if (!vscodeIgnore.includes(include)) {
      fail(`.vscodeignore is missing packaged include "${include}"`);
    }
  }
} else {
  fail('.vscodeignore not found');
}

// Icon existence check
if (pkg.icon) {
  const iconPath = path.join(REPO, pkg.icon);
  if (!fs.existsSync(iconPath)) {
    fail(`icon "${pkg.icon}" declared in package.json but file not found`);
  }
} else {
  fail('package.json is missing "icon" field');
}

// Marketplace metadata checks
if (!pkg.repository?.url) fail('package.json is missing "repository.url"');
if (!pkg.bugs?.url) fail('package.json is missing "bugs.url"');
if (!pkg.homepage) fail('package.json is missing "homepage"');
if (!pkg.galleryBanner?.color) fail('package.json is missing "galleryBanner.color"');
if (pkg.qna !== false) fail(`package.json "qna" should be false, got ${JSON.stringify(pkg.qna)}`);
if (pkg.pricing !== 'Free') fail(`package.json "pricing" should be "Free", got ${JSON.stringify(pkg.pricing)}`);

const requiredCategories = ['Machine Learning', 'Visualization', 'Other'];
for (const cat of requiredCategories) {
  if (!(pkg.categories || []).includes(cat)) {
    fail(`package.json "categories" is missing "${cat}"`);
  }
}

const requiredKeywords = ['ai', 'coding-assistant', 'quota', 'usage', 'status-bar', 'dashboard', 'claude', 'codex'];
for (const keyword of requiredKeywords) {
  if (!(pkg.keywords || []).includes(keyword)) {
    fail(`package.json "keywords" is missing "${keyword}"`);
  }
}

if (fs.existsSync(vscodeIgnorePath)) {
  const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
  for (const exclude of ['.git/**', '.vscode/**', '.vscode-test/**', '*.vsix', 'scripts/**', 'tools/**', 'src/**', 'DO_NOT_DELETE/**']) {
    if (!vscodeIgnore.includes(exclude)) {
      fail(`.vscodeignore is missing package exclusion "${exclude}"`);
    }
  }
}

if (exitCode === 0) {
  console.log('PASS: Extension manifest is valid.');
  console.log(`  name:        ${pkg.name}`);
  console.log(`  displayName: ${pkg.displayName}`);
  console.log(`  publisher:   ${pkg.publisher}`);
  console.log(`  icon:        ${pkg.icon}`);
  console.log(`  pricing:     ${pkg.pricing}`);
  console.log(`  qna:         ${pkg.qna}`);
  console.log(`  categories:  ${(pkg.categories || []).join(', ')}`);
  console.log(`  commands:    ${commands.length} registered`);
  console.log(`  settings:    ${Object.keys(properties).length} configured`);
}

process.exit(exitCode);
