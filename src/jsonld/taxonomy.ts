import path from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { basePath } from '../utils/file-system.js';
import { ConfigurationError } from '../utils/errors.js';
import { JsonLdProperty } from './types.js';
import { TaxonomyEntry } from './types.js';

/**
 * The npm package that owns the ADC data model and its taxonomies.
 * The CLI is a consumer of that package; it no longer hosts the taxonomies itself.
 */
export const ADC_SCHEMA_PACKAGE = '@npa-ai-co-lab/adc-schema';

/**
 * Where the taxonomies were found, in precedence order:
 *  - `explicit`: `taxonomiesPath` in config or `--taxonomies <dir>` on the command line
 *  - `package`:  the installed `@npa-ai-co-lab/adc-schema` package
 *  - `vendor`:   the pinned copy bundled with the CLI under `vendor/taxonomies/` (offline fallback)
 */
export type TaxonomySource = 'explicit' | 'package' | 'vendor';

/** A location the resolver looked at and why it was skipped. */
export interface TaxonomyCandidate {
  source: TaxonomySource;
  /** Directory that was checked, or null when the source could not even produce a path. */
  dir: string | null;
  /** Human-readable reason the candidate was not used. */
  reason: string;
}

/** The outcome of a successful resolution. */
export interface TaxonomyResolution {
  source: TaxonomySource;
  dir: string;
  /** Candidates that were checked and skipped before `dir` was chosen. */
  tried: TaxonomyCandidate[];
}

/** Hooks that let tests substitute the package and vendor locations. */
export interface TaxonomyResolverOptions {
  /** Returns the root directory of the installed adc-schema package, or null when it is not installed. */
  locatePackageDir?: () => string | null;
  /** Directory of the vendored fallback. */
  vendorDir?: string;
}

/**
 * Raised when no taxonomy directory could be resolved. `tried` lists every location that was checked.
 */
export class TaxonomyResolutionError extends ConfigurationError {
  constructor(
    message: string,
    public readonly tried: TaxonomyCandidate[]
  ) {
    super(message);
    this.name = 'TaxonomyResolutionError';
  }
}

const SOURCE_LABEL: Record<TaxonomySource, string> = {
  explicit: 'explicit path (taxonomiesPath / --taxonomies)',
  package: `installed package ${ADC_SCHEMA_PACKAGE}`,
  vendor: 'vendored fallback (vendor/taxonomies)',
};

const EMPTY_DIR_REASON = 'directory is empty (no *.json taxonomy files)';

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** A taxonomy directory is only usable when it holds at least one `*.json` file. */
function hasJsonFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((entry) => entry.toLowerCase().endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Locate the installed adc-schema package through Node's own resolution, starting from this
 * module. This finds the CLI's dependency wherever the CLI itself is installed (local or global).
 */
function locateInstalledPackageDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return path.dirname(require.resolve(`${ADC_SCHEMA_PACKAGE}/package.json`));
  } catch {
    return null;
  }
}

function defaultVendorDir(): string {
  return path.resolve(basePath, 'vendor', 'taxonomies');
}

/**
 * Resolve the directory that holds the taxonomy files.
 *
 * Precedence: explicit path → installed package → vendored fallback. A candidate is accepted
 * only when it is a directory that contains at least one `*.json` file.
 * An explicit path that does not exist (or is empty) is a configuration error and is never
 * silently replaced by a lower-precedence source. When nothing resolves, the error lists every
 * location that was tried.
 */
