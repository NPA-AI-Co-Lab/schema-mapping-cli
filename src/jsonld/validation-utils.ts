/**
 * Check if object is valid for validation
 */
export function isValidObject(obj: unknown): boolean {
  return obj != null && typeof obj === 'object';
}

/**
 * Check if value is a wrapped required field
 */
export function isWrappedRequiredField(value: unknown): boolean {
  return value != null && typeof value === 'object' && 'present' in value && 'value' in value;
}

/**
 * Check if field should be skipped in validation
 */
export function shouldSkipField(fieldName: string): boolean {
  return fieldName === '@context';
}

/**
 * Build array item path for error reporting
 */
export function buildArrayItemPath(fieldPath: string, index: number): string {
  return fieldPath ? `${fieldPath}[${index}]` : `[${index}]`;
}

/**
 * Build field path for error reporting
 */
export function buildFieldPath(fieldPath: string, key: string): string {
  return fieldPath ? `${fieldPath}.${key}` : key;
}
