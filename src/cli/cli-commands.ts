import { analyzeDataWithDb } from '../analysis/pipeline-db.js';
import {
  AppConfig,
  bold,
  getAppParams,
  getAppParamsFromConfig,
  getDefaultModel,
  getFallbackModel,
  loadBaseAppConfig,
  removeCliSigintHandler,
  restoreCliSigintHandler,
} from '../utils/index.js';
import { deriveDatabasePath } from '../database/index.js';
import { DEFAULT_HIDE_PII, DEFAULT_RETRIES_NUMBER } from '../utils/config-defaults.js';
import { CliOptions, PackageInfo } from './cli-types.js';
import { numericFlagOverrides, shouldUseInteractiveMode, validateOptions } from './cli-config.js';

function parseFieldList(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length > 0 ? items : undefined;
}

/**
 * Main CLI command handler
 */
export async function runAnalyzeCommand(options: CliOptions, pkg: PackageInfo) {
  try {
    if (shouldUseInteractiveMode(options)) {
      return await runInteractiveMode(options, pkg);
    }

    return await runCliMode(options, pkg);
  } catch (error) {
    console.error('❌ Analysis failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Run in interactive mode
 */
async function runInteractiveMode(options: CliOptions, pkg: PackageInfo) {
  // Automatically enable quiet mode when using stdout to avoid interfering with JSON output
  const quiet = options.quiet || options.stdout || false;

  // Reject bad numeric flags (--batch-size 2.7, ...) before any prompt; only those are checked
  // here, the interactive prompts collect the rest.
  validateOptions(options);

  if (!quiet) {
    console.error(`\n${bold(`Welcome to ${pkg.name} ${pkg.version}!`)}\n`);
  }

  // --taxonomies is applied over the config file *inside* these helpers, before any path
  // validation, so a wrong taxonomiesPath in the file can be rescued from the CLI.
  const overrides = { taxonomiesPath: options.taxonomies };
  const baseParams = options.config
    ? await getAppParamsFromConfig(options.config, overrides)
    : await getAppParams(overrides);

  const includeFields = parseFieldList(options.llmFields);
  const excludeFields = parseFieldList(options.noLlmFields);
  const llmFieldOverrides =
    includeFields || excludeFields
      ? {
          ...(includeFields ? { include: includeFields } : {}),
          ...(excludeFields ? { exclude: excludeFields } : {}),
        }
      : undefined;

  const appParams: AppConfig = {
    ...baseParams,
    defaultModel: options.model || baseParams.defaultModel,
    fallbackModel: options.fallbackModel || baseParams.fallbackModel,
    enableLogging: options.logging ?? baseParams.enableLogging,
    hidePII: options.hidePii ?? baseParams.hidePII,
    requiredFieldErrorsFailBatch:
      options.requiredFieldsFailBatch ?? baseParams.requiredFieldErrorsFailBatch,
    uuidColumn: baseParams.uuidColumn,
    rulesPath: options.rules || baseParams.rulesPath,
    taxonomiesPath: options.taxonomies || baseParams.taxonomiesPath,
    llmFieldOverrides,
    adaptiveConcurrency:
      options.noAdaptiveConcurrency !== undefined
        ? !options.noAdaptiveConcurrency
        : baseParams.adaptiveConcurrency,
    failFast: options.failFast ?? baseParams.failFast,
    // --batch-size, --concurrency, --retries, --rate-limit-*, --sdk-retries (validated above)
    ...numericFlagOverrides(options),
  };

  if (options.stdout) {
    appParams.outputPath = '';

    if (!appParams.databasePath) {
      const baseOut = baseParams.outputPath || '';
      if (baseOut) {
        appParams.databasePath = deriveDatabasePath(baseOut);
      }
    }
  }

  removeCliSigintHandler();

  try {
    const summary = await analyzeDataWithDb(appParams, undefined, quiet);

    if (!quiet) {
      if (summary.failedBatchCount > 0) {
        console.error(
          `⚠️  Analysis finished with ${summary.failedBatchCount} failed batch(es). Results saved to: ${appParams.outputPath}`
        );
      } else if (summary.warningCount > 0) {
        console.error(
          `Results saved to: ${appParams.outputPath}. Warning count: ${summary.warningCount}`
        );
      } else {
        console.error(`✅ Analysis completed! Results saved to: ${appParams.outputPath}`);
      }
    }

    process.exitCode = summary.failedBatchCount > 0 ? 1 : summary.warningCount > 0 ? 2 : 0;
  } catch (error) {
    restoreCliSigintHandler();
    throw error;
  }
}

/**
 * Run in CLI mode
 */
async function runCliMode(options: CliOptions, pkg: PackageInfo) {
  // Automatically enable quiet mode when using stdout to avoid interfering with JSON output
  const quiet = options.quiet || options.stdout || false;

  if (!quiet) {
    console.error(`\n${bold(`Welcome to ${pkg.name} ${pkg.version}!`)}\n`);
  }

  validateOptions(options);

  // Get base config and apply CLI overrides
  // Explicit -c file, else ./config.json when present, else built-in defaults — a CLI-only
  // invocation (-i/-s/-o) must work from any directory. --taxonomies is merged here, before
  // analyzeDataWithDb resolves and validates anything, so a wrong taxonomiesPath in the config
  // file can be rescued from the CLI. The resolved `📚 Taxonomies:` line is printed by the
  // pipeline on stderr, right after the summary below.
  const baseConfig = loadBaseAppConfig(options.config);

  const includeFields = parseFieldList(options.llmFields);
  const excludeFields = parseFieldList(options.noLlmFields);
  const llmFieldOverrides =
    includeFields || excludeFields
      ? {
          ...(includeFields ? { include: includeFields } : {}),
          ...(excludeFields ? { exclude: excludeFields } : {}),
        }
      : undefined;

  const appParams: AppConfig = {
    ...baseConfig,
    dataPaths: options.input ? [options.input] : baseConfig.dataPaths,
    schemaPath: options.schema || baseConfig.schemaPath,
    outputPath: options.output || baseConfig.outputPath,
    databasePath: baseConfig.databasePath,
    enableLogging: options.logging ?? baseConfig.enableLogging,
    hidePII: options.hidePii ?? baseConfig.hidePII,
    requiredFieldErrorsFailBatch:
      options.requiredFieldsFailBatch ?? baseConfig.requiredFieldErrorsFailBatch,
    defaultModel: options.model || getDefaultModel(baseConfig),
    fallbackModel: options.fallbackModel || getFallbackModel(baseConfig),
    uuidColumn: baseConfig.uuidColumn,
    rulesPath: options.rules || baseConfig.rulesPath,
    taxonomiesPath: options.taxonomies || baseConfig.taxonomiesPath,
    llmFieldOverrides,
    resumeMode: baseConfig.resumeMode,
    adaptiveConcurrency:
      options.noAdaptiveConcurrency !== undefined
        ? !options.noAdaptiveConcurrency
        : baseConfig.adaptiveConcurrency,
    failFast: options.failFast ?? baseConfig.failFast,
    // --batch-size, --concurrency, --retries, --rate-limit-*, --sdk-retries (validated above)
    ...numericFlagOverrides(options),
  };

  // If stdout mode requested, ensure outputPath signals stdout and set a database path
  if (options.stdout) {
    appParams.outputPath = '';

    if (!appParams.databasePath) {
      const baseOut = baseConfig.outputPath || '';
      if (baseOut) {
        appParams.databasePath = deriveDatabasePath(baseOut);
      }
    }
  }

  // Determine output mode: stdout vs file
  const outputToFile = !options.stdout && !!(options.output || baseConfig.outputPath);

  if (!quiet) {
    console.error(`- Output: ${outputToFile ? appParams.outputPath : 'stdout'}`);
    // Show the values the run will use: normalizeConfig (in the pipeline) fills in the ones a
    // config file leaves out, so print those defaults rather than "disabled" / "undefined".
    console.error(`- Logging: ${appParams.enableLogging ? 'enabled' : 'disabled'}`);
    console.error(
      `- PII protection: ${(appParams.hidePII ?? DEFAULT_HIDE_PII) ? 'enabled' : 'disabled'}`
    );
    console.error(`- Retries set: ${appParams.retriesNumber ?? DEFAULT_RETRIES_NUMBER}\n`);
  }

  removeCliSigintHandler();

  try {
    const summary = await analyzeDataWithDb(appParams, undefined, quiet);

    if (!quiet && outputToFile) {
      if (summary.failedBatchCount > 0) {
        console.error(
          `⚠️  Analysis finished with ${summary.failedBatchCount} failed batch(es). Results saved to: ${appParams.outputPath}`
        );
      } else if (summary.warningCount > 0) {
        console.error(
          `Results saved to: ${appParams.outputPath}. Warning count: ${summary.warningCount}`
        );
      } else {
        console.error(`✅ Analysis completed! Results saved to: ${appParams.outputPath}`);
      }
    }

    process.exitCode = summary.failedBatchCount > 0 ? 1 : summary.warningCount > 0 ? 2 : 0;
  } catch (error) {
    restoreCliSigintHandler();
    throw error;
  }
}
