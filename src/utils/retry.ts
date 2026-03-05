import pRetry, { AbortError, FailedAttemptError } from 'p-retry';
import { Ora } from 'ora';
import { ValidationError } from './errors.js';
import { warn } from './ui.js';
import { loadGlobalConfig } from './config.js';
import { setCurrentAttemptNumber, clearCurrentAttemptNumber } from './retry-context.js';
import { RetryAttemptDetails } from '../logging.js';

const { FALLBACK_MODEL } = loadGlobalConfig();

/**
 * Arguments for prompt/analysis functions
 */
export interface PromptArgs {
  input: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  model: string;
  index?: number;
  csvLineStart?: number;
  batchLength?: number;
  logRetryAttempt?: (details: RetryAttemptDetails) => Promise<void>;
  [key: string]: unknown;
}

/**
 * Determine error type for logging
 */
function getErrorType(error: unknown): RetryAttemptDetails['errorType'] {
  if (error instanceof ValidationError) {
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('required field')) {
      return 'required_field_error';
    }
    return 'validation_error';
  }

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status as number;
    if (status === 429 || status >= 500) {
      return 'api_error';
    }
  }

  return 'network_error';
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
  if (error && typeof error === 'object' && 'status' in error) {
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
      role: 'system',
      content:
        'The following error occurred during previous analysis: ' +
        String(error) +
        ' Please retry with this context.',
    },
    ...args.input,
  ];
  args.model = FALLBACK_MODEL;
}

/**
 * Handle failed attempt logic
 */
async function handleFailedAttempt(
  error: FailedAttemptError,
  args: PromptArgs,
  spinner: Ora,
  retriesNumber: number
) {
  const retryAttempt = error.attemptNumber - 1;
  const errorType = getErrorType(error);
  let actionTaken: RetryAttemptDetails['actionTaken'];

  if (shouldRetryWithoutChange(error)) {
    warn(`Retrying (${retryAttempt}/${retriesNumber})... - ${error.message}`, spinner);
    actionTaken = 'retry_same';
  } else if (shouldRetryWithChange(error)) {
    warn(
      `Retrying with changed args (${retryAttempt}/${retriesNumber})... - ${error.message}`,
      spinner
    );
    updateArgsForRetry(error, args);
    actionTaken = args.model === FALLBACK_MODEL ? 'retry_with_fallback' : 'retry_with_context';
  } else {
    actionTaken = 'failed';

    // Log final failure before throwing
    if (
      args.logRetryAttempt &&
      typeof args.index === 'number' &&
      typeof args.csvLineStart === 'number' &&
      typeof args.batchLength === 'number'
    ) {
      const csvLineEnd = args.csvLineStart + args.batchLength - 1;
      await args.logRetryAttempt({
        batchIndex: args.index,
        csvLineRange: `${args.csvLineStart}-${csvLineEnd}`,
        attemptNumber: error.attemptNumber,
        totalRetries: retriesNumber,
        errorType,
        errorMessage: error.message,
        actionTaken,
      });
    }

    console.error(`❌ Skipping batch index ${args.index} due to LLM error:`, error.message);

    throw new AbortError(error instanceof Error ? error : String(error));
  }

  // Log retry attempt
  if (
    args.logRetryAttempt &&
    typeof args.index === 'number' &&
    typeof args.csvLineStart === 'number' &&
    typeof args.batchLength === 'number'
  ) {
    const csvLineEnd = args.csvLineStart + args.batchLength - 1;
    await args.logRetryAttempt({
      batchIndex: args.index,
      csvLineRange: `${args.csvLineStart}-${csvLineEnd}`,
      attemptNumber: error.attemptNumber,
      totalRetries: retriesNumber,
      errorType,
      errorMessage: error.message,
      actionTaken,
      fallbackModel: actionTaken === 'retry_with_fallback' ? args.model : undefined,
    });
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
  const batchIndex = 'index' in args ? (args.index as number) : -1;

  try {
    return await pRetry(
      async (attemptNumber) => {
        setCurrentAttemptNumber(batchIndex, attemptNumber);
        return await fn(args);
      },
      {
        retries: retriesNumber,
        onFailedAttempt: (error) => handleFailedAttempt(error, args, spinner, retriesNumber),
      }
    );
  } finally {
    clearCurrentAttemptNumber(batchIndex);
  }
}