export function resolveTaxonomiesDir(
  explicitPath?: string,
  options: TaxonomyResolverOptions = {}
): TaxonomyResolution {
  const tried: TaxonomyCandidate[] = [];

  if (explicitPath !== undefined && explicitPath !== null && String(explicitPath).trim() !== '') {
    const dir = path.resolve(String(explicitPath));
    if (isDirectory(dir) && hasJsonFiles(dir)) {
      return { source: 'explicit', dir, tried };
    }
    const reason = !existsSync(dir)
      ? 'does not exist'
      : !isDirectory(dir)
        ? 'exists but is not a directory'
        : EMPTY_DIR_REASON;
    throw new TaxonomyResolutionError(
      `Taxonomies path "${explicitPath}" (resolved to ${dir}) ${reason}. ` +
        `Fix "taxonomiesPath" in the config file or the --taxonomies option, or remove it to use the installed ${ADC_SCHEMA_PACKAGE} package.`,
      [{ source: 'explicit', dir, reason }]
    );
  }
  tried.push({ source: 'explicit', dir: null, reason: 'not set' });

  const locatePackage = options.locatePackageDir ?? locateInstalledPackageDir;
  const packageRoot = locatePackage();
  if (packageRoot) {
    const dir = path.join(packageRoot, 'taxonomies');
    if (isDirectory(dir)) {
      if (hasJsonFiles(dir)) {
        return { source: 'package', dir, tried };
      }
      tried.push({ source: 'package', dir, reason: EMPTY_DIR_REASON });
    } else {
      tried.push({
        source: 'package',
        dir,
        reason: 'package is installed but has no taxonomies/ directory',
      });
    }
  } else {
    tried.push({ source: 'package', dir: null, reason: 'package is not installed' });
  }

  const vendorDir = path.resolve(options.vendorDir ?? defaultVendorDir());
  if (isDirectory(vendorDir)) {
    if (hasJsonFiles(vendorDir)) {
      return { source: 'vendor', dir: vendorDir, tried };
    }
    tried.push({ source: 'vendor', dir: vendorDir, reason: EMPTY_DIR_REASON });
  } else {
    tried.push({ source: 'vendor', dir: vendorDir, reason: 'does not exist' });
  }

  throw new TaxonomyResolutionError(formatResolutionFailure(tried), tried);
}

function formatResolutionFailure(tried: TaxonomyCandidate[]): string {
  const lines = tried.map((candidate, index) => {
    const where = candidate.dir ? `${candidate.dir} — ${candidate.reason}` : candidate.reason;
    return `  ${index + 1}. ${SOURCE_LABEL[candidate.source]}: ${where}`;
  });
  return [
    'Could not locate the ADC taxonomies. Tried, in order:',
    ...lines,
    `Set "taxonomiesPath" in the config file or pass --taxonomies <dir>, install ${ADC_SCHEMA_PACKAGE}, or reinstall the CLI so that the vendored fallback is present.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Module state: the active resolution and the per-taxonomy cache.

let activeResolution: TaxonomyResolution | undefined;
const taxonomyCache: Record<string, TaxonomyEntry[]> = {};
/** Taxonomy names whose file was not found in the active directory (negative cache). */
const missingTaxonomies = new Set<string>();

/**
 * Choose the taxonomy directory for this run. Call once, early, with the configured
 * explicit path (if any). Throws TaxonomyResolutionError when nothing resolves.
 */
export function configureTaxonomies(
  explicitPath?: string,
  options: TaxonomyResolverOptions = {}
): TaxonomyResolution {
  activeResolution = resolveTaxonomiesDir(explicitPath, options);
  clearTaxonomyCache();
  return activeResolution;
}

/**
 * The resolution in effect. Resolves lazily with default precedence when
 * configureTaxonomies() has not been called.
 */
export function getTaxonomyResolution(): TaxonomyResolution {
  if (!activeResolution) {
    activeResolution = resolveTaxonomiesDir();
  }
  return activeResolution;
}

/**
 * Forget the active resolution and the cache (useful for testing).
 */
export function resetTaxonomyResolution(): void {
  activeResolution = undefined;
  clearTaxonomyCache();
}

/**
 * Short human-readable description of where taxonomies come from, for the run summary.
 */
export function describeTaxonomySource(
  resolution: TaxonomyResolution = getTaxonomyResolution()
): string {
  return `${resolution.source} (${resolution.dir})`;
}

/** Absolute path of the file that `getTaxonomy(name)` reads from the active directory. */
export function getTaxonomyFilePath(name: string): string {
  return path.join(getTaxonomyResolution().dir, `${name}.json`);
}

/** True when `getTaxonomy(name)` already looked for the file and found nothing. */
export function isTaxonomyMissing(name: string): boolean {
  return missingTaxonomies.has(name);
}

function isTaxonomyEntry(entry: unknown): entry is TaxonomyEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as TaxonomyEntry).notation === 'string' &&
    typeof (entry as TaxonomyEntry).value === 'string'
  );
}

/**
 * Parse and validate a taxonomy file: it must be a JSON array of `{ notation, value }` objects.
 */
function loadTaxonomyFile(filePath: string, source: TaxonomySource): TaxonomyEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new ConfigurationError(
      `Taxonomy file ${filePath} (taxonomies source: ${source}) is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      filePath
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigurationError(
      `Taxonomy file ${filePath} (taxonomies source: ${source}) must contain a JSON array of { "notation", "value" } objects, got ${
        parsed === null ? 'null' : typeof parsed
      }.`,
      filePath
    );
  }

  const badIndex = parsed.findIndex((entry) => !isTaxonomyEntry(entry));
  if (badIndex !== -1) {
    throw new ConfigurationError(
      `Taxonomy file ${filePath} (taxonomies source: ${source}) is malformed: entry ${badIndex} is not a { "notation": string, "value": string } object (got ${JSON.stringify(
        parsed[badIndex]
      )}).`,
      filePath
    );
  }

  return parsed as TaxonomyEntry[];
}

