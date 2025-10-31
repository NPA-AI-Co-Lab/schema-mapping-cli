export {};

declare global {
  type PromptInput = { role: 'user' | 'system'; content: string };
  type AnalysisResult = {
    [key: string]: unknown;
    results?: unknown[];
  };
  type RecordData = Record<string, string>;
  type JsonSchema = Record<string, unknown>;
  interface OutputRecord {
    person: Person;
    object?: unknown;
    action?: unknown;
    [key: string]: unknown;
  }
  type JsonLdSchema = {
    '@context': Record<string, string>;
    entities: Record<string, JsonLdEntity>;
  };

  /**
   * Mapping of PII placeholders to their original values.
   * Used during encoding/decoding process to protect sensitive data.
   */
  interface EncodingMap {
    [placeholder: string]: string;
  }

  /**
   * Complete arguments needed for processing a batch of CSV data.
   * This interface combines all the necessary components for the full
   * analysis pipeline from input to validated output.
   */
  interface PromptArgs {
    /** LLM client instance for API requests */
    client: import('../interfaces/llm-client.interface.js').ILLMClient;
    /** Instructions/prompt for the LLM */
    instructions: string;
    /** Zod schema for validation and Structured Outputs*/
    zodSchema: ZodTypeAny;
    /** Number of records in the current batch */
    batchLength: number;
    /** Index of the current batch */
    index: number;
    /** Prompt messages for the LLM */
    input: PromptInput[];
    /** Model name to use */
    model: string;
    /** Optional validation error logging function */
    logValidationError?: (error: import('../logging.js').ValidationErrorDetails) => Promise<void>;
    /** Optional Zod error parsing function */
    parseZodError?: (
      zodError: import('zod').ZodError,
      batchIndex: number,
      csvLineStart: number,
      csvLineEnd: number,
      originalData?: undefined,
      originalBatch?: Record<string, string>[]
    ) => import('../logging.js').ValidationErrorDetails[];
    /** Starting CSV line number for this batch */
    csvLineStart: number;
    /** Function to decode PII placeholders */
    decodePII: (encodedRecords: AnalysisResult, encodingMap: EncodingMap) => AnalysisResult;
    /** PII encoding mapping */
    encodingMap: EncodingMap;
    /** Whether required field validation errors should fail the batch */
    requiredFieldErrorsFailBatch: boolean;
  }

  type FetchAnalysisArgs = import('./analysis.js').FetchAnalysisArgs;
  type DecodeResultsArgs = import('./analysis.js').DecodeResultsArgs;
  type ValidateResultsArgs = import('./validation.js').ValidateResultsArgs;
  type ValidateLengthArgs = import('./validation.js').ValidateLengthArgs;
  type ValidateZodSchemaArgs = import('./validation.js').ValidateZodSchemaArgs;
}
