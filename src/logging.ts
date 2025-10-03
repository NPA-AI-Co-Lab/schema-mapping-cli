import {appendFile, mkdir, writeFile} from "fs/promises";
import path from "path";
import { loadGlobalConfig, basePath } from "./utils/index.js";
import pLimit from "p-limit";
import { ZodError } from "zod";
import { ValidationErrorDetails } from "./jsonld/index.js";

const LOG_DIR = path.join(basePath, "logging");
const VALIDATION_LOG_DIR = path.join(LOG_DIR, "validation_errors");
const LLM_INPUT_LOG_DIR = path.join(LOG_DIR, "llm_input");
const WRITE_LIMIT = pLimit(1);
const { BATCH_SIZE } = loadGlobalConfig();

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = path.join(LLM_INPUT_LOG_DIR, `llm_input_${timestamp}.log`);
const validationLogFile = path.join(VALIDATION_LOG_DIR, `validation_errors_${timestamp}.log`);

const pendingWrites: Promise<void>[] = [];


async function initLogFile() {
  await mkdir(LLM_INPUT_LOG_DIR, { recursive: true });
  await mkdir(VALIDATION_LOG_DIR, { recursive: true });
  await writeFile(logFile, "");
  await writeFile(validationLogFile, "");
}

await initLogFile();

function asyncAppendFile(filePath: string, data: string) {
  const writePromise = WRITE_LIMIT(() => appendFile(filePath, data));
  pendingWrites.push(writePromise);
  
  writePromise.finally(() => {
    const index = pendingWrites.indexOf(writePromise);
    if (index !== -1) pendingWrites.splice(index, 1);
  });

  return writePromise;
}

function log(batchIndex: number, records: Record<string, string>[]) {
  const startLine = batchIndex * BATCH_SIZE;
  const endLine = startLine + records.length - 1;

  const logEntry = {
    batchIndex,
    lineRange: [startLine, endLine],
    records,
  };

  return asyncAppendFile(logFile, JSON.stringify(logEntry, null, 2) + "\n");
}

function getMeaningfulFieldPath(fieldPath: string): string {
  const pathParts = fieldPath.split('.');
  const isResultsArrayPath = pathParts.length >= 3 && pathParts[0] === 'results' && !isNaN(Number(pathParts[1]));
  
  if (isResultsArrayPath) {
    return pathParts.slice(2).join('.');
  }

  return fieldPath;
}

function logValidationError(errorDetails: ValidationErrorDetails) {
  const meaningfulPath = getMeaningfulFieldPath(errorDetails.fieldPath);
  
  const readableLogEntry = {
    timestamp: new Date().toISOString(),
    error_summary: `${meaningfulPath}: ${errorDetails.errorMessage}`,
    batch_info: {
      batchIndex: errorDetails.batchIndex,
      csvLineRange: `${errorDetails.csvLineStart}-${errorDetails.csvLineEnd}`,
      specificCsvLine: errorDetails.csvRowIndex
    },
    field_details: {
      expectedType: errorDetails.expectedType,
      actualValue: errorDetails.actualValue,
      errorMessage: errorDetails.errorMessage
    }
  };

  return asyncAppendFile(validationLogFile, JSON.stringify(readableLogEntry, null, 2) + "\n");
}

function parseZodError(zodError: ZodError, batchIndex: number, csvLineStart: number, csvLineEnd: number, originalData?: AnalysisResult): ValidationErrorDetails[] {
  const errors: ValidationErrorDetails[] = [];
  
  for (const issue of zodError.issues) {
    const fieldPath = issue.path.join('.');
    let csvRowIndex: number | undefined;

    const canGetRowIndex = issue.path.length >= 2 && issue.path[0] === 'results' && typeof issue.path[1] === 'number';
    if (canGetRowIndex) {
      const resultIndex = issue.path[1] as number;
      csvRowIndex = csvLineStart + resultIndex;
    }

    
    errors.push({
      batchIndex,
      csvLineStart,
      csvLineEnd,
      fieldPath,
      errorMessage: issue.message,
      expectedType: issue.code === 'invalid_type' ? issue.expected : undefined,
      actualValue: originalData && issue.path.length > 0 ? 
        getValueAtPath(issue.path, originalData) : 
        'N/A',
      csvRowIndex
    });
  }
  
  return errors;
}

function getValueAtPath(path: (string | number)[], obj: unknown): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current == null) return undefined;
    
    const isValidObject = typeof current === 'object' && current !== null;
    if (isValidObject) {
      current = (current as Record<string | number, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

async function flushLogs() {
  await Promise.all(pendingWrites);
}

export function createLogger(enableLogging: boolean) {
  return enableLogging
    ? { log, logValidationError, parseZodError, flushLogs }
    : { 
        log: async () => {}, 
        logValidationError: async () => {}, 
        parseZodError: () => [],
        flushLogs: async () => {} 
      };
}
