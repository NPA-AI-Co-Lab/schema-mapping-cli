#!/usr/bin/env node
/**
 * Keeps vendor/taxonomies/ (the offline fallback of the taxonomy resolver) identical to the
 * taxonomies shipped by the installed @npa-ai-co-lab/adc-schema package.
 *
 *   npm run vendor:sync    copy the package's taxonomies into vendor/taxonomies/ and delete
 *                          stale vendored files that the package no longer ships
 *   npm run vendor:check   exit 1 if vendor/taxonomies/ differs from the package (CI, prepack)
 *
 * Run vendor:sync after bumping the adc-schema dependency, and commit the result together with
 * package.json / package-lock.json.
 */

import { createRequire } from 'node:module';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = '@npa-ai-co-lab/adc-schema';
const VENDOR_TAXONOMIES_DIR = join(ROOT, 'vendor', 'taxonomies');

const check = process.argv.includes('--check');

let packageDir;
try {
  packageDir = dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`));
} catch {
  console.error(`${PACKAGE} is not installed; run npm install first.`);
  process.exit(2);
}

const packageVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
const label = `${PACKAGE}@${packageVersion}`;

const sourceDir = join(packageDir, 'taxonomies');
if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  console.error(
    `${label} (at ${packageDir}) has no taxonomies/ directory; refusing to sync or check vendor/taxonomies against it.`
  );
  process.exit(2);
}
const sourceFiles = readdirSync(sourceDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (sourceFiles.length === 0) {
  console.error(`${label}: taxonomies/ contains no *.json files; refusing to sync or check.`);
  process.exit(2);
}
const vendorFiles = existsSync(VENDOR_TAXONOMIES_DIR)
  ? readdirSync(VENDOR_TAXONOMIES_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];

const differences = [];
for (const file of sourceFiles) {
  const target = join(VENDOR_TAXONOMIES_DIR, file);
  if (!existsSync(target)) differences.push(`missing in vendor: taxonomies/${file}`);
  else if (!readFileSync(join(sourceDir, file)).equals(readFileSync(target)))
    differences.push(`differs: taxonomies/${file}`);
}
const stale = vendorFiles.filter((f) => !sourceFiles.includes(f));
for (const file of stale) differences.push(`not in package (stale): taxonomies/${file}`);

if (check) {
  if (differences.length === 0) {
    console.log(`vendor/taxonomies matches ${label} (${sourceFiles.length} files)`);
    process.exit(0);
  }
  console.error(`vendor/taxonomies is out of sync with ${label}:`);
  for (const d of differences) console.error(`  - ${d}`);
  console.error('Run: npm run vendor:sync');
  process.exit(1);
}

mkdirSync(VENDOR_TAXONOMIES_DIR, { recursive: true });
for (const file of sourceFiles) {
  writeFileSync(join(VENDOR_TAXONOMIES_DIR, file), readFileSync(join(sourceDir, file)));
}
for (const file of stale) {
  unlinkSync(join(VENDOR_TAXONOMIES_DIR, file));
}
console.log(`copied ${sourceFiles.length} taxonomy file(s) from ${label} into vendor/taxonomies/`);
if (differences.length > 0) {
  console.log('changes:');
  for (const d of differences) console.log(`  - ${d}`);
  if (stale.length) console.log(`removed stale file(s): ${stale.join(', ')}`);
} else {
  console.log('no changes');
}
