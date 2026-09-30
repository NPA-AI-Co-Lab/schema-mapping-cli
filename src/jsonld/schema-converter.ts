import { JsonLdProperty, JsonLdEntity, JsonLdSchema } from './types.js';
import { handleTaxonomyEnum } from './taxonomy.js';

function addNullability(schema: JsonSchema, isRequired: boolean): JsonSchema {
  if (isRequired) {
    return schema;
  }

  // For OpenAI's structured outputs, use 'nullable' property instead of union types
  // OpenAI doesn't support type arrays like ["string", "null"]
  // IMPORTANT: Do NOT add null to enum arrays - OpenAI rejects that!
  // The nullable: true property is sufficient
  schema.nullable = true;

  return schema;
}

/**
 * Convert JSON-LD property to JSON Schema format.
 * `propertyPath` (e.g. `person.demographics.gender`) is only used to name the property in
 * configuration errors such as a missing taxonomy.
 */
export function convertProperty(prop: JsonLdProperty, propertyPath?: string): JsonSchema {
  // Extract JSON-LD specific fields that should not be in JSON Schema
  const { required: isRequired, enumFromTaxonomy, ...jsonSchemaFields } = prop;

  const result: JsonSchema = { ...jsonSchemaFields };

  // Handle taxonomy enums
  if (enumFromTaxonomy) {
    result.enum = handleTaxonomyEnum(prop, propertyPath);
  }

  // Handle nested items (for arrays)
  if (prop.items) {
    result.items = convertProperty(prop.items, propertyPath ? `${propertyPath}[]` : undefined);
  }

  // Handle nested properties (for objects)
  if (prop.properties) {
    const nestedProps: Record<string, unknown> = {};
    const requiredFields: string[] = [];

    for (const [key, value] of Object.entries(prop.properties)) {
      nestedProps[key] = convertProperty(value, propertyPath ? `${propertyPath}.${key}` : key);
      // OpenAI requires all nested fields in required array too
      requiredFields.push(key);
    }

    result.properties = nestedProps;
    result.required = requiredFields;
    result.additionalProperties = false;
  }

  return addNullability(result, isRequired === true);
}

/**
 * Convert JSON-LD entity to JSON schema format
 * For OpenAI's structured outputs: ALL fields must be in required array,
 * with optional fields marked as nullable in the property definition
 */
export function convertEntityToJsonSchema(entity: JsonLdEntity, entityName?: string): JsonSchema {
  const props: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, prop] of Object.entries(entity.properties)) {
    props[key] = convertProperty(prop, entityName ? `${entityName}.${key}` : key);
    // OpenAI requires all fields in required array
    required.push(key);
  }

  return {
    type: 'object',
    properties: props,
    required,
    additionalProperties: false,
  };
}

/**
 * Convert complete JSON-LD schema to JSON schema
 */
export function jsonLdToJsonSchema(jsonLd: JsonLdSchema): {
  definitions: Record<string, unknown>;
} {
  const definitions: Record<string, unknown> = {};

  for (const [entityName, entity] of Object.entries(jsonLd.entities)) {
    definitions[entityName] = convertEntityToJsonSchema(entity, entityName);
  }

  return {
    definitions,
  };
}
