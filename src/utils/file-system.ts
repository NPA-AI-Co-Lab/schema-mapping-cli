import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { statSync, accessSync, constants, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const basePath = path.join(__dirname, "..", "..");

/**
 * Load and parse a JSON file
 */
export function loadJSON<T>(filename: string): T {
  const resolvedPath = path.resolve(filename);
  
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load JSON file ${filename}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if a file path exists and is accessible
 */
export function pathExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory is writable
 */
export function isDirectoryWritable(dirPath: string): boolean {
  try {
    accessSync(dirPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and normalize a file path
 */
export function resolvePath(filePath: string): string {
  return path.resolve(filePath);
}
