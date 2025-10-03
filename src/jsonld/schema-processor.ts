import path from "path";
import { loadJSON, basePath } from "../utils/file-system.js";
import { JsonLdSchema } from "./types.js";
import { preprocessRequiredFields } from "./required-fields.js";
import { jsonLdToJsonSchema } from "./schema-converter.js";

const SKELETON_PATH = path.join(basePath, "static", "skeleton.json");

/**
 * Generate LLM schema from JSON-LD schema file
 */
export function getLLMSchema(jsonLdSchemaPath: string): JsonSchema {
  const skeleton = loadJSON<JsonSchema>(SKELETON_PATH);
  const rawJsonLdSchema = loadJSON<JsonLdSchema>(jsonLdSchemaPath);

  const jsonLdSchema = preprocessRequiredFields(rawJsonLdSchema);

  const entities = jsonLdToJsonSchema(jsonLdSchema).definitions;

  const filled = {
    ...skeleton,
    properties: {
      ...(skeleton.properties as Record<string, unknown>),
    },
  };

  filled.properties.results = {
    ...(filled.properties.results as Record<string, unknown>),
    items: {
      type: "object",
      properties: entities as Record<string, unknown>,
      required: Object.keys(entities),
      additionalProperties: false,
    },
  };

  return filled;
}
