import { JsonLdEntity, JsonLdSchema, JsonLdProperty, WrappedRequiredField } from "./types.js";

/**
 * Preprocess schema to wrap required fields
 */
export function preprocessRequiredFields(schema: JsonLdSchema): JsonLdSchema {
  const newSchema = JSON.parse(JSON.stringify(schema));
  for (const entity of Object.values(newSchema.entities) as JsonLdEntity[]) {
    for (const [key, prop] of Object.entries(entity.properties) as [
      string,
      JsonLdProperty
    ][]) {
      if ((prop as JsonLdProperty).required === true) {
        entity.properties[key] = {
          type: "object",
          properties: {
            value: { ...(prop as JsonLdProperty), required: undefined },
            present: {
              type: "boolean",
              description:
                "Shows whether the field was found in the input data",
            },
          },
          required: true,
          description:
            (prop as JsonLdProperty).description || "Required field wrapper",
        };
      }
    }
  }
  return newSchema;
}

/**
 * Clean up required field wrappers from an entity
 */
function cleanupRequiredFields(
  entity: Record<string, unknown>,
  originalEntityDef: JsonLdEntity
): Record<string, unknown> {
  const processed: Record<string, unknown> = {};
  for (const [key, propDef] of Object.entries(originalEntityDef.properties)) {
    const field = entity[key];
    const isWrappedField =
      propDef.required === true &&
      field &&
      typeof field === "object" &&
      "present" in field &&
      "value" in field;
    if (isWrappedField) {
      const wrappedField = field as WrappedRequiredField;
      let value = wrappedField.value;
      const present = wrappedField.present;
      if (!present) {
        value = null;
      }
      processed[key] = value;
    } else {
      processed[key] = field;
    }
  }
  return processed;
}

/**
 * Clean up required field wrappers from batch of results
 */
export function batchCleanupRequiredFields(
  results: Record<string, unknown>[],
  originalSchema: JsonLdSchema
): Record<string, unknown>[] {
  const processedResults: Record<string, unknown>[] = [];
  for (const result of results) {
    const processed: Record<string, unknown> = {};
    for (const [entityName, entityDef] of Object.entries(
      originalSchema.entities
    )) {
      if (Array.isArray(result[entityName])) {
        processed[entityName] = (
          result[entityName] as Record<string, unknown>[]
        ).map((entity) => cleanupRequiredFields(entity, entityDef));
      } else if (result[entityName]) {
        processed[entityName] = cleanupRequiredFields(
          result[entityName] as Record<string, unknown>,
          entityDef
        );
      }
    }
    processed["@context"] = result["@context"];
    processedResults.push(processed);
  }
  return processedResults;
}
