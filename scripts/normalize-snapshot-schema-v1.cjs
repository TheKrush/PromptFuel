#!/usr/bin/env node
// Maintenance script — normalize PromptFuel snapshot schema version to V1.
// Scans *-latest.json snapshot files and monthly archive/*.json files at the
// given paths and rewrites any file whose schemaVersion field is not 1.
//
// Usage:
//   node scripts/normalize-snapshot-schema-v1.cjs [--dry-run] <path> [<path> ...]
//
// Each <path> is a snapshot root directory (the folder that contains
// *-latest.json files and optionally an archive/ subdirectory).
//
// Options:
//   --dry-run   Report what would be changed without writing any files.
//
// Behavior:
//   - Creates a .bak backup of each file before rewriting it.
//   - Updates only the schemaVersion field at the root of the JSON object.
//   - Idempotent: files already at schemaVersion 1 are skipped.
//   - Does not print raw snapshot JSON.
//   - Exits with code 0 even when some files fail (counts are reported).
//
// This is a temporary maintenance tool. Remove once all local snapshots are
// confirmed to be at schema version 1.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGET_SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = argv.slice(2);
  let dryRun = false;
  const paths = [];
  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      paths.push(arg);
    }
  }
  return { dryRun, paths };
}

function collectLatestFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('-latest.json')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function collectArchiveFiles(dir) {
  const results = [];
  const archiveRoot = path.join(dir, 'archive');
  let machineEntries;
  try {
    machineEntries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const machineEntry of machineEntries) {
    if (!machineEntry.isDirectory()) continue;
    const machineDir = path.join(archiveRoot, machineEntry.name);
    let fileEntries;
    try {
      fileEntries = fs.readdirSync(machineDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const fileEntry of fileEntries) {
      if (fileEntry.isFile() && /^\d{4}-\d{2}\.json$/.test(fileEntry.name)) {
        results.push(path.join(machineDir, fileEntry.name));
      }
    }
  }
  return results;
}

function processFile(filePath, dryRun, counts) {
  counts.scanned++;
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    counts.failed++;
    console.error(`  FAILED  (read error): ${path.basename(filePath)}`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    counts.failed++;
    console.error(`  FAILED  (invalid JSON): ${path.basename(filePath)}`);
    return;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    counts.skipped++;
    return;
  }

  if (parsed.schemaVersion === TARGET_SCHEMA_VERSION) {
    counts.skipped++;
    return;
  }

  if (dryRun) {
    counts.updated++;
    console.log(`  DRY-RUN would update schemaVersion ${parsed.schemaVersion} → ${TARGET_SCHEMA_VERSION}: ${path.basename(filePath)}`);
    return;
  }

  const bakPath = filePath + '.bak';
  try {
    fs.writeFileSync(bakPath, raw, 'utf-8');
  } catch {
    counts.failed++;
    console.error(`  FAILED  (backup write error): ${path.basename(filePath)}`);
    return;
  }

  parsed.schemaVersion = TARGET_SCHEMA_VERSION;
  let updated;
  try {
    updated = JSON.stringify(parsed, null, 2) + '\n';
  } catch {
    counts.failed++;
    console.error(`  FAILED  (serialization error): ${path.basename(filePath)}`);
    return;
  }

  try {
    fs.writeFileSync(filePath, updated, 'utf-8');
  } catch {
    counts.failed++;
    console.error(`  FAILED  (write error): ${path.basename(filePath)}`);
    return;
  }

  counts.updated++;
}

function main() {
  const { dryRun, paths } = parseArgs(process.argv);

  if (paths.length === 0) {
    console.error('Usage: node scripts/normalize-snapshot-schema-v1.cjs [--dry-run] <path> [<path> ...]');
    console.error('  <path>  Snapshot root directory containing *-latest.json files and/or archive/');
    process.exit(1);
  }

  if (dryRun) {
    console.log('Dry-run mode — no files will be modified.');
  }

  const counts = { scanned: 0, updated: 0, skipped: 0, failed: 0 };

  for (const dir of paths) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      console.log(`Skipping missing path: ${resolved}`);
      continue;
    }
    console.log(`Scanning: ${resolved}`);
    const latestFiles = collectLatestFiles(resolved);
    const archiveFiles = collectArchiveFiles(resolved);
    for (const filePath of [...latestFiles, ...archiveFiles]) {
      processFile(filePath, dryRun, counts);
    }
  }

  console.log('');
  console.log('Results:');
  console.log(`  Scanned : ${counts.scanned}`);
  console.log(`  Updated : ${counts.updated}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`  Skipped : ${counts.skipped}`);
  console.log(`  Failed  : ${counts.failed}`);

  if (counts.failed > 0) {
    process.exit(1);
  }
}

main();
