import { validateOutputFile, validateCSVPath, validateJSONPath } from './validation.js';

/**
 * Validate all configuration paths
 */
export function validateConfigPaths(
  dataPaths: string[],
  schemaPath: string,
  outputPath: string
): boolean {
  const errors: string[] = [];

  for (const dataPath of dataPaths) {
    const dataCheck = validateCSVPath(dataPath);
    if (dataCheck !== true) {
      errors.push(`Data file (${dataPath}) error: ${dataCheck}`);
    }
  }

  const schemaCheck = validateJSONPath(schemaPath);
  if (schemaCheck !== true) {
    errors.push(`Schema file error: ${schemaCheck}`);
  }

  const outputCheck = validateOutputFile(outputPath);
  if (outputCheck !== true) {
    errors.push(`Output file error: ${outputCheck}`);
  }

  if (errors.length > 0) {
    errors.forEach((err) => console.error(err));
    return false;
  }
  return true;
}
