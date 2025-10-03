import { WrappedRequiredField, ValidationErrorDetails } from "./types.js";
import { isValidObject, buildArrayItemPath, buildFieldPath, shouldSkipField, isWrappedRequiredField } from "./validation-utils.js";

/**
 * Recursively validate object for required fields
 */
export async function validateObjectRecursively(
  obj: unknown,
  batchIndex: number,
  csvRowIndex: number,
  fieldPath: string,
  logValidationError: (error: ValidationErrorDetails) => Promise<void>
): Promise<number> {
  if (!isValidObject(obj)) {
    return 0;
  }

  if (Array.isArray(obj)) {
    return await validateArrayObject(
      obj,
      batchIndex,
      csvRowIndex,
      fieldPath,
      logValidationError
    );
  }

  return await validateRecordObject(
    obj as Record<string, unknown>,
    batchIndex,
    csvRowIndex,
    fieldPath,
    logValidationError
  );
}

/**
 * Validate array object recursively
 */
async function validateArrayObject(
  array: unknown[],
  batchIndex: number,
  csvRowIndex: number,
  fieldPath: string,
  logValidationError: (error: ValidationErrorDetails) => Promise<void>
): Promise<number> {
  let errorCount = 0;

  for (let i = 0; i < array.length; i++) {
    const arrayItemPath = buildArrayItemPath(fieldPath, i);
    errorCount += await validateObjectRecursively(
      array[i],
      batchIndex,
      csvRowIndex,
      arrayItemPath,
      logValidationError
    );
  }

  return errorCount;
}

/**
 * Validate record object recursively
 */
async function validateRecordObject(
  record: Record<string, unknown>,
  batchIndex: number,
  csvRowIndex: number,
  fieldPath: string,
  logValidationError: (error: ValidationErrorDetails) => Promise<void>
): Promise<number> {
  let errorCount = 0;

  for (const [key, value] of Object.entries(record)) {
    if (shouldSkipField(key)) continue;

    const currentPath = buildFieldPath(fieldPath, key);
    errorCount += await validateFieldValue(
      value,
      key,
      currentPath,
      batchIndex,
      csvRowIndex,
      logValidationError
    );
  }

  return errorCount;
}

/**
 * Validate field value (wrapped or regular)
 */
async function validateFieldValue(
  value: WrappedRequiredField | unknown,
  fieldName: string,
  fieldPath: string,
  batchIndex: number,
  csvRowIndex: number,
  logValidationError: (error: ValidationErrorDetails) => Promise<void>
): Promise<number> {
  if (isWrappedRequiredField(value)) {
    return await validateWrappedRequiredField(
      value as WrappedRequiredField,
      fieldName,
      fieldPath,
      batchIndex,
      csvRowIndex,
      logValidationError
    );
  }

  return await validateObjectRecursively(
    value,
    batchIndex,
    csvRowIndex,
    fieldPath,
    logValidationError
  );
}

/**
 * Validate wrapped required field and log error if needed
 */
async function validateWrappedRequiredField(
  wrappedField: WrappedRequiredField,
  fieldName: string,
  fieldPath: string,
  batchIndex: number,
  csvRowIndex: number,
  logValidationError: (error: ValidationErrorDetails) => Promise<void>
): Promise<number> {
  if (!wrappedField.present) {
    await logValidationError({
      batchIndex,
      csvLineStart: csvRowIndex,
      csvLineEnd: csvRowIndex,
      fieldPath,
      errorMessage: `Required field '${fieldName}' is missing or null`,
      expectedType: "non-null value",
      actualValue: null,
      csvRowIndex,
    });
    return 1;
  }

  // Continue validating the inner value if present
  return await validateObjectRecursively(
    wrappedField.value,
    batchIndex,
    csvRowIndex,
    fieldPath,
    logValidationError
  );
}
