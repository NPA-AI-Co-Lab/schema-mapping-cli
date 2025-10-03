import { JsonLdProperty, JsonLdEntity, JsonLdSchema } from "./types.js";
import { handleTaxonomyEnum } from "./taxonomy.js";

/**
 * Convert JSON-LD property to JSON Schema format
 */
export function convertProperty(prop: JsonLdProperty): JsonSchema {
  const result: JsonSchema = { ...prop };

  if (prop.enumFromTaxonomy) {
    result.enum = handleTaxonomyEnum(prop);
    delete result.enumFromTaxonomy;
  }

  if (prop.items) {
    result.items = convertProperty(prop.items);
  }

  if (prop.properties) {
    const nestedProps: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(prop.properties)) {
      nestedProps[key] = convertProperty(value);
      required.push(key);
    }

    result.properties = nestedProps;
    result.required = required;
    result.additionalProperties = false;
  }

  return result;
}

/**
 * Convert JSON-LD entity to JSON schema format
 */
export function convertEntityToJsonSchema(entity: JsonLdEntity): JsonSchema {
  const props: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, prop] of Object.entries(entity.properties)) {
    props[key] = convertProperty(prop);
    required.push(key);
  }

  return {
    type: "object",
    properties: props,
    required,
    additionalProperties: false,
  };
}

/**
 * Convert complete JSON-LD schema to JSON schema
 */
export function jsonLdToJsonSchema(jsonLd: JsonLdSchema): { definitions: Record<string, unknown> } {
  const definitions: Record<string, unknown> = {};

  for (const [entityName, entity] of Object.entries(jsonLd.entities)) {
    definitions[entityName] = convertEntityToJsonSchema(entity);
  }

  return {
    definitions,
  };
}
