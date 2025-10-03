import { validateJSONPath } from "../utils/index.js";
import { CliOptions } from "./cli-types.js";

/**
 * Check if we should use interactive mode
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
    errors.push("Input data file (-i/--input) is required when not using config file");
  }
  
  if (!options.schema && !options.config) {
    errors.push("Schema file (-s/--schema) is required when not using config file");
  }

  if (options.input && !validateJSONPath(options.input)) {
    errors.push(`Input file does not exist: ${options.input}`);
  }
  
  if (options.schema && !validateJSONPath(options.schema)) {
    errors.push(`Schema file does not exist: ${options.schema}`);
  }

  if (options.batchSize) {
    const batchSize = parseInt(options.batchSize, 10);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 50) {
      errors.push("Batch size must be a number between 1 and 50");
    }
  }

  if (options.concurrency) {
    const concurrency = parseInt(options.concurrency, 10);
    if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
      errors.push("Concurrency must be a number between 1 and 20");
    }
  }

  if (options.retries) {
    const retries = parseInt(options.retries, 10);
    if (isNaN(retries) || retries < 0 || retries > 10) {
      errors.push("Retries must be a number between 0 and 10");
    }
  }

  if (errors.length > 0) {
    console.error("❌ Configuration errors:");
    errors.forEach(error => console.error(`  • ${error}`));
    process.exit(1);
  }
}
