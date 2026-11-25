import { validateJSONPath, validateDirectoryPath } from '../utils/index.js';
import { CliOptions } from './cli-types.js';

/**
 * Parse a numeric CLI flag. Only plain digits are accepted (`10`, ` 10 `); anything else
 * (`2.7`, `5abc`, `0x10`, `1e1`, `-1`, an empty string) becomes NaN, so validation rejects it.
 * parseInt used to turn `2.7` into 2 and `5abc` into 5, and Number() would accept `0x10` and
 * `1e1`.
 */
export function parseIntegerOption(value: string): number {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

type NumericOption =
  | 'batchSize'
  | 'concurrency'
  | 'retries'
  | 'rateLimitRetries'
  | 'rateLimitMaxWait'
  | 'sdkRetries';

type NumericConfigKey =
  | 'batchSize'
  | 'concurrencySize'
  | 'retriesNumber'
  | 'rateLimitMaxRetries'
  | 'rateLimitMaxWaitMs'
  | 'sdkMaxRetries';

/** Every numeric flag of `analyze`, the config key it sets and its allowed range. */
export const NUMERIC_FLAGS: ReadonlyArray<{
  option: NumericOption;
  flag: string;
  key: NumericConfigKey;
  min: number;
  max: number;
}> = [
  { option: 'batchSize', flag: '--batch-size', key: 'batchSize', min: 1, max: 50 },
  { option: 'concurrency', flag: '--concurrency', key: 'concurrencySize', min: 1, max: 20 },
  { option: 'retries', flag: '--retries', key: 'retriesNumber', min: 0, max: 10 },
  {
    option: 'rateLimitRetries',
    flag: '--rate-limit-retries',
    key: 'rateLimitMaxRetries',
    min: 0,
    max: 20,
  },
  {
    option: 'rateLimitMaxWait',
    flag: '--rate-limit-max-wait',
    key: 'rateLimitMaxWaitMs',
    min: 1000,
    max: 600000,
  },
  { option: 'sdkRetries', flag: '--sdk-retries', key: 'sdkMaxRetries', min: 0, max: 5 },
];

/** One message per numeric flag that was given (even as an empty string) and is invalid. */
export function numericFlagErrors(options: CliOptions): string[] {
  const errors: string[] = [];
  for (const { option, flag, min, max } of NUMERIC_FLAGS) {
    const raw = options[option];
    if (raw === undefined) continue;
    const value = parseIntegerOption(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${flag} must be a whole number between ${min} and ${max}, got "${raw}"`);
    }
  }
  return errors;
}

/** The config values set by the numeric flags that were given; the rest are left to the config. */
export function numericFlagOverrides(
  options: CliOptions
): Partial<Record<NumericConfigKey, number>> {
  const overrides: Partial<Record<NumericConfigKey, number>> = {};
  for (const { option, key } of NUMERIC_FLAGS) {
    const raw = options[option];
    if (raw !== undefined) overrides[key] = parseIntegerOption(raw);
  }
  return overrides;
}

/**
 * Check if we should use interactive mode
 * Interactive mode is used when no config, no input, and not using stdout
 */
export function shouldUseInteractiveMode(options: CliOptions): boolean {
  return !options.input && !options.config && !options.stdout;
}

/**
 * Validate CLI options. Numeric flags are checked in every mode; the rest only outside
 * interactive mode.
 */
export function validateOptions(options: CliOptions): void {
  // Numeric flags are checked in every mode, interactive included, so a bad value is reported
  // with the flag that set it rather than later under its config key.
  const numericErrors = numericFlagErrors(options);
  if (shouldUseInteractiveMode(options)) {
    reportAndExit(numericErrors);
    return;
  }

  const errors: string[] = [...numericErrors];

  if (!options.input && !options.config) {
    errors.push('Input data file (-i/--input) is required when not using config file');
  }

  if (!options.schema && !options.config) {
    errors.push('Schema file (-s/--schema) is required when not using config file');
  }

  if (options.input && !validateJSONPath(options.input)) {
    errors.push(`Input file does not exist: ${options.input}`);
  }

  if (options.schema && !validateJSONPath(options.schema)) {
    errors.push(`Schema file does not exist: ${options.schema}`);
  }

  if (options.rules && !validateJSONPath(options.rules)) {
    errors.push(`Rules file does not exist: ${options.rules}`);
  }

  if (options.taxonomies) {
    const taxonomiesCheck = validateDirectoryPath(options.taxonomies);
    if (taxonomiesCheck !== true) {
      errors.push(`Taxonomies directory (--taxonomies) error: ${taxonomiesCheck}`);
    }
  }

  reportAndExit(errors);
}

function reportAndExit(errors: string[]): void {
  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach((error) => console.error(`  • ${error}`));
    process.exit(1);
  }
}
