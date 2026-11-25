/**
 * Defaults shared by every place that builds or completes an AppConfig.
 * Kept in a module of its own (no imports) so any of them can use it without import cycles.
 */

/** Records per LLM request when the config does not set `batchSize`. */
export const DEFAULT_BATCH_SIZE = 5;
/** Concurrent LLM requests when the config does not set `concurrencySize`. */
export const DEFAULT_CONCURRENCY_SIZE = 5;
