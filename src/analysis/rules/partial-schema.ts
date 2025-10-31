declare global {
  // structuredClone is available in modern Node, but TypeScript might not include it in the lib config.
  function structuredClone<T>(value: T, options?: unknown): T;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isArrayType(schema: JsonSchema): boolean {
  const { type } = schema as { type?: string | string[] };
  if (!type) return false;
  if (Array.isArray(type)) {
    return type.includes('array');
  }
  return type === 'array';
}

function filterRequired(schema: JsonSchema, allowedKeys: Set<string>) {
  if (!schema || !('required' in schema)) {
    return;
  }
  const required = (schema.required as string[] | undefined) ?? [];
  const filtered = required.filter((key) => allowedKeys.has(key));
  if (filtered.length > 0) {
    schema.required = filtered;
  } else {
    delete schema.required;
  }
}

function isRequiredFieldWrapper(schema: JsonSchema): boolean {
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (!props) return false;
  const keys = Object.keys(props);
  return keys.length === 2 && keys.includes('value') && keys.includes('present');
}

function pruneProperty(schema: JsonSchema, paths: string[][]): JsonSchema {
  const clone = deepClone(schema);
  const nestedPaths = paths.filter((path) => path.length > 0);

  if (nestedPaths.length === 0 || (!clone.properties && !clone.items)) {
    return clone;
  }

  if (clone.properties) {
    const allowedKeys = new Set(nestedPaths.map((path) => path[0]));
    for (const key of Object.keys(clone.properties as Record<string, JsonSchema>)) {
      if (!allowedKeys.has(key)) {
        delete (clone.properties as Record<string, JsonSchema>)[key];
      }
    }
    filterRequired(clone, allowedKeys);

    for (const key of allowedKeys) {
      const childPaths = nestedPaths.filter((path) => path[0] === key).map((path) => path.slice(1));
      const child = (clone.properties as Record<string, JsonSchema>)[key];
      if (child) {
        // If this is a required field wrapper {value: ..., present: ...}, unwrap it
        if (isRequiredFieldWrapper(child)) {
          const valueSchema = (child.properties as Record<string, JsonSchema>).value;
          (child.properties as Record<string, JsonSchema>).value = pruneProperty(
            valueSchema,
            childPaths
          );
        } else {
          (clone.properties as Record<string, JsonSchema>)[key] = pruneProperty(child, childPaths);
        }
      }
    }
  }

  if (clone.items) {
    clone.items = pruneProperty(clone.items as JsonSchema, nestedPaths);
  }

  return clone;
}

function pruneEntitySchema(entitySchema: JsonSchema, paths: string[][]): JsonSchema {
  const clone = deepClone(entitySchema);
  if (paths.some((path) => path.length === 0) || !clone.properties) {
    return clone;
  }

  const allowedKeys = new Set(paths.map((path) => path[0]));
  for (const key of Object.keys(clone.properties as Record<string, JsonSchema>)) {
    if (!allowedKeys.has(key)) {
      delete (clone.properties as Record<string, JsonSchema>)[key];
    }
  }
  filterRequired(clone, allowedKeys);

  for (const key of allowedKeys) {
    const childPaths = paths.filter((path) => path[0] === key).map((path) => path.slice(1));

    const childSchema = (clone.properties as Record<string, JsonSchema>)[key];
    if (!childSchema) continue;

    // Handle required field wrappers {value: ..., present: ...}
    if (isRequiredFieldWrapper(childSchema)) {
      const valueSchema = (childSchema.properties as Record<string, JsonSchema>).value;
      (childSchema.properties as Record<string, JsonSchema>).value = pruneProperty(
        valueSchema,
        childPaths
      );
    } else if (isArrayType(childSchema) && childSchema.items) {
      childSchema.items = pruneProperty(childSchema.items as JsonSchema, childPaths);
    } else {
      (clone.properties as Record<string, JsonSchema>)[key] = pruneProperty(
        childSchema,
        childPaths
      );
    }
  }

  return clone;
}

export function buildPartialSchema(fullSchema: JsonSchema, fieldPaths: string[]): JsonSchema {
  if (fieldPaths.length === 0) {
    return deepClone(fullSchema);
  }

  const partialSchema = deepClone(fullSchema);
  const resultsNode = (partialSchema.properties as Record<string, JsonSchema>)
    .results as JsonSchema;
  const resultItems = (resultsNode.items as JsonSchema) ?? {};
  const fullResultItems = (
    (fullSchema.properties as Record<string, JsonSchema>).results as JsonSchema
  ).items as JsonSchema;

  const fullEntityProperties = (fullResultItems.properties ?? {}) as Record<string, JsonSchema>;
  const originalRequired = (fullResultItems.required as string[] | undefined) ?? [];

  const entityMap = new Map<string, string[][]>();
  for (const path of fieldPaths) {
    const segments = path.split('.');
    if (segments.length === 0) continue;
    const [entity, ...rest] = segments;
    if (!fullEntityProperties[entity]) {
      continue;
    }
    if (!entityMap.has(entity)) {
      entityMap.set(entity, []);
    }
    entityMap.get(entity)!.push(rest);
  }

  if (entityMap.size === 0) {
    return partialSchema;
  }

  (resultItems.properties as Record<string, JsonSchema>) = {};
  const itemsRequired: string[] = [];

  for (const [entity, paths] of entityMap.entries()) {
    const sourceSchema = fullEntityProperties[entity];
    const prunedSchema = pruneEntitySchema(sourceSchema, paths);
    (resultItems.properties as Record<string, JsonSchema>)[entity] = prunedSchema;
    if (originalRequired.includes(entity)) {
      itemsRequired.push(entity);
    }
  }

  if (itemsRequired.length > 0) {
    resultItems.required = itemsRequired;
  } else {
    delete resultItems.required;
  }

  return partialSchema;
}
