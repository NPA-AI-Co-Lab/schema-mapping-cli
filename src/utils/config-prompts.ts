import path from "path";
import { PromptObject } from "prompts";
import { validateOutputFile, validateJSONPath } from "./validation.js";
import { basePath } from "./file-system.js";

/**
 * Generate default output filename
 */
function getDefaultOutputName(): string {
  return `./output_${
    new Date().toISOString().replace(/[:.]/g, "-").split(".")[0]
  }.jsonld`;
}

/**
 * Create configuration file prompt
 */
export function createConfigPrompt(): PromptObject {
  return {
    type: "text" as const,
    initial: "./config.json",
    name: "configPath",
    message:
      "Please enter the path to your configuration file (default: ./config.json)",
    validate: validateJSONPath,
  };
}

/**
 * Create output file prompt
 */
export function createOutputPrompt(): PromptObject {
  const defaultOutputHead = getDefaultOutputName();
  const defaultOutputPath = path.join(basePath, defaultOutputHead);

  return {
    type: "text" as const,
    name: "outputPath",
    initial: defaultOutputPath,
    message: `Please enter the path to your output file (must be .jsonld, default: ${defaultOutputHead})`,
    validate: validateOutputFile,
  };
}
