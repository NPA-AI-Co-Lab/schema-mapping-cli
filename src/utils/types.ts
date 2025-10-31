/**
 * Environment configuration loaded from process.env.
 * Only contains sensitive credentials.
 */
export interface EnvConfig {
  /** OpenAI API key for authentication */
  OPENAI_API_KEY?: string;
}

/**
 * Configuration structure for the application
 */
export interface AppConfig {
  dataPath: string;
  schemaPath: string;
  outputPath: string;
  enableLogging: boolean;
  hidePII: boolean;
  retriesNumber: number;
  requiredFieldErrorsFailBatch: boolean;
  /** Number of CSV records to process in each batch */
  batchSize: number;
  /** Number of concurrent batches to process simultaneously */
  concurrencySize: number;
  /** Primary LLM model to use for analysis */
  defaultModel: string;
  /** Fallback model to use when primary model fails */
  fallbackModel: string;
  /** Column name to use for UUID generation (defaults to email fields if not specified) */
  uuidColumn?: string;
  /** Optional path to deterministic rules configuration */
  rulesPath?: string;
  /** Enable checkpoint system for resume support (default: true) */
  enableCheckpoints?: boolean;
  /** Maximum number of results to keep in memory before flushing (default: 1000) */
  streamingMemoryLimit?: number;
}

/**
 * Configuration from file with optional output path
 */
export interface FileConfig {
  dataPath: string;
  schemaPath: string;
  configOutputPath: string;
  enableLogging: boolean;
  hidePII: boolean;
  retriesNumber: number;
  requiredFieldErrorsFailBatch: boolean;
  /** Column name to use for UUID generation (defaults to email fields if not specified) */
  uuidColumn?: string;
  rulesPath?: string;
}

/**
 * Validation result type - can be true for success or string for error message
 */
export type ValidationResult = true | string;
