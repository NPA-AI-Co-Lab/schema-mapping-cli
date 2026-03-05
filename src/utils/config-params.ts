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

/**
 * Get app parameters from configuration file
 */
export async function getAppParamsFromConfig(configPath: string): Promise<AppConfig> {
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

  // Validate all provided data paths, schema and output at once
  if (!validateConfigPaths(filePaths, fullConfig.schemaPath, outputPath)) {
    process.exit(1);
  }
  showOptionsSummary(
    outputPath,
    fullConfig.enableLogging,
    fullConfig.hidePII,
    fullConfig.retriesNumber
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
    resumeMode: fullConfig.resumeMode ?? 'auto',
    forceReingestion: fullConfig.forceReingestion ?? false,
  };

  return normalizeConfig(appConfig);
}

/**
 * Get app parameters via interactive prompts
 */
export async function getAppParams(): Promise<AppConfig> {
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

  showOptionsSummary(
    outputPath,
    fullConfig.enableLogging,
    fullConfig.hidePII,
    fullConfig.retriesNumber
  );

  // Get data paths (array or single path)
  const filePaths = fullConfig.dataPaths || (fullConfig.dataPath ? [fullConfig.dataPath] : []);
  if (filePaths.length === 0) {
    console.error('❌ No data files specified in configuration');
    process.exit(1);
  }

  // Validate all provided data paths, schema and output at once
  if (!validateConfigPaths(filePaths, fullConfig.schemaPath, outputPath)) {
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
    resumeMode: fullConfig.resumeMode ?? 'auto',
    forceReingestion: fullConfig.forceReingestion ?? false,
  };

  return normalizeConfig(appConfig);
}
