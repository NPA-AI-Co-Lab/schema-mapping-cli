import { readFileSync } from "fs";
import { FileConfig } from "./types.js";

/**
 * Load configuration from JSON file
 */
export function loadConfig(configPath: string): FileConfig {
  const data = JSON.parse(readFileSync(configPath, "utf-8"));

  let dataPath: string;
  let schemaPath: string;
  let configOutputPath: string;
  let enableLogging: boolean;
  let hidePII: boolean;
  let retriesNumber: number;
  let requiredFieldErrorsFailBatch: boolean;

  try {
    dataPath = data.dataPath;
    schemaPath = data.schemaPath;
    configOutputPath = data.outputPath ?? "";
    enableLogging = data.enableLogging ?? false;
    hidePII = data.hidePII ?? true;
    retriesNumber = data.retriesNumber ?? 2;
    requiredFieldErrorsFailBatch = data.requiredFieldErrorsFailBatch ?? true;
  } catch {
    console.log("❌ Invalid configuration file format");
    process.exit(1);
  }

  return {
    dataPath,
    schemaPath,
    configOutputPath,
    enableLogging,
    hidePII,
    retriesNumber,
    requiredFieldErrorsFailBatch,
  };
}
