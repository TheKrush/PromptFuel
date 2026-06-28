#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

assert.equal(pkg.name, 'prompt-fuel', 'package name stays PromptFuel package identity');
assert.equal(pkg.displayName, 'PromptFuel', 'displayName stays PromptFuel');
assert.equal(pkg.publisher, 'thekrush', 'publisher stays marketplace identity');
assert.notEqual(pkg.private, true, 'package is publishable');
assert.equal(pkg.repository?.url, 'https://github.com/TheKrush/PromptFuel.git', 'repository points at PromptFuel');
assert.equal(pkg.bugs?.url, 'https://github.com/TheKrush/PromptFuel/issues', 'bugs URL points at PromptFuel');

const commands = pkg.contributes?.commands ?? [];
const commandIds = commands.map(command => command.command);
const forbiddenCommandPattern = new RegExp(['issue', 'draft', ['simulate', 'Reset'].join(''), 'notification'].join('|'), 'i');
assert.deepEqual(commandIds.sort(), [
  'promptFuel.openDashboard',
  'promptFuel.openDataFolder',
  'promptFuel.refresh',
  'promptFuel.upgradeSnapshotFiles'
], 'expected PromptFuel commands are contributed');
for (const command of commands) {
  assert.ok(command.command.startsWith('promptFuel.'), `command is promptFuel namespaced: ${command.command}`);
  assert.ok(command.title.startsWith('PromptFuel:'), `command title is PromptFuel branded: ${command.title}`);
  assert.doesNotMatch(command.command, forbiddenCommandPattern, `forbidden command absent: ${command.command}`);
}

const activationEvents = pkg.activationEvents ?? [];
for (const event of [
  'onStartupFinished',
  'onCommand:promptFuel.openDashboard',
  'onCommand:promptFuel.refresh',
  'onCommand:promptFuel.openDataFolder'
]) {
  assert.ok(activationEvents.includes(event), `activation event exists: ${event}`);
}

const settings = pkg.contributes?.configuration?.properties ?? {};
const settingKeys = Object.keys(settings);
const expectedSettingKeys = [
  'promptFuel.sources',
  'promptFuel.refreshIntervalMinutes',
  'promptFuel.statusBarDensity',
  'promptFuel.snapshot.enabled',
  'promptFuel.snapshot.machineLabel',
  'promptFuel.snapshot.path',
  'promptFuel.weekStartsOn'
];
const removedSettingKeys = [
  'promptFuel.stateDirectory',
  'promptFuel.claudeProjectsPath',
  'promptFuel.codexSessionsPath',
  'promptFuel.refreshIntervalSeconds',
  'promptFuel.authenticatedQuota.enabled',
  'promptFuel.statusMode',
  ['promptFuel.snapshot.remote', 'La', 'nes'].join(''),
  ['promptFuel.snapshot.statusBar', 'La', 'nes'].join('')
];
const forbiddenSettingPattern = new RegExp([
  ['issue', 'Inbox'].join(''),
  ['notifications', 'reset'].join('\\.'),
  ['developer', 'Mode'].join('')
].join('|'), 'i');
assert.ok(settingKeys.length > 0, 'settings are contributed');
for (const key of settingKeys) {
  assert.ok(key.startsWith('promptFuel.'), `setting is promptFuel namespaced: ${key}`);
  assert.doesNotMatch(key, forbiddenSettingPattern, `forbidden setting absent: ${key}`);
}

assert.deepEqual(settingKeys.sort(), [...expectedSettingKeys].sort(), 'public settings surface is exactly the 1.0.0 model');
for (const key of expectedSettingKeys) {
  assert.ok(settingKeys.includes(key), `public setting exists: ${key}`);
}
assert.equal(settings['promptFuel.statusBarDensity']?.type, 'string', 'statusBarDensity is a string setting');
assert.deepEqual(settings['promptFuel.statusBarDensity']?.enum, ['standard', 'compact'], 'statusBarDensity supports standard and compact');
assert.equal(settings['promptFuel.statusBarDensity']?.default, 'standard', 'statusBarDensity defaults to standard');
assert.equal(settings['promptFuel.weekStartsOn']?.type, 'string', 'weekStartsOn is a string setting');
assert.deepEqual(settings['promptFuel.weekStartsOn']?.enum, ['sunday', 'monday', 'saturday'], 'weekStartsOn supports sunday, monday, saturday');
assert.equal(settings['promptFuel.weekStartsOn']?.default, 'sunday', 'weekStartsOn defaults to sunday');
assert.match(String(settings['promptFuel.weekStartsOn']?.description || ''), /display order only/i, 'weekStartsOn description stays display-order only');
for (const key of removedSettingKeys) {
  assert.equal(settingKeys.includes(key), false, `removed public setting is absent: ${key}`);
}

