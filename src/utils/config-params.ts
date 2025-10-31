import path from 'path';
import prompts from 'prompts';
import { validateJSONPath } from './validation.js';
import { handleCliShutdown } from './shutdown.js';
import { loadConfig } from './config-file-loader.js';
import { loadAppConfig } from './config.js';
import { validateConfigPaths } from './config-path-validator.js';
import { createConfigPrompt, createOutputPrompt } from './config-prompts.js';
import { showOptionsSummary } from './config-summary.js';
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

  const {
    dataPath,
    schemaPath,
    configOutputPath,
    enableLogging,
    hidePII,
    retriesNumber,
    requiredFieldErrorsFailBatch,
    uuidColumn,
    rulesPath,
  } = loadConfig(resolvedConfigPath);

  if (!configOutputPath) {
    console.error(
      '❌ When using --config argument, outputPath must be specified in the configuration file'
    );
    process.exit(1);
  }

  const outputPath = path.resolve(configOutputPath);

  if (!validateConfigPaths(dataPath, schemaPath, outputPath)) {
    process.exit(1);
  }

  showOptionsSummary(outputPath, enableLogging, hidePII, retriesNumber);

  const fullConfig = loadAppConfig(resolvedConfigPath);

  return {
    dataPath,
    schemaPath,
    outputPath,
    enableLogging,
    hidePII,
    retriesNumber,
    requiredFieldErrorsFailBatch,
    batchSize: fullConfig.batchSize,
    concurrencySize: fullConfig.concurrencySize,
    defaultModel: fullConfig.defaultModel,
    fallbackModel: fullConfig.fallbackModel,
    uuidColumn,
    rulesPath: fullConfig.rulesPath ?? rulesPath,
  };
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

  const {
    dataPath,
    schemaPath,
    configOutputPath,
    enableLogging,
    hidePII,
    retriesNumber,
    requiredFieldErrorsFailBatch,
    uuidColumn,
    rulesPath,
  } = loadConfig(configPath);

  const outputPath =
    configOutputPath ||
    (
      await prompts([createOutputPrompt()], {
        onCancel: () => {
          handleCliShutdown();
        },
      })
    ).outputPath;

  showOptionsSummary(outputPath, enableLogging, hidePII, retriesNumber);

  if (!validateConfigPaths(dataPath, schemaPath, outputPath)) {
    process.exit(1);
  }

  const defaultConfig = loadAppConfig();

  return {
    dataPath,
    schemaPath,
    outputPath,
    enableLogging,
    hidePII,
    retriesNumber,
    requiredFieldErrorsFailBatch,
    batchSize: defaultConfig.batchSize,
    concurrencySize: defaultConfig.concurrencySize,
    defaultModel: defaultConfig.defaultModel,
    fallbackModel: defaultConfig.fallbackModel,
    uuidColumn,
    rulesPath: defaultConfig.rulesPath ?? rulesPath,
  };
}
