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

// Command checks
const commands = pkg.contributes?.commands || [];
for (const cmd of commands) {
  if (!cmd.command.startsWith('promptFuel.')) {
    fail(`command "${cmd.command}" does not start with "promptFuel."`);
  }
  if (!cmd.title.startsWith('PromptFuel:')) {
    fail(`command title "${cmd.title}" does not start with "PromptFuel:"`);
  }
}

// Configuration setting key checks
const properties = pkg.contributes?.configuration?.properties || {};
for (const key of Object.keys(properties)) {
  if (!key.startsWith('promptFuel.')) {
    fail(`setting "${key}" does not start with "promptFuel."`);
  }
}
if (properties['promptFuel.liveQuotaEnabled']?.default !== true) {
  fail('setting "promptFuel.liveQuotaEnabled" default should be true');
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
