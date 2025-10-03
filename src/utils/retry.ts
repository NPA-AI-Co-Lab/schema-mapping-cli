import pRetry, { AbortError, FailedAttemptError } from "p-retry";
import { Ora } from "ora";
import { ValidationError } from "./errors.js";
import { warn } from "./ui.js";
import { loadGlobalConfig } from "./config.js";

const { FALLBACK_MODEL } = loadGlobalConfig();

/**
 * Arguments for prompt/analysis functions
 */
export interface PromptArgs {
  input: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  model: string;
  [key: string]: unknown;
}

/**
 * Check if error should be retried with argument changes
 */
function shouldRetryWithChange(error: unknown): boolean {
  return error instanceof ValidationError;
}

/**
 * Check if error should be retried without changes (rate limits, server errors)
 */
function shouldRetryWithoutChange(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status as number;
    return status === 429 || status >= 500;
  }

  return false;
}

/**
 * Update arguments for retry with error context
 */
function updateArgsForRetry(error: FailedAttemptError, args: PromptArgs) {
  args.input = [
    {
      role: "system",
      content:
        "The following error occurred during previous analysis: " +
        String(error) +
        " Please retry with this context.",
    },
    ...args.input,
  ];
  args.model = FALLBACK_MODEL;
}

/**
 * Handle failed attempt logic
 */
function handleFailedAttempt(
  error: FailedAttemptError,
  args: PromptArgs,
  spinner: Ora,
  retriesNumber: number
) {
  if (shouldRetryWithoutChange(error)) {
    warn(
      `Retrying (${error.attemptNumber}/${retriesNumber})... - ${error.message}`,
      spinner
    );
  } else if (shouldRetryWithChange(error)) {
    warn(
      `Retrying with changed args (${error.attemptNumber}/${retriesNumber})... - ${error.message}`,
      spinner
    );
    updateArgsForRetry(error, args);
  } else {
    throw new AbortError(error instanceof Error ? error : String(error));
  }
}

/**
 * Run function with retry logic
 */
export async function runWithRetries(
  fn: (args: PromptArgs) => Promise<unknown>,
  args: PromptArgs,
  spinner: Ora,
  retriesNumber: number
) {
  return pRetry(() => fn(args), {
    retries: retriesNumber,
    onFailedAttempt: (error) =>
      handleFailedAttempt(error, args, spinner, retriesNumber),
  });
}
