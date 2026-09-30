import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

import {
  resolveTaxonomiesDir,
  configureTaxonomies,
  getTaxonomyResolution,
  resetTaxonomyResolution,
  describeTaxonomySource,
  getTaxonomy,
  handleTaxonomyEnum,
  TaxonomyResolutionError,
  ADC_SCHEMA_PACKAGE,
} from '../src/jsonld/taxonomy.js';
import { ConfigurationError } from '../src/utils/errors.js';
import { transformRow } from '../src/analysis/rules/row-transformer.js';
import type { LoadedRules } from '../src/analysis/rules/types.js';

/**
 * Taxonomy resolver: explicit path → installed adc-schema package → vendored fallback.
 *
 * Package and vendor locations are injected through resolver options so every
 * precedence case can be exercised without touching node_modules.
 */

function makeTaxonomyDir(
  entries: Array<{ notation: string; value: string }>,
  name = 'Gender-v1'
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'adc-tax-'));
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(entries));
  return dir;
}

function makeFakePackage(withTaxonomies: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), 'adc-pkg-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: ADC_SCHEMA_PACKAGE, version: '1.0.0' })
  );
  if (withTaxonomies) {
    mkdirSync(path.join(root, 'taxonomies'));
    writeFileSync(
      path.join(root, 'taxonomies', 'Gender-v1.json'),
      JSON.stringify([{ notation: 'GENDER_FROM_PACKAGE', value: 'from_package' }])
    );
  }
  return root;
}

const NO_PACKAGE = () => null;
const NO_VENDOR = path.join(tmpdir(), 'adc-vendor-does-not-exist-' + process.pid);

/** Whether the real adc-schema package is resolvable from this test file (as the CLI resolves it). */
function packageIsInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(`${ADC_SCHEMA_PACKAGE}/package.json`);
    return true;
  } catch {
    return false;
  }
}

