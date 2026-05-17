#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
const ENV_PATH = resolve(ROOT, '.env');

function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return { raw: line, type: 'blank' };
  if (trimmed.startsWith('#')) return { raw: line, type: 'comment' };

  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) return { raw: line, type: 'comment' };

  const key = line.slice(0, eqIndex).trim();
  const value = line.slice(eqIndex + 1);
  return { raw: line, type: 'keyvalue', key, value };
}

function parseEnvFile(content) {
  return content.split(/\r?\n/).map(parseLine);
}

function extractKeyValues(lines) {
  const map = new Map();
  for (const line of lines) {
    if (line.type === 'keyvalue' && line.key !== undefined) {
      map.set(line.key, line.value ?? '');
    }
  }
  return map;
}

function run() {
  const args = process.argv.slice(2);
  const stripComments = args.includes('--no-comments');
  const dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node scripts/sync-env.js [options]

Syncs .env with .env.example — preserves your values, adds new keys,
warns about deprecated keys.

Options:
  --no-comments  Strip all comments from the output
  --dry-run      Print the result to stdout instead of writing .env
  -h, --help     Show this help message
`);
    process.exit(0);
  }

  if (!existsSync(ENV_EXAMPLE_PATH)) {
    console.error('Error: .env.example not found at', ENV_EXAMPLE_PATH);
    process.exit(1);
  }

  const exampleContent = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const exampleLines = parseEnvFile(exampleContent);
  const exampleKeys = extractKeyValues(exampleLines);

  const hasExistingEnv = existsSync(ENV_PATH);
  const existingValues = hasExistingEnv
    ? extractKeyValues(parseEnvFile(readFileSync(ENV_PATH, 'utf-8')))
    : new Map();

  const newKeys = [];
  const keptKeys = [];
  const deprecatedKeys = [];

  // Find keys in .env that are not in .env.example
  for (const key of existingValues.keys()) {
    if (!exampleKeys.has(key)) {
      deprecatedKeys.push(key);
    }
  }

  // Build output following .env.example structure
  const outputLines = [];

  for (const line of exampleLines) {
    if (line.type === 'blank') {
      outputLines.push('');
      continue;
    }

    if (line.type === 'comment') {
      if (!stripComments) {
        outputLines.push(line.raw);
      }
      continue;
    }

    if (line.type === 'keyvalue' && line.key !== undefined) {
      const key = line.key;
      if (existingValues.has(key)) {
        outputLines.push(`${key}=${existingValues.get(key)}`);
        keptKeys.push(key);
      } else {
        // New key — keep the example default
        if (!stripComments) {
          outputLines.push(`# NEW — added from .env.example:`);
        }
        outputLines.push(`${key}=${line.value ?? ''}`);
        newKeys.push(key);
      }
    }
  }

  // Remove trailing blank lines
  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === '') {
    outputLines.pop();
  }

  const output = outputLines.join('\n') + '\n';

  // Summary
  console.log('--- .env sync summary ---');
  if (!hasExistingEnv) {
    console.log('No existing .env found — created from .env.example template.');
  } else {
    console.log(`Kept:        ${keptKeys.length} key(s) with existing values`);
  }

  if (newKeys.length > 0) {
    console.log(`New:         ${newKeys.length} key(s) added from .env.example`);
    for (const key of newKeys) {
      console.log(`  + ${key}`);
    }
  } else {
    console.log('New:         none');
  }

  if (deprecatedKeys.length > 0) {
    console.log(`Deprecated:  ${deprecatedKeys.length} key(s) in .env but NOT in .env.example`);
    for (const key of deprecatedKeys) {
      console.log(`  ! ${key}`);
    }
  } else {
    console.log('Deprecated:  none');
  }

  if (dryRun) {
    console.log('\n--- dry run output (.env would be) ---');
    console.log(output);
  } else {
    writeFileSync(ENV_PATH, output, 'utf-8');
    console.log(`\nWrote ${ENV_PATH}`);
  }
}

run();
