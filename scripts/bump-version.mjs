#!/usr/bin/env node

/**
 * Auto-bump patch version across all workspace packages.
 * Called from .husky/pre-commit — bumps root version, syncs to all packages,
 * and stages the changed package.json files.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PACKAGE_PATHS = [
  'package.json',
  'packages/shared/package.json',
  'packages/engine/package.json',
  'packages/api/package.json',
  'packages/web/package.json',
  'packages/landing/package.json',
];

// Read root version and bump patch
const rootPkgPath = resolve(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const [major, minor, patch] = rootPkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

// Update all package.json files
const updated = [];
for (const rel of PACKAGE_PATHS) {
  const abs = resolve(root, rel);
  const pkg = JSON.parse(readFileSync(abs, 'utf-8'));
  if (pkg.version !== newVersion) {
    pkg.version = newVersion;
    // Preserve original indentation (detect tabs vs spaces)
    const raw = readFileSync(abs, 'utf-8');
    const indent = raw.startsWith('{\n\t') ? '\t' : 2;
    writeFileSync(abs, JSON.stringify(pkg, null, indent) + '\n');
    updated.push(rel);
  }
}

// Stage the changed files so they're included in the commit
if (updated.length > 0) {
  const files = updated.map((f) => resolve(root, f));
  execFileSync('git', ['add', ...files], { cwd: root });
  console.log(`v${newVersion} — bumped ${updated.length} package(s)`);
}
