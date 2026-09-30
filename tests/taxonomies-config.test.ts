import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { Command } from 'commander';

import {
  normalizeConfig,
  validateConfig,
  createConfigHash,
} from '../src/utils/config-normalizer.js';
import { validateConfigPaths } from '../src/utils/config-path-validator.js';
import { validateDirectoryPath } from '../src/utils/validation.js';
import { setupCliProgram } from '../src/cli/cli-setup.js';
import { analyzeDataWithDb } from '../src/analysis/pipeline-db.js';
import {
  resetTaxonomyResolution,
  ADC_SCHEMA_PACKAGE,
  TaxonomyResolutionError,
} from '../src/jsonld/taxonomy.js';
import { ConfigurationError } from '../src/utils/errors.js';
import type { AppConfig } from '../src/utils/types.js';
import type {
  ILLMClient,
  LLMAnalysisRequest,
  LLMAnalysisResponse,
} from '../src/interfaces/llm-client.interface.js';

/**
 * The `taxonomiesPath` config key and the `--taxonomies <dir>` flag: validation, config hash,
 * CLI registration, and an end-to-end rules-only run that proves the pipeline resolves
 * taxonomies from the configured directory and reports the source in the run summary and
 * in the output provenance entry.
 */

const REPO_ROOT = process.cwd();

function minimalConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dataPaths: [path.join(REPO_ROOT, 'examples', 'sample_comments.csv')],
    schemaPath: path.join(REPO_ROOT, 'config.json'), // any existing JSON file satisfies validateConfig
    outputPath: path.join(REPO_ROOT, 'output', 'unit-test.jsonld'),
    enableLogging: false,
    hidePII: false,
    retriesNumber: 0,
    requiredFieldErrorsFailBatch: false,
    batchSize: 1,
    concurrencySize: 1,
    defaultModel: 'gpt-4.1-mini',
    fallbackModel: 'gpt-4.1-mini',
    ...overrides,
  };
}

describe('taxonomiesPath config key', () => {
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'adc-cfg-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('validateDirectoryPath accepts a directory and rejects a file or a missing path', () => {
    const dir = tempDir();
    const file = path.join(dir, 'x.json');
    writeFileSync(file, '[]');

    expect(validateDirectoryPath(dir)).toBe(true);
    expect(validateDirectoryPath(file)).toMatch(/must point to a directory/);
    expect(validateDirectoryPath(path.join(dir, 'nope'))).toMatch(/does not exist/);
  });

  it('validateConfig passes without taxonomiesPath and with an existing directory', () => {
    expect(() => validateConfig(normalizeConfig(minimalConfig()))).not.toThrow();
    expect(() =>
      validateConfig(normalizeConfig(minimalConfig({ taxonomiesPath: tempDir() })))
    ).not.toThrow();
  });

  it('validateConfig leaves taxonomiesPath to the resolver (whose error names the options and the package)', () => {
    // A bad taxonomiesPath is reported by configureTaxonomies (run before validateConfig in the
    // pipeline) with a message naming --taxonomies / taxonomiesPath and the package — not by a
    // generic "directory not found" line here.
    const dir = tempDir();
    expect(() =>
      validateConfig(normalizeConfig(minimalConfig({ taxonomiesPath: path.join(dir, 'missing') })))
    ).not.toThrow();
  });

  it('validateConfigPaths reports a bad taxonomies directory alongside the other path errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = minimalConfig();
    const dir = tempDir();

    expect(validateConfigPaths(cfg.dataPaths!, cfg.schemaPath, cfg.outputPath, dir)).toBe(true);
    expect(
      validateConfigPaths(cfg.dataPaths!, cfg.schemaPath, cfg.outputPath, path.join(dir, 'nope'))
    ).toBe(false);
    expect(errorSpy.mock.calls.flat().join('\n')).toMatch(
      /Taxonomies directory \(taxonomiesPath\) error/
    );
    errorSpy.mockRestore();
  });

  it('config hash is unchanged for configs without taxonomiesPath and changes when it is set', () => {
    const base = normalizeConfig(minimalConfig());
    const withUndefined = normalizeConfig(minimalConfig({ taxonomiesPath: undefined }));
    const withPath = normalizeConfig(minimalConfig({ taxonomiesPath: tempDir() }));

    expect(createConfigHash(withUndefined)).toBe(createConfigHash(base));
    expect(createConfigHash(withPath)).not.toBe(createConfigHash(base));
  });
});

