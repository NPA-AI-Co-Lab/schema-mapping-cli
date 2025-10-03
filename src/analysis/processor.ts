import { ILLMClient, LLMAnalysisRequest } from "../interfaces/llm-client.interface.js";
import { ZodTypeAny, ZodError } from "zod";
import {ValidateResultsArgs} from "./types.js";
import { ValidationErrorDetails } from "../jsonld/index.js";
import { validateLength, validateZodSchema } from "./validation.js";
import { validateRequiredFields, ValidationErrorDetails as JsonLdValidationErrorDetails } from "../jsonld/index.js";

/**
 * Arguments for result decoding
 */
export interface DecodeResultsArgs {
  rawOutput: Record<string, unknown>;
  decodePII: (encodedRecords: Record<string, unknown>, encodingMap: EncodingMap) => Record<string, unknown>;
  encodingMap: EncodingMap;
}

/**
 * Arguments for analysis processing
 */
export interface ProcessBatchArgs {
  llmClient: ILLMClient;
  instructions: string;
  zodSchema: ZodTypeAny;
  batchLength: number;
  index: number;
  input: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  model: string;
  logValidationError?: (error: ValidationErrorDetails) => Promise<void>;
  parseZodError?: (error: ZodError, batchIndex: number, csvLineStart: number, csvLineEnd: number, originalData?: Record<string, unknown>) => ValidationErrorDetails[];
  csvLineStart: number;
  decodePII: (encodedRecords: Record<string, unknown>, encodingMap: EncodingMap) => Record<string, unknown>;
  encodingMap: EncodingMap;
  requiredFieldErrorsFailBatch?: boolean;
}

/**
 * Adapt ValidationErrorDetails from JsonLD format to Analysis format
 */
function adaptValidationError(
  jsonldError: JsonLdValidationErrorDetails, 
  csvLineStart: number, 
  batchSize: number
): ValidationErrorDetails {
  return {
    batchIndex: jsonldError.batchIndex,
    csvLineStart: csvLineStart,
    csvLineEnd: csvLineStart + batchSize - 1,
    fieldPath: jsonldError.fieldPath,
    errorMessage: jsonldError.errorMessage,
    expectedType: jsonldError.expectedType,
    actualValue: jsonldError.actualValue,
    csvRowIndex: jsonldError.csvRowIndex,
  };
}

/**
 * Fetch analysis results using the LLM client
 */
export async function fetchAnalysis(
  llmClient: ILLMClient,
  instructions: string,
  input: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
  model: string,
  zodSchema: ZodTypeAny
): Promise<Record<string, unknown>> {
  const request: LLMAnalysisRequest = {
    instructions,
    input: input.map(msg => ({ role: msg.role as 'user' | 'system' | 'assistant', content: msg.content })),
    model,
    zodSchema,
  };

  const response = await llmClient.analyze(request);
  return response.result;
}

/**
 * Decode PII-protected results
 */
export function decodeResults(args: DecodeResultsArgs): Record<string, unknown> {
  const { rawOutput, decodePII, encodingMap } = args;
  return decodePII(rawOutput, encodingMap);
}

/**
 * Validate analysis results
 */
export async function validateResults(args: ValidateResultsArgs): Promise<Record<string, string>[]> {
  const {
    output,
    zodSchema,
    logValidationError,
    parseZodError,
    index,
    csvLineStart,
    batchLength,
    requiredFieldErrorsFailBatch = false,
  } = args;

  await validateLength({
    output,
    batchLength,
    index,
    csvLineStart,
    logValidationError,
  });

  const canValidate = logValidationError && output.results && Array.isArray(output.results);
  if (canValidate) {
    const adaptedLogValidationError = async (jsonldError: JsonLdValidationErrorDetails) => {
      const analysisError = adaptValidationError(jsonldError, csvLineStart, batchLength);
      await logValidationError!(analysisError);
    };

    await validateRequiredFields(
      output.results as Record<string, unknown>[], 
      index, 
      csvLineStart, 
      adaptedLogValidationError, 
      requiredFieldErrorsFailBatch
    );
  }

  const validatedResults = await validateZodSchema({
    output,
    zodSchema,
    logValidationError,
    parseZodError,
    index,
    csvLineStart,
    batchLength
  });

  return validatedResults;
}

/**
 * Process a single batch of data
 */
export async function processBatch(args: ProcessBatchArgs): Promise<Record<string, unknown>[]> {
  const {
    llmClient,
    instructions,
    zodSchema,
    batchLength,
    index,
    input,
    model,
    logValidationError,
    parseZodError,
    csvLineStart,
    decodePII,
    encodingMap,
    requiredFieldErrorsFailBatch,
  } = args;

  // Fetch analysis from LLM
  const rawOutput = await fetchAnalysis(
    llmClient,
    instructions,
    input,
    model,
    zodSchema
  );

  // Decode PII if needed
  const output = decodeResults({
    rawOutput,
    decodePII,
    encodingMap,
  });

  // Validate results
  const validateArgs: ValidateResultsArgs = {
    output,
    zodSchema,
    logValidationError,
    parseZodError,
    index,
    csvLineStart,
    batchLength,
    requiredFieldErrorsFailBatch,
  };

  return await validateResults(validateArgs);
}
