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

// File existence checks
for (const file of ['README.md', 'LICENSE', 'src/extension.ts']) {
  if (!fs.existsSync(path.join(REPO, file))) {
    fail(`required file "${file}" not found`);
  }
}

if (exitCode === 0) {
  console.log('PASS: Extension manifest is valid.');
  console.log(`  name:        ${pkg.name}`);
  console.log(`  displayName: ${pkg.displayName}`);
  console.log(`  publisher:   ${pkg.publisher}`);
  console.log(`  commands:    ${commands.length} registered`);
  console.log(`  settings:    ${Object.keys(properties).length} configured`);
}

process.exit(exitCode);