describe('--taxonomies CLI flag', () => {
  it('is registered on the analyze command and parses into options.taxonomies', () => {
    const program = new Command();
    program.exitOverride();
    setupCliProgram(program, { name: 'npa-insight', version: '0.0.0-test' });

    const analyze = program.commands.find((c) => c.name() === 'analyze');
    expect(analyze).toBeDefined();

    const option = analyze!.options.find((o) => o.long === '--taxonomies');
    expect(option).toBeDefined();
    expect(option!.flags).toBe('--taxonomies <dir>');
    expect(option!.description).toMatch(new RegExp(ADC_SCHEMA_PACKAGE.replace('/', '\\/')));

    // Parse without running the action: replace it with a capture.
    let captured: Record<string, unknown> | undefined;
    // commander keeps the last registered action; override it for this test
    (analyze as unknown as { _actionHandler: unknown })._actionHandler = undefined;
    analyze!.action((opts: Record<string, unknown>) => {
      captured = opts;
    });
    program.parse(['analyze', '-i', 'in.csv', '-s', 's.jsonld', '--taxonomies', './my-tax'], {
      from: 'user',
    });

    expect(captured?.taxonomies).toBe('./my-tax');
  });
});

describe('end-to-end: rules-only run with an explicit taxonomies directory', () => {
  let dir: string;

  const SCHEMA = {
    '@context': { '@vocab': 'https://schema.org/', userID: 'identifier' },
    entities: {
      person: {
        '@type': 'Person',
        idProp: 'userID',
        properties: {
          userID: { type: 'string', description: 'Global user ID', required: true },
          tier: { type: 'string', enumFromTaxonomy: 'Tier-v1', description: 'Membership tier' },
        },
      },
    },
  };

  /** A client that must never be called: the run is fully deterministic. */
  class NeverCalledClient implements ILLMClient {
    async analyze(_request: LLMAnalysisRequest): Promise<LLMAnalysisResponse> {
      throw new Error('LLM must not be called in a rules-only run');
    }
    getDefaultModel() {
      return 'gpt-4.1';
    }
    getFallbackModel() {
      return 'gpt-4.1';
    }
    isConfigured() {
      return true;
    }
  }

  /** Same schema without the taxonomy-backed property (nothing to resolve from the taxonomies). */
  const SCHEMA_NO_TAXONOMY = {
    ...SCHEMA,
    entities: {
      person: {
        ...SCHEMA.entities.person,
        properties: {
          userID: SCHEMA.entities.person.properties.userID,
          tier: { type: 'string', description: 'Membership tier' },
        },
      },
    },
  };

  beforeEach(async () => {
    resetTaxonomyResolution();
    dir = mkdtempSync(path.join(tmpdir(), 'adc-e2e-'));
    writeFileSync(path.join(dir, 'data.csv'), 'userID,tier\nu1,TIER_GOLD\nu2,silver\n');
    writeFileSync(path.join(dir, 'schema.jsonld'), JSON.stringify(SCHEMA));
    writeFileSync(path.join(dir, 'schema-no-taxonomy.jsonld'), JSON.stringify(SCHEMA_NO_TAXONOMY));
    writeFileSync(
      path.join(dir, 'rules.json'),
      JSON.stringify({
        schema: 'schema.jsonld',
        llm: { default: false },
        fields: {
          'person.userID': { source: 'userID', transforms: ['trim'] },
          'person.tier': { source: 'tier', transforms: ['trim'], taxonomy: 'Tier-v1' },
        },
      })
    );
    // A taxonomy that exists ONLY in the explicit directory, not in the package or vendor copy.
    await fs.mkdir(path.join(dir, 'taxonomies'));
    writeFileSync(
      path.join(dir, 'taxonomies', 'Tier-v1.json'),
      JSON.stringify([
        { notation: 'TIER_GOLD', value: 'gold' },
        { notation: 'TIER_SILVER', value: 'silver' },
      ])
    );
  });

  afterEach(() => {
    resetTaxonomyResolution();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function config(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      dataPaths: [path.join(dir, 'data.csv')],
      schemaPath: path.join(dir, 'schema.jsonld'),
      outputPath: path.join(dir, 'output.jsonld'),
      databasePath: path.join(dir, 'pipeline.db'),
      rulesPath: path.join(dir, 'rules.json'),
      enableLogging: false,
      hidePII: false,
      retriesNumber: 0,
      requiredFieldErrorsFailBatch: false,
      batchSize: 5,
      concurrencySize: 1,
      defaultModel: 'gpt-4.1',
      fallbackModel: 'gpt-4.1',
      uuidColumn: 'userID',
      resumeMode: 'fresh',
      ...overrides,
    };
  }

  it('normalises values with the explicit taxonomy, prints the source on stderr and records it in provenance', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const taxonomiesPath = path.join(dir, 'taxonomies');

    const summary = await analyzeDataWithDb(
      config({ taxonomiesPath }),
      new NeverCalledClient(),
      false
    );
    expect(summary.failedBatchCount).toBe(0);

    // run summary line names the source actually used and goes to stderr (same stream as the
    // CLI's option summary), never to stdout
    const stderrLines = errSpy.mock.calls.flat().filter((l) => typeof l === 'string');
    expect(stderrLines).toContain(`📚 Taxonomies: explicit (${path.resolve(taxonomiesPath)})`);
    expect(
      logSpy.mock.calls.flat().some((l) => typeof l === 'string' && /Taxonomies:/.test(l))
    ).toBe(false);

    const output = JSON.parse(readFileSync(path.join(dir, 'output.jsonld'), 'utf8'));
    // entity records are { person: {...}, '@context': {...} }; the provenance record is the Dataset
    const people = output.filter((e: any) => e.person).map((e: any) => e.person);
    expect(people).toHaveLength(2);
    // TIER_GOLD (notation) → gold; silver (value) → silver — both via the explicit Tier-v1
    expect(people.map((p: any) => p.tier).sort()).toEqual(['gold', 'silver']);

    const provenance = output.find((e: any) => e['@type'] === 'Dataset');
    expect(provenance.taxonomiesSource).toBe('explicit');
    expect(provenance.taxonomiesPath).toBe(path.resolve(taxonomiesPath));
    expect(provenance['@context'].taxonomiesSource).toBe(
      'urn:npa-ingest-insight-cli:taxonomiesSource'
    );
  });

  it('without taxonomiesPath the run resolves the package or vendored copy and says which', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The schema must not reference Tier-v1 (it exists only in the explicit directory): a
    // schema property whose taxonomy is missing is a fatal configuration error (see below).
    // The rules still name Tier-v1: for the deterministic path a missing taxonomy is a
    // single warning and the value passes through unchanged.
    await analyzeDataWithDb(
      config({ schemaPath: path.join(dir, 'schema-no-taxonomy.jsonld') }),
      new NeverCalledClient(),
      false
    );

    const summaryLine = errSpy.mock.calls
      .flat()
      .find((l) => typeof l === 'string' && l.includes('Taxonomies:'));
    expect(summaryLine).toMatch(/^📚 Taxonomies: (package|vendor) \(/);

    // one warning for the missing Tier-v1, not one per row
    const tierWarnings = warnSpy.mock.calls
      .flat()
      .filter((l) => typeof l === 'string' && l.includes('Tier-v1.json'));
    expect(tierWarnings).toHaveLength(1);

    const output = JSON.parse(readFileSync(path.join(dir, 'output.jsonld'), 'utf8'));
    const provenance = output.find((e: any) => e['@type'] === 'Dataset');
    expect(['package', 'vendor']).toContain(provenance.taxonomiesSource);
    const people = output.filter((e: any) => e.person).map((e: any) => e.person);
    expect(people.map((p: any) => p.tier).sort()).toEqual(['TIER_GOLD', 'silver']);
  });

  it('a taxonomiesPath that does not exist fails with the resolver error (naming --taxonomies, taxonomiesPath and the package) before any work is done', async () => {
    const missing = path.join(dir, 'nope');
    let caught: unknown;
    try {
      await analyzeDataWithDb(config({ taxonomiesPath: missing }), new NeverCalledClient(), true);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TaxonomyResolutionError);
    const message = (caught as Error).message;
    expect(message).toContain(missing);
    expect(message).toMatch(/does not exist/);
    expect(message).toContain('--taxonomies');
    expect(message).toContain('taxonomiesPath');
    expect(message).toContain(ADC_SCHEMA_PACKAGE);
    expect(message).not.toMatch(/Taxonomies directory not found/);
    // nothing was ingested / written
    expect(existsSync(path.join(dir, 'pipeline.db'))).toBe(false);
    expect(existsSync(path.join(dir, 'output.jsonld'))).toBe(false);
  });

  it('--taxonomies pointing at an EMPTY directory fails before ingestion', async () => {
    const empty = path.join(dir, 'empty-taxonomies');
    await fs.mkdir(empty);

    let caught: unknown;
    try {
      await analyzeDataWithDb(config({ taxonomiesPath: empty }), new NeverCalledClient(), true);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TaxonomyResolutionError);
    expect((caught as Error).message).toMatch(/directory is empty/);
    expect((caught as Error).message).toContain(path.resolve(empty));
    expect(existsSync(path.join(dir, 'pipeline.db'))).toBe(false);
    expect(existsSync(path.join(dir, 'output.jsonld'))).toBe(false);
  });

  it('--taxonomies pointing at a directory that lacks a taxonomy the schema references fails with the property name, before ingestion', async () => {
    // Has *a* taxonomy (so the directory resolves) but not Tier-v1, which person.tier needs.
    const partial = path.join(dir, 'partial-taxonomies');
    await fs.mkdir(partial);
    writeFileSync(
      path.join(partial, 'Gender-v1.json'),
      JSON.stringify([{ notation: 'GENDER_OTHER', value: 'other' }])
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let caught: unknown;
    try {
      await analyzeDataWithDb(config({ taxonomiesPath: partial }), new NeverCalledClient(), true);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    expect(caught).not.toBeInstanceOf(TaxonomyResolutionError);
    const message = (caught as Error).message;
    expect(message).toContain('person.tier');
    expect(message).toContain('Tier-v1');
    expect(message).toContain(path.join(path.resolve(partial), 'Tier-v1.json'));
    expect(message).toContain(`explicit (${path.resolve(partial)})`);
    // a fatal configuration error, not a per-batch failure: nothing was ingested or written
    expect(existsSync(path.join(dir, 'pipeline.db'))).toBe(false);
    expect(existsSync(path.join(dir, 'output.jsonld'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('vendored fallback matches the installed adc-schema package', () => {
  const require = createRequire(import.meta.url);
  let packageTaxonomies: string | null = null;
  try {
    packageTaxonomies = path.join(
      path.dirname(require.resolve(`${ADC_SCHEMA_PACKAGE}/package.json`)),
      'taxonomies'
    );
  } catch {
    packageTaxonomies = null;
  }

  const vendorDir = path.join(REPO_ROOT, 'vendor', 'taxonomies');

  it('vendor/taxonomies exists with the eight ADC taxonomies and a README marking it as a pinned copy', () => {
    const files = readdirSync(vendorDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(files).toEqual([
      'ActionType-v1.json',
      'AgeGroup-v1.json',
      'ConsentType-v1.json',
      'DonorStatus-v1.json',
      'EducationLevel-v1.json',
      'Gender-v1.json',
      'IncomeBracket-v1.json',
      'ObjectType-v1.json',
    ]);
    expect(readFileSync(path.join(REPO_ROOT, 'vendor', 'README.md'), 'utf8')).toMatch(
      /Do not edit/i
    );
  });

  it.skipIf(packageTaxonomies === null)(
    'every vendored file is byte-identical to the package copy (npm run vendor:check)',
    () => {
      const packageFiles = readdirSync(packageTaxonomies!)
        .filter((f) => f.endsWith('.json'))
        .sort();
      const vendorFiles = readdirSync(vendorDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      expect(vendorFiles).toEqual(packageFiles);
      for (const file of packageFiles) {
        expect(
          readFileSync(path.join(vendorDir, file)).equals(
            readFileSync(path.join(packageTaxonomies!, file))
          )
        ).toBe(true);
      }
    }
  );
});