describe('taxonomy resolver', () => {
  const tempDirs: string[] = [];
  const track = (dir: string) => {
    tempDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    resetTaxonomyResolution();
  });

  afterEach(() => {
    resetTaxonomyResolution();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  describe('precedence', () => {
    it('1. uses the explicit path when it is set, even if package and vendor exist', () => {
      const explicit = track(
        makeTaxonomyDir([{ notation: 'GENDER_EXPLICIT', value: 'from_explicit' }])
      );
      const pkg = track(makeFakePackage(true));
      const vendor = track(makeTaxonomyDir([{ notation: 'GENDER_VENDOR', value: 'from_vendor' }]));

      const resolution = resolveTaxonomiesDir(explicit, {
        locatePackageDir: () => pkg,
        vendorDir: vendor,
      });

      expect(resolution.source).toBe('explicit');
      expect(resolution.dir).toBe(path.resolve(explicit));
      expect(resolution.tried).toEqual([]);
    });

    it('2. falls back to the installed package when no explicit path is set', () => {
      const pkg = track(makeFakePackage(true));
      const vendor = track(makeTaxonomyDir([{ notation: 'GENDER_VENDOR', value: 'from_vendor' }]));

      const resolution = resolveTaxonomiesDir(undefined, {
        locatePackageDir: () => pkg,
        vendorDir: vendor,
      });

      expect(resolution.source).toBe('package');
      expect(resolution.dir).toBe(path.join(pkg, 'taxonomies'));
      expect(resolution.tried).toEqual([{ source: 'explicit', dir: null, reason: 'not set' }]);
    });

    it('3. falls back to the vendored copy when the package is not installed', () => {
      const vendor = track(makeTaxonomyDir([{ notation: 'GENDER_VENDOR', value: 'from_vendor' }]));

      const resolution = resolveTaxonomiesDir(undefined, {
        locatePackageDir: NO_PACKAGE,
        vendorDir: vendor,
      });

      expect(resolution.source).toBe('vendor');
      expect(resolution.dir).toBe(path.resolve(vendor));
      expect(resolution.tried.map((c) => c.source)).toEqual(['explicit', 'package']);
      expect(resolution.tried[1].reason).toMatch(/not installed/);
    });

    it('skips a package that is installed but ships no taxonomies/ directory', () => {
      const pkg = track(makeFakePackage(false));
      const vendor = track(makeTaxonomyDir([{ notation: 'GENDER_VENDOR', value: 'from_vendor' }]));

      const resolution = resolveTaxonomiesDir(undefined, {
        locatePackageDir: () => pkg,
        vendorDir: vendor,
      });

      expect(resolution.source).toBe('vendor');
      expect(resolution.tried[1]).toEqual({
        source: 'package',
        dir: path.join(pkg, 'taxonomies'),
        reason: expect.stringMatching(/no taxonomies\/ directory/),
      });
    });

    it('skips a package whose taxonomies/ directory is empty (no *.json files)', () => {
      const pkg = track(makeFakePackage(false));
      mkdirSync(path.join(pkg, 'taxonomies'));
      writeFileSync(path.join(pkg, 'taxonomies', 'README.md'), 'nothing here');
      const vendor = track(makeTaxonomyDir([{ notation: 'GENDER_VENDOR', value: 'from_vendor' }]));

      const resolution = resolveTaxonomiesDir(undefined, {
        locatePackageDir: () => pkg,
        vendorDir: vendor,
      });

      expect(resolution.source).toBe('vendor');
      expect(resolution.tried[1]).toEqual({
        source: 'package',
        dir: path.join(pkg, 'taxonomies'),
        reason: expect.stringMatching(/directory is empty/),
      });
    });

    it('skips an empty vendor directory and reports it in the error', () => {
      const emptyVendor = track(mkdtempSync(path.join(tmpdir(), 'adc-empty-vendor-')));

      let caught: unknown;
      try {
        resolveTaxonomiesDir(undefined, { locatePackageDir: NO_PACKAGE, vendorDir: emptyVendor });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaxonomyResolutionError);
      const error = caught as TaxonomyResolutionError;
      expect(error.tried[2]).toEqual({
        source: 'vendor',
        dir: path.resolve(emptyVendor),
        reason: expect.stringMatching(/directory is empty/),
      });
      expect(error.message).toMatch(/3\. vendored fallback .*directory is empty/);
    });

    it('treats an empty explicit path as "not set"', () => {
      const vendor = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      const resolution = resolveTaxonomiesDir('   ', {
        locatePackageDir: NO_PACKAGE,
        vendorDir: vendor,
      });
      expect(resolution.source).toBe('vendor');
    });
  });

  describe('errors', () => {
    it('an explicit path that does not exist is a hard error and is never replaced by a fallback', () => {
      const vendor = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      const missing = path.join(tmpdir(), 'adc-missing-' + process.pid);

      let caught: unknown;
      try {
        resolveTaxonomiesDir(missing, { locatePackageDir: NO_PACKAGE, vendorDir: vendor });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaxonomyResolutionError);
      const error = caught as TaxonomyResolutionError;
      expect(error.name).toBe('TaxonomyResolutionError');
      expect(error.message).toContain(missing);
      expect(error.message).toMatch(/does not exist/);
      expect(error.message).toMatch(/taxonomiesPath|--taxonomies/);
      expect(error.tried).toEqual([
        { source: 'explicit', dir: path.resolve(missing), reason: 'does not exist' },
      ]);
    });

    it('an explicit path that is an empty directory is a hard error, never replaced by a fallback', () => {
      const vendor = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      const empty = track(mkdtempSync(path.join(tmpdir(), 'adc-empty-explicit-')));

      let caught: unknown;
      try {
        resolveTaxonomiesDir(empty, { locatePackageDir: NO_PACKAGE, vendorDir: vendor });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaxonomyResolutionError);
      const error = caught as TaxonomyResolutionError;
      expect(error.message).toContain(path.resolve(empty));
      expect(error.message).toMatch(/directory is empty/);
      expect(error.message).toMatch(/taxonomiesPath|--taxonomies/);
      expect(error.tried).toEqual([
        {
          source: 'explicit',
          dir: path.resolve(empty),
          reason: expect.stringMatching(/directory is empty/),
        },
      ]);
    });

    it('an explicit path that is a file, not a directory, is rejected', () => {
      const dir = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      const file = path.join(dir, 'Gender-v1.json');

      expect(() =>
        resolveTaxonomiesDir(file, { locatePackageDir: NO_PACKAGE, vendorDir: NO_VENDOR })
      ).toThrow(/is not a directory/);
    });

    it('when nothing resolves, the error lists every location that was tried, in order', () => {
      const pkg = track(makeFakePackage(false));

      let caught: unknown;
      try {
        resolveTaxonomiesDir(undefined, { locatePackageDir: () => pkg, vendorDir: NO_VENDOR });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaxonomyResolutionError);
      const error = caught as TaxonomyResolutionError;

      expect(error.tried.map((c) => c.source)).toEqual(['explicit', 'package', 'vendor']);

      const message = error.message;
      expect(message).toMatch(/Could not locate the ADC taxonomies/);
      expect(message).toMatch(/1\. explicit path .*not set/);
      expect(message).toMatch(
        new RegExp(
          `2\\. installed package ${ADC_SCHEMA_PACKAGE.replace('/', '\\/')}.*no taxonomies\\/ directory`
        )
      );
      expect(message).toContain(path.join(pkg, 'taxonomies'));
      expect(message).toMatch(/3\. vendored fallback .*does not exist/);
      expect(message).toContain(path.resolve(NO_VENDOR));
      expect(message).toMatch(/taxonomiesPath|--taxonomies/);
    });

    it('reports "not installed" for the package when it cannot be located at all', () => {
      expect(() =>
        resolveTaxonomiesDir(undefined, { locatePackageDir: NO_PACKAGE, vendorDir: NO_VENDOR })
      ).toThrow(/2\. installed package .*not installed/);
    });
  });

  describe('module state and loading', () => {
    it('configureTaxonomies() makes getTaxonomy() read from the chosen directory and reports the source', () => {
      const explicit = track(
        makeTaxonomyDir([{ notation: 'GENDER_EXPLICIT', value: 'from_explicit' }])
      );

      const resolution = configureTaxonomies(explicit);

      expect(getTaxonomyResolution()).toBe(resolution);
      expect(describeTaxonomySource()).toBe(`explicit (${path.resolve(explicit)})`);
      expect(getTaxonomy('Gender-v1')).toEqual([
        { notation: 'GENDER_EXPLICIT', value: 'from_explicit' },
      ]);
    });

    it('re-configuring clears the taxonomy cache', () => {
      const first = track(makeTaxonomyDir([{ notation: 'A', value: 'first' }]));
      const second = track(makeTaxonomyDir([{ notation: 'B', value: 'second' }]));

      configureTaxonomies(first);
      expect(getTaxonomy('Gender-v1')[0].value).toBe('first');

      configureTaxonomies(second);
      expect(getTaxonomy('Gender-v1')[0].value).toBe('second');
    });

    it('a taxonomy that is missing inside a resolved directory yields [] and warns ONCE per name, not per lookup', () => {
      const explicit = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      configureTaxonomies(explicit);

      // 17 lookups (one per row of a 16-row file plus the schema conversion) → one warning
      for (let i = 0; i < 17; i++) {
        expect(getTaxonomy('DoesNotExist-v1')).toEqual([]);
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/DoesNotExist-v1\.json/);
      expect(warn.mock.calls[0][0]).toMatch(/source: explicit/);

      // a second missing name warns once more; re-configuring resets the negative cache
      expect(getTaxonomy('AlsoMissing-v1')).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
      configureTaxonomies(explicit);
      expect(getTaxonomy('DoesNotExist-v1')).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('a taxonomy file that is not an array of { notation, value } objects is a ConfigurationError', () => {
      const dir = track(mkdtempSync(path.join(tmpdir(), 'adc-bad-tax-')));
      writeFileSync(
        path.join(dir, 'NotArray-v1.json'),
        JSON.stringify({ notation: 'A', value: 'a' })
      );
      writeFileSync(
        path.join(dir, 'BadEntry-v1.json'),
        JSON.stringify([{ notation: 'A', value: 'a' }, { notation: 'B' }])
      );
      writeFileSync(path.join(dir, 'NotJson-v1.json'), '{ this is not json');
      configureTaxonomies(dir);

      expect(() => getTaxonomy('NotArray-v1')).toThrow(ConfigurationError);
      expect(() => getTaxonomy('NotArray-v1')).toThrow(/must contain a JSON array/);
      expect(() => getTaxonomy('BadEntry-v1')).toThrow(ConfigurationError);
      expect(() => getTaxonomy('BadEntry-v1')).toThrow(/entry 1 is not a/);
      expect(() => getTaxonomy('NotJson-v1')).toThrow(/not valid JSON/);
    });

    it.skipIf(!packageIsInstalled())(
      'with no configuration and the package installed, the default precedence picks the package',
      () => {
        // No options: real package lookup, as the CLI does it.
        const resolution = getTaxonomyResolution();

        expect(resolution.source).toBe('package');
        expect(resolution.dir).toBe(
          path.join(
            path.dirname(
              createRequire(import.meta.url).resolve(`${ADC_SCHEMA_PACKAGE}/package.json`)
            ),
            'taxonomies'
          )
        );
        expect(getTaxonomy('Gender-v1')).toHaveLength(4);
        expect(getTaxonomy('ActionType-v1').map((t) => t.value)).toContain('web_read');
      }
    );

    it('when the package cannot be located, the default vendor directory of the repository is used', () => {
      const resolution = configureTaxonomies(undefined, { locatePackageDir: () => null });

      expect(resolution.source).toBe('vendor');
      expect(resolution.dir).toBe(path.resolve(process.cwd(), 'vendor', 'taxonomies'));
      expect(resolution.tried.map((c) => c.source)).toEqual(['explicit', 'package']);
      expect(getTaxonomy('Gender-v1')).toHaveLength(4);
      expect(getTaxonomy('ActionType-v1').map((t) => t.value)).toContain('web_read');
    });
  });

  describe('handleTaxonomyEnum (schema enumFromTaxonomy)', () => {
    it('returns the taxonomy values for a property whose taxonomy exists', () => {
      const dir = track(makeTaxonomyDir([{ notation: 'GENDER_MALE', value: 'male' }]));
      configureTaxonomies(dir);

      expect(
        handleTaxonomyEnum({ type: 'string', enumFromTaxonomy: 'Gender-v1' }, 'person.gender')
      ).toEqual(['male']);
      expect(handleTaxonomyEnum({ type: 'string' })).toBeUndefined();
    });

    it('throws a ConfigurationError (never returns enum: []) when the taxonomy file is missing', () => {
      const dir = track(makeTaxonomyDir([{ notation: 'X', value: 'x' }]));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      configureTaxonomies(dir);

      let caught: unknown;
      try {
        handleTaxonomyEnum(
          { type: 'string', enumFromTaxonomy: 'Tier-v1' },
          'person.demographics.tier'
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      const message = (caught as Error).message;
      expect(message).toContain('person.demographics.tier');
      expect(message).toContain('Tier-v1');
      expect(message).toContain(path.join(path.resolve(dir), 'Tier-v1.json'));
      expect(message).toMatch(/does not exist/);
      expect(message).toContain(`Taxonomies source: explicit (${path.resolve(dir)})`);
    });

    it('throws a ConfigurationError when the taxonomy file exists but is empty', () => {
      const dir = track(makeTaxonomyDir([], 'Empty-v1'));
      configureTaxonomies(dir);

      expect(() =>
        handleTaxonomyEnum({ type: 'string', enumFromTaxonomy: 'Empty-v1' }, 'object.kind')
      ).toThrow(/"object\.kind".*Empty-v1.*contains no entries/);
    });
  });

  describe('rules path (deterministic mapping) uses the same resolver', () => {
    it('normalises rule values against the taxonomy from the configured directory', () => {
      const explicit = track(
        makeTaxonomyDir([
          { notation: 'GENDER_CUSTOM', value: 'custom_value' },
          { notation: 'GENDER_OTHER', value: 'other' },
        ])
      );
      configureTaxonomies(explicit);

      const rules: LoadedRules = {
        rulesPath: 'in-memory.rules.json',
        schemaPath: 'in-memory.schema.jsonld',
        llmFields: new Set(),
        fieldRules: new Map([
          [
            'person.demographics.gender',
            { source: 'gender', transforms: [], taxonomy: 'Gender-v1', when: [] },
          ],
        ]),
        schemaFields: [],
        requiredFields: new Set(),
        schema: { '@context': {}, entities: {} },
      };

      // notation in the input column → canonical value from the *configured* taxonomy
      const byNotation = transformRow({ gender: 'gender_custom' }, rules);
      expect(byNotation.mapped).toEqual({ person: { demographics: { gender: 'custom_value' } } });

      // a value that the configured taxonomy does not know passes through unchanged
      const unknown = transformRow({ gender: 'male' }, rules);
      expect(unknown.mapped).toEqual({ person: { demographics: { gender: 'male' } } });
    });

    it('switching the taxonomy directory changes what the rules path produces', () => {
      const rules: LoadedRules = {
        rulesPath: 'r',
        schemaPath: 's',
        llmFields: new Set(),
        fieldRules: new Map([
          ['object.type', { source: 'kind', transforms: [], taxonomy: 'ObjectType-v1', when: [] }],
        ]),
        schemaFields: [],
        requiredFields: new Set(),
        schema: { '@context': {}, entities: {} },
      };

      const first = track(
        makeTaxonomyDir([{ notation: 'TYPE_ARTICLE', value: 'article' }], 'ObjectType-v1')
      );
      configureTaxonomies(first);
      expect(transformRow({ kind: 'TYPE_ARTICLE' }, rules).mapped).toEqual({
        object: { type: 'article' },
      });

      const second = track(
        makeTaxonomyDir([{ notation: 'TYPE_ARTICLE', value: 'story' }], 'ObjectType-v1')
      );
      configureTaxonomies(second);
      expect(transformRow({ kind: 'TYPE_ARTICLE' }, rules).mapped).toEqual({
        object: { type: 'story' },
      });
    });
  });
});