const vscodeIgnore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8').split(/\r?\n/);
for (const excluded of ['.github/**', '*.vsix', '*.log', 'DO_NOT_DELETE/**', 'vsix-inspect/**', 'src/**', 'tools/**']) {
  assert.ok(vscodeIgnore.includes(excluded), `.vscodeignore excludes ${excluded}`);
}
for (const included of ['!package.json', '!CHANGELOG.md', '!SUPPORT.md', '!assets/icon.png', '!data/model-pricing-estimates.csv', '!out/display/*.js', '!out/panel/*.js', '!out/panel/dashboard/*.js', '!out/panel/dashboard/*.js.map', '!out/providers/*.js', '!out/quota/*.js', '!out/snapshot/*.js', '!media/**']) {
  assert.ok(vscodeIgnore.includes(included), `.vscodeignore includes ${included}`);
}

assert.ok(fs.existsSync(path.join(repoRoot, 'data', 'model-pricing-estimates.csv')), 'model pricing CSV exists for packaging');

const forbiddenBrandTokens = [
  ['Agent', 'Bridge'].join(''),
  ['agent', 'Bridge'].join(''),
  ['agent', 'bridge'].join(''),
  ['AGENT', 'BRIDGE'].join('_'),
  'thekrush-local'
];

for (const relative of [
  'package.json',
  path.join('src', 'display'),
  path.join('src', 'panel'),
  path.join('src', 'providers'),
  path.join('src', 'quota'),
  path.join('src', 'snapshot'),
  'src'
]) {
  const full = path.join(repoRoot, relative);
  if (!fs.existsSync(full)) {
    continue;
  }
  for (const file of walk(full)) {
    if (!/\.(ts|json)$/.test(file)) {
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const token of forbiddenBrandTokens) {
      assert.equal(text.includes(token), false, `${path.relative(repoRoot, file)} has no copied reference branding`);
    }
  }
}

const viewSource = fs.readFileSync(path.join(repoRoot, 'src', 'panel', 'promptFuelPanelView.ts'), 'utf8');
assert.ok(
  /script-src 'nonce-\${nonce}'/.test(viewSource),
  'CSP uses nonce-based script-src'
);
assert.ok(
  /style-src 'unsafe-inline'/.test(viewSource),
  'CSP uses unsafe-inline for style-src (inline style attributes in dynamic HTML)'
);
assert.equal(
  /script-src 'unsafe-inline'/.test(viewSource),
  false,
  'CSP script-src does not use unsafe-inline'
);
assert.ok(
  /link rel="stylesheet"/.test(viewSource),
  'webview head uses <link> for external CSS asset'
);
assert.ok(
  /script nonce="\$\{nonce\}"/.test(viewSource),
  'script tag carries nonce attribute'
);
assert.ok(
  /src="\$\{scriptUri\}"/.test(viewSource),
  'script tag loads external asset via scriptUri'
);

const { buildPromptFuelPanelHtml } = require(path.join(repoRoot, 'out', 'panel', 'promptFuelPanelView.js'));
const panelHtml = buildPromptFuelPanelHtml('media/promptFuelPanel.css', 'media/promptFuelPanel.js', 'https://file+.vscode-resource.vscode-cdn.net');
const cspNonce = panelHtml.match(/script-src 'nonce-([A-Za-z0-9_-]+)'/);
const scriptNonce = panelHtml.match(/<script nonce="([A-Za-z0-9_-]+)"[^>]*>/);
assert.ok(cspNonce, 'generated HTML has nonce-based script-src');
assert.ok(panelHtml.includes('<link rel="stylesheet" href="media/promptFuelPanel.css">'), 'generated HTML links external CSS asset');
assert.ok(panelHtml.includes('src="media/promptFuelPanel.js"'), 'generated HTML script tag references promptFuelPanel.js');
assert.ok(scriptNonce, 'generated HTML script tag carries nonce');
assert.equal(scriptNonce[1], cspNonce[1], 'generated script nonce matches CSP nonce');
assert.equal(
  /script-src 'unsafe-inline'/.test(panelHtml),
  false,
  'generated HTML script-src does not use unsafe-inline'
);

console.log('PASS: extension surface smoke passed');

function* walk(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    yield root;
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === '.git') {
      continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}
