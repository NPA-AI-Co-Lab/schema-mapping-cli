import path from "path";
import { statSync, accessSync, constants } from "fs";

/**
 * Validate output file path for JSON-LD files
 */
export function validateOutputFile(value: string): true | string {
  const resolvedPath = path.resolve(value);
  const dir = path.dirname(resolvedPath);

  try {
    const stats = statSync(dir);
    if (!stats.isDirectory()) {
      return `Output directory is not valid: ${dir}`;
    }
    accessSync(dir, constants.W_OK);
  } catch {
    return `Output directory does not exist or is not writable: ${dir}`;
  }
  
  const ext = path.extname(resolvedPath).toLowerCase();
  if (ext !== ".jsonld") {
    return `Unsupported output file extension: ${ext}`;
  }

  return true;
}

/**
 * Validate CSV file path
 */
export function validateCSVPath(value: string): true | string {
  const resolvedPath = path.resolve(value);
  
  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return `CSV path must point to a file: ${resolvedPath}`;
    }
    if (path.extname(resolvedPath).toLowerCase() !== ".csv") {
      return `CSV file must have a .csv extension: ${resolvedPath}`;
    }
  } catch {
    return `CSV file does not exist: ${resolvedPath}`;
  }

  return true;
}

/**
 * Validate JSON file path
 */
export function validateJSONPath(value: string): true | string {
  const resolvedPath = path.resolve(value);
  
  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return `JSON path must point to a file: ${resolvedPath}`;
    }
    if (
      ![".json", ".jsonld"].includes(path.extname(resolvedPath).toLowerCase())
    ) {
      return `JSON file must have a .json or .jsonld extension: ${resolvedPath}`;
    }
  } catch {
    return `Invalid JSON path: ${resolvedPath}`;
  }

  return true;
}

/**
 * Split comma-separated values into an array
 */
export function splitValues(value: string): string[] {
  return value
    .split(/[,|;\t]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Check if value is not empty (not null, undefined, or empty string)
 */
export function checkNotEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Check if an object has a specific property
 */
export function checkPropertyExists(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Add item to array if it's missing
 */
export function addIfMissing<T>(array: T[], item: T): T[] {
  return array.includes(item) ? array : [...array, item];
}
