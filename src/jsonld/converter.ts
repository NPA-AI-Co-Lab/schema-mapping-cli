import { loadJSON } from "../utils/index.js";
import { JsonLdEntity, JsonLdSchema } from "./types.js";

/**
 * Convert single entity data to JSON-LD format
 */
export function convertSingleEntityToJsonLd(
  entityDef: JsonLdEntity,
  entityData: Record<string, unknown>
): Record<string, unknown> {
  const ldEntity: Record<string, unknown> = { "@type": entityDef["@type"] };
  const hasIdProperty = entityDef.idProp && entityData[entityDef.idProp];
  if (hasIdProperty) {
    ldEntity["@id"] = entityData[entityDef.idProp!];
  }
  for (const propName of Object.keys(entityDef.properties)) {
    if (entityData[propName] !== undefined) {
      ldEntity[propName] = entityData[propName];
    }
  }
  return ldEntity;
}

/**
 * Convert array of entities to JSON-LD format
 */
export function convertArrayEntitiesToJsonLd(
  entityDef: JsonLdEntity,
  entityArray: unknown[]
): Record<string, unknown>[] {
  return entityArray.map((item) =>
    convertSingleEntityToJsonLd(entityDef, item as Record<string, unknown>)
  );
}

/**
 * Convert LLM output to JSON-LD format
 */
export function llmOutputToJsonLd(
  jsonLdSchemaPath: string,
  llmOutput: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const jsonLdSchema = loadJSON<JsonLdSchema>(jsonLdSchemaPath);

  for (const entityName of Object.keys(jsonLdSchema.entities)) {
    const entityDef = jsonLdSchema.entities[entityName];
    let entityData = llmOutput[entityName];
    if (Array.isArray(entityData)) {
      result[entityName] = convertArrayEntitiesToJsonLd(entityDef, entityData);
    } else {
      entityData = (entityData || {}) as Record<string, unknown>;
      result[entityName] = convertSingleEntityToJsonLd(
        entityDef,
        entityData as Record<string, unknown>
      );
    }
  }

  result["@context"] = jsonLdSchema["@context"];
  return result;
}
