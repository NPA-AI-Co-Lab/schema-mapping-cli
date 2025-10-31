import { JsonLdProperty, JsonLdSchema } from '../../jsonld/types.js';
import { SchemaFieldMeta } from './types.js';

function ensureArray<Type>(value: Type | Type[] | undefined): Type[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collectFromProperty(property: JsonLdProperty, path: string, acc: SchemaFieldMeta[]): void {
  const types = ensureArray(property.type).filter(Boolean) as string[];
  const isObject = types.includes('object');
  const isArray = types.includes('array');

  if (isObject && property.properties) {
    // Don't track the parent object itself - just recurse into children.
    // The parent will be implicitly included when any child is included.
    // This avoids conflicts with required field wrapping.
    for (const [childKey, childProp] of Object.entries(property.properties)) {
      const childPath = `${path}.${childKey}`;
      collectFromProperty(childProp, childPath, acc);
    }
    return;
  }

  if (isArray && property.items) {
    const itemTypes = ensureArray(property.items.type).filter(Boolean) as string[];
    const meta: SchemaFieldMeta = {
      path,
      required: property.required === true,
      types: itemTypes.length > 0 ? itemTypes : types,
    };
    acc.push(meta);

    if (property.items.properties) {
      for (const [childKey, childProp] of Object.entries(property.items.properties)) {
        const childPath = `${path}.${childKey}`;
        collectFromProperty(childProp, childPath, acc);
      }
    }

    return;
  }

  const meta: SchemaFieldMeta = {
    path,
    required: property.required === true,
    types: types.length > 0 ? types : ['string'],
  };
  acc.push(meta);
}

export function extractSchemaFields(schema: JsonLdSchema): SchemaFieldMeta[] {
  const result: SchemaFieldMeta[] = [];

  for (const [entityKey, entity] of Object.entries(schema.entities)) {
    for (const [propKey, property] of Object.entries(entity.properties)) {
      const path = `${entityKey}.${propKey}`;
      collectFromProperty(property, path, result);
    }
  }

  return result;
}
