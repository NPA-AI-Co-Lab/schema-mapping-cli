#!/usr/bin/env node
/**
 * Keeps vendor/taxonomies/ (the offline fallback) identical to the taxonomies shipped by the
 * installed @npa-ai-co-lab/adc-schema package.
 *
 *   npm run vendor:sync    copy the package's taxonomies into vendor/taxonomies/
 *   npm run vendor:check   exit 1 if vendor/taxonomies/ differs from the package (used in tests/CI)
 *
 * Run vendor:sync after bumping the adc-schema dependency, and commit the result together with
 * package.json / package-lock.json.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = '@npa-ai-co-lab/adc-schema';
const VENDOR_DIR = join(ROOT, 'vendor', 'taxonomies');

const check = process.argv.includes('--check');

let packageDir;
try {
  packageDir = dirname(createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`));
} catch {
  console.error(`${PACKAGE} is not installed; run npm install first.`);
  process.exit(2);
}

const packageVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
const sourceDir = join(packageDir, 'taxonomies');
const sourceFiles = readdirSync(sourceDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const vendorFiles = existsSync(VENDOR_DIR)
  ? readdirSync(VENDOR_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];

const differences = [];
for (const file of sourceFiles) {
  const target = join(VENDOR_DIR, file);
  if (!existsSync(target)) differences.push(`missing in vendor: ${file}`);
  else if (!readFileSync(join(sourceDir, file)).equals(readFileSync(target)))
    differences.push(`differs: ${file}`);
}
for (const file of vendorFiles) {
  if (!sourceFiles.includes(file)) differences.push(`not in package (stale): ${file}`);
}

if (check) {
  if (differences.length === 0) {
    console.log(
      `vendor/taxonomies matches ${PACKAGE}@${packageVersion} (${sourceFiles.length} files)`
    );
    process.exit(0);
  }
  console.error(`vendor/taxonomies is out of sync with ${PACKAGE}@${packageVersion}:`);
  for (const d of differences) console.error(`  - ${d}`);
  console.error('Run: npm run vendor:sync');
  process.exit(1);
}

mkdirSync(VENDOR_DIR, { recursive: true });
for (const file of sourceFiles) {
  writeFileSync(join(VENDOR_DIR, file), readFileSync(join(sourceDir, file)));
}
console.log(
  `copied ${sourceFiles.length} taxonomy file(s) from ${PACKAGE}@${packageVersion} into vendor/taxonomies/`
);
if (differences.length > 0) {
  console.log('changes:');
  for (const d of differences) console.log(`  - ${d}`);
  const stale = vendorFiles.filter((f) => !sourceFiles.includes(f));
  if (stale.length)
    console.log(
      `note: stale file(s) were left in place, remove them manually: ${stale.join(', ')}`
    );
} else {
  console.log('no changes');
}
