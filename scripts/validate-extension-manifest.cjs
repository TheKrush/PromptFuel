const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
let exitCode = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  exitCode = 1;
}

if (pkg.name !== 'prompt-fuel') fail(`name is ${JSON.stringify(pkg.name)}`);
if (pkg.displayName !== 'PromptFuel') fail(`displayName is ${JSON.stringify(pkg.displayName)}`);
if (pkg.publisher !== 'thekrush') fail(`publisher is ${JSON.stringify(pkg.publisher)}`);
if (pkg.private === true) fail('package must not be private');
if (pkg.icon !== 'assets/icon.png') fail(`icon is ${JSON.stringify(pkg.icon)}`);
if (pkg.repository?.url !== 'https://github.com/TheKrush/PromptFuel.git') fail('repository.url is not PromptFuel');
if (pkg.bugs?.url !== 'https://github.com/TheKrush/PromptFuel/issues') fail('bugs.url is not PromptFuel');
if (pkg.homepage !== 'https://github.com/TheKrush/PromptFuel#readme') fail('homepage is not PromptFuel');

const commands = pkg.contributes?.commands ?? [];
const expectedCommands = new Set([
  'promptFuel.openDashboard',
  'promptFuel.refresh',
  'promptFuel.openDataFolder'
]);
for (const command of commands) {
  if (!command.command?.startsWith('promptFuel.')) fail(`command ${command.command} is not promptFuel namespaced`);
  if (!command.title?.startsWith('PromptFuel:')) fail(`command title ${command.title} is not PromptFuel branded`);
  if (/issue|draft|simulateReset|notification/i.test(command.command)) fail(`forbidden command ${command.command}`);
}
for (const command of expectedCommands) {
  if (!commands.some(entry => entry.command === command)) fail(`missing command ${command}`);
}

const activationEvents = pkg.activationEvents ?? [];
for (const event of [
  'onStartupFinished',
  'onCommand:promptFuel.openDashboard',
  'onCommand:promptFuel.refresh',
  'onCommand:promptFuel.openDataFolder'
]) {
  if (!activationEvents.includes(event)) fail(`missing activation event ${event}`);
}

const properties = pkg.contributes?.configuration?.properties ?? {};
const expectedSettings = [
  'promptFuel.sources',
  'promptFuel.refreshIntervalMinutes',
  'promptFuel.statusBarDensity',
  'promptFuel.snapshot.enabled',
  'promptFuel.snapshot.machineLabel',
  'promptFuel.snapshot.path'
];
const removedSettings = [
  'promptFuel.stateDirectory',
  'promptFuel.claudeProjectsPath',
  'promptFuel.codexSessionsPath',
  'promptFuel.refreshIntervalSeconds',
  'promptFuel.authenticatedQuota.enabled',
  'promptFuel.statusMode',
  ['promptFuel.snapshot.remote', 'La', 'nes'].join(''),
  ['promptFuel.snapshot.statusBar', 'La', 'nes'].join('')
];
for (const key of Object.keys(properties)) {
  if (!key.startsWith('promptFuel.')) fail(`setting ${key} is not promptFuel namespaced`);
  if (/issueInbox|notifications\.reset|developerMode/i.test(key)) fail(`forbidden setting ${key}`);
}
const settingKeys = Object.keys(properties).sort();
if (JSON.stringify(settingKeys) !== JSON.stringify([...expectedSettings].sort())) {
  fail(`public settings must be exactly ${expectedSettings.join(', ')}; got ${settingKeys.join(', ')}`);
}
for (const key of expectedSettings) {
  if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`missing setting ${key}`);
}
const densitySetting = properties['promptFuel.statusBarDensity'];
if (densitySetting?.type !== 'string') fail('promptFuel.statusBarDensity must be a string setting');
if (JSON.stringify(densitySetting?.enum ?? []) !== JSON.stringify(['standard', 'compact'])) {
  fail('promptFuel.statusBarDensity enum must be standard, compact');
}
if (densitySetting?.default !== 'standard') fail('promptFuel.statusBarDensity default must be standard');
for (const oldKey of removedSettings) {
  if (Object.prototype.hasOwnProperty.call(properties, oldKey)) fail(`removed public setting remains: ${oldKey}`);
}

const forbiddenPattern = /AgentBridge|agentBridge|agentbridge|AGENTBRIDGE|issueInbox|simulateReset|notifications\.reset/;
for (const relative of ['package.json', 'src', 'scripts']) {
  const root = path.join(repo, relative);
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (!/\.(ts|cjs|json)$/.test(file)) continue;
    if (path.relative(repo, file) === path.join('scripts', 'validate-extension-manifest.cjs')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (forbiddenPattern.test(text)) {
      fail(`forbidden copied reference token remains in ${path.relative(repo, file)}`);
    }
  }
}

for (const file of ['LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'SUPPORT.md', 'assets/icon.png']) {
  if (!fs.existsSync(path.join(repo, file))) fail(`required PromptFuel identity file missing: ${file}`);
}

if (exitCode === 0) {
  console.log('PASS: Extension manifest is valid.');
  console.log(`  name:        ${pkg.name}`);
  console.log(`  displayName: ${pkg.displayName}`);
  console.log(`  publisher:   ${pkg.publisher}`);
  console.log(`  commands:    ${commands.length}`);
  console.log(`  settings:    ${Object.keys(properties).length}`);
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