/**
 * Load taxonomy data from file with caching.
 *
 * A taxonomy whose file is missing yields `[]`; the miss is cached and the warning is emitted
 * at most once per taxonomy name per configuration. Callers that must not proceed without the
 * taxonomy (schema `enumFromTaxonomy`) use `handleTaxonomyEnum`, which turns the miss into a
 * ConfigurationError.
 */
export function getTaxonomy(name: string): TaxonomyEntry[] {
  if (taxonomyCache[name]) return taxonomyCache[name];
  if (missingTaxonomies.has(name)) return [];

  const { dir, source } = getTaxonomyResolution();
  const filePath = path.join(dir, `${name}.json`);
  if (!existsSync(filePath)) {
    missingTaxonomies.add(name);
    console.warn(`⚠️ Taxonomy file not found: ${filePath} (taxonomies source: ${source})`);
    return [];
  }

  const data = loadTaxonomyFile(filePath, source);
  taxonomyCache[name] = data;
  return data;
}

/**
 * Handle taxonomy enumeration for properties
 * Note: Do NOT add null to the enum array - OpenAI rejects that!
 * Nullability is handled by the 'nullable: true' property instead.
 *
 * A schema property that references a taxonomy which is missing or empty in the resolved
 * directory is a fatal configuration error: an `enum: []` would make every LLM call fail.
 */
export function handleTaxonomyEnum(
  prop: JsonLdProperty,
  propertyName?: string
): string[] | undefined {
  if (!prop.enumFromTaxonomy) {
    return undefined;
  }

  const taxonomyName = prop.enumFromTaxonomy;
  const taxonomy = getTaxonomy(taxonomyName);
  if (taxonomy.length === 0) {
    const { dir, source } = getTaxonomyResolution();
    const filePath = path.join(dir, `${taxonomyName}.json`);
    const property = propertyName ? `Schema property "${propertyName}"` : 'A schema property';
    const problem = missingTaxonomies.has(taxonomyName)
      ? `but that file does not exist in the resolved taxonomies directory`
      : `but that file contains no entries`;
    throw new ConfigurationError(
      `${property} uses enumFromTaxonomy "${taxonomyName}" (expected ${filePath}), ${problem}. ` +
        `Taxonomies source: ${source} (${dir}). ` +
        `Add ${taxonomyName}.json to that directory, point "taxonomiesPath" / --taxonomies at a directory that has it, or remove the option to use the installed ${ADC_SCHEMA_PACKAGE} package.`,
      filePath
    );
  }

  // Return only the actual enum values, not null
  return taxonomy.map((t) => t.value);
}

/**
 * Clear taxonomy cache (useful for testing)
 */
export function clearTaxonomyCache(): void {
  Object.keys(taxonomyCache).forEach((key) => delete taxonomyCache[key]);
  missingTaxonomies.clear();
}
