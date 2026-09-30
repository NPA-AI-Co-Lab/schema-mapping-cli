import path from 'path';
import prompts from 'prompts';
import { validateJSONPath } from './validation.js';
import { handleCliShutdown } from './shutdown.js';
import { loadAppConfig } from './config.js';
import { validateConfigPaths } from './config-path-validator.js';
import { createConfigPrompt, createOutputPrompt } from './config-prompts.js';
import { showOptionsSummary } from './config-summary.js';
import { normalizeConfig } from './config-normalizer.js';
import { AppConfig } from './types.js';
import { configureTaxonomies } from '../jsonld/taxonomy.js';

/**
 * Command-line values that take precedence over the config file. They are applied before
 * any path validation so a wrong `taxonomiesPath` in the file can be rescued with
 * `--taxonomies`.
 */
export interface ConfigOverrides {
  taxonomiesPath?: string;
}

/**
 * Apply the CLI override, then resolve the taxonomies (explicit → package → vendor).
 * Throws a TaxonomyResolutionError naming every location tried when that fails.
 */
function resolveTaxonomySource(fullConfig: AppConfig, overrides: ConfigOverrides) {
  const taxonomiesPath = overrides.taxonomiesPath || fullConfig.taxonomiesPath;
  const taxonomies = configureTaxonomies(taxonomiesPath);
  return { taxonomiesPath, taxonomies };
}

/**
 * Get app parameters from configuration file
 */
export async function getAppParamsFromConfig(
  configPath: string,
  overrides: ConfigOverrides = {}
): Promise<AppConfig> {
  const resolvedConfigPath = path.resolve(configPath);

  const configCheck = validateJSONPath(resolvedConfigPath);
  if (configCheck !== true) {
    console.error(`❌ Config file error: ${configCheck}`);
    process.exit(1);
  }

  const fullConfig = loadAppConfig(resolvedConfigPath);

  if (!fullConfig.outputPath) {
    console.error(
      '❌ When using --config argument, outputPath must be specified in the configuration file'
    );
    process.exit(1);
  }

  const outputPath = path.resolve(fullConfig.outputPath);

  // Get data paths (array or single path)
  const filePaths = fullConfig.dataPaths || (fullConfig.dataPath ? [fullConfig.dataPath] : []);
  if (filePaths.length === 0) {
    console.error('❌ No data files specified in configuration');
    process.exit(1);
  }

  // --taxonomies wins over the file; the resolver validates the explicit value (if any).
  const { taxonomiesPath, taxonomies } = resolveTaxonomySource(fullConfig, overrides);

  // Validate all provided data paths, schema and output at once
  if (!validateConfigPaths(filePaths, fullConfig.schemaPath, outputPath, taxonomiesPath)) {
    process.exit(1);
  }
  showOptionsSummary(
    outputPath,
    fullConfig.enableLogging,
    fullConfig.hidePII,
    fullConfig.retriesNumber,
    undefined,
    undefined,
    undefined,
    undefined,
    taxonomies
  );

  const appConfig: AppConfig = {
    dataPaths: filePaths,
    schemaPath: fullConfig.schemaPath,
    outputPath,
    databasePath: fullConfig.databasePath,
    enableLogging: fullConfig.enableLogging ?? false,
    hidePII: fullConfig.hidePII ?? true,
    retriesNumber: fullConfig.retriesNumber ?? 2,
    requiredFieldErrorsFailBatch: fullConfig.requiredFieldErrorsFailBatch ?? true,
    batchSize: fullConfig.batchSize ?? 5,
    concurrencySize: fullConfig.concurrencySize ?? 5,
    defaultModel: fullConfig.defaultModel ?? 'gpt-4.1-mini',
    fallbackModel: fullConfig.fallbackModel ?? 'gpt-4.1',
    uuidColumn: fullConfig.uuidColumn,
    rulesPath: fullConfig.rulesPath,
    taxonomiesPath,
    resumeMode: fullConfig.resumeMode ?? 'auto',
    forceReingestion: fullConfig.forceReingestion ?? false,
  };

  return normalizeConfig(appConfig);
}

/**
 * Get app parameters via interactive prompts
 */
export async function getAppParams(overrides: ConfigOverrides = {}): Promise<AppConfig> {
  const { configPath: inputConfigPath } = await prompts([createConfigPrompt()], {
    onCancel: () => {
      handleCliShutdown();
    },
  });

  const configPath = path.resolve(inputConfigPath);

  const fullConfig = loadAppConfig(configPath);

  const outputPath =
    fullConfig.outputPath ||
    (
      await prompts([createOutputPrompt()], {
        onCancel: () => {
          handleCliShutdown();
        },
      })
    ).outputPath;

  // --taxonomies wins over the file; the resolver validates the explicit value (if any).
  const { taxonomiesPath, taxonomies } = resolveTaxonomySource(fullConfig, overrides);

  showOptionsSummary(
    outputPath,
    fullConfig.enableLogging,
    fullConfig.hidePII,
    fullConfig.retriesNumber,
    undefined,
    undefined,
    undefined,
    undefined,
    taxonomies
  );

  // Get data paths (array or single path)
  const filePaths = fullConfig.dataPaths || (fullConfig.dataPath ? [fullConfig.dataPath] : []);
  if (filePaths.length === 0) {
    console.error('❌ No data files specified in configuration');
    process.exit(1);
  }

  // Validate all provided data paths, schema and output at once
  if (!validateConfigPaths(filePaths, fullConfig.schemaPath, outputPath, taxonomiesPath)) {
    process.exit(1);
  }
  const appConfig: AppConfig = {
    dataPaths: filePaths,
    schemaPath: fullConfig.schemaPath,
    outputPath,
    databasePath: fullConfig.databasePath,
    enableLogging: fullConfig.enableLogging ?? false,
    hidePII: fullConfig.hidePII ?? true,
    retriesNumber: fullConfig.retriesNumber ?? 2,
    requiredFieldErrorsFailBatch: fullConfig.requiredFieldErrorsFailBatch ?? true,
    batchSize: fullConfig.batchSize ?? 5,
    concurrencySize: fullConfig.concurrencySize ?? 5,
    defaultModel: fullConfig.defaultModel ?? 'gpt-4.1-mini',
    fallbackModel: fullConfig.fallbackModel ?? 'gpt-4.1',
    uuidColumn: fullConfig.uuidColumn,
    rulesPath: fullConfig.rulesPath,
    taxonomiesPath,
    resumeMode: fullConfig.resumeMode ?? 'auto',
    forceReingestion: fullConfig.forceReingestion ?? false,
  };

  return normalizeConfig(appConfig);
}
