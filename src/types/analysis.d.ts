import { ILLMClient } from '../interfaces/llm-client.interface.js';
import { ZodTypeAny } from 'zod';

/**
 * Arguments for fetching analysis results from the LLM API.
 * This interface defines the parameters needed to make a request to the language model
 * for analyzing CSV data according to the provided schema.
 */
export interface FetchAnalysisArgs {
  /** The LLM client instance for making API requests */
  client: ILLMClient;

  /** Instructions/prompt text that will be sent to the LLM */
  instructions: string;

  /** Zod schema used for validating the LLM response structure */
  zodSchema: ZodTypeAny;

  /** Array of prompt messages (user/system roles with content) */
  input: PromptInput[];

  /** The model name to use for the API request (e.g., 'gpt-4') */
  model: string;
}

/**
 * Arguments for decoding PII-protected results back to their original values.
 * This interface handles the transformation of encoded/placeholder values
 * back to the actual sensitive data after LLM processing.
 */
export interface DecodeResultsArgs {
  /** Raw output from the LLM that may contain encoded PII placeholders */
  rawOutput: AnalysisResult;

  /** Function that decodes PII placeholders back to original values */
  decodePII: (encodedRecords: AnalysisResult, encodingMap: EncodingMap) => AnalysisResult;

  /** Mapping of placeholders to original PII values */
  encodingMap: EncodingMap;
}
