import { validateJSONPath, validateDirectoryPath } from '../utils/index.js';
import { CliOptions } from './cli-types.js';

/**
 * Parse a numeric CLI flag. Unlike parseInt, which silently turned `2.7` into 2 and `5abc` into
 * 5, this keeps the value as written (`2.7`, NaN), so validation can reject it with the setting
 * named.
 */
export function parseIntegerOption(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/**
 * Check if we should use interactive mode
 * Interactive mode is used when no config, no input, and not using stdout
 */
export function shouldUseInteractiveMode(options: CliOptions): boolean {
  return !options.input && !options.config && !options.stdout;
}

/**
 * Validate CLI options (only when not in interactive mode)
 */
export function validateOptions(options: CliOptions): void {
  if (shouldUseInteractiveMode(options)) {
    return;
  }

  const errors: string[] = [];

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

  if (options.batchSize) {
    const batchSize = parseIntegerOption(options.batchSize);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      errors.push(`Batch size must be a whole number between 1 and 50, got "${options.batchSize}"`);
    }
  }

  if (options.concurrency) {
    const concurrency = parseIntegerOption(options.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      errors.push(
        `Concurrency must be a whole number between 1 and 20, got "${options.concurrency}"`
      );
    }
  }

  if (options.retries) {
    const retries = parseIntegerOption(options.retries);
    if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
      errors.push(`Retries must be a whole number between 0 and 10, got "${options.retries}"`);
    }
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach((error) => console.error(`  • ${error}`));
    process.exit(1);
  }
}
