import {
  ZodTypeAny,
  ZodObject,
  ZodString,
  ZodArray,
  ZodNumber,
  ZodEnum,
} from "zod";

/**
 * JSON Schema interface for type safety
 */
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
}

/**
 * Apply nullability to Zod schema based on JSON schema type
 */
function applyNullability(zodObj: ZodTypeAny, schema: JsonSchema): ZodTypeAny {
  const isNullable = Array.isArray(schema.type) && schema.type.includes("null");
  return isNullable ? zodObj.nullable() : zodObj;
}

/**
 * Apply email format validation to Zod string
 */
function applyEmailFormat(
  zodString: ZodString,
  isRequired: boolean
): ZodTypeAny {
  if (isRequired) {
    return zodString.min(1, "Email is required").email();
  }
  return zodString.email();
}

/**
 * Fix Zod object schema from JSON schema
 */
function fixZodObjectFromSchema(
  zodObj: ZodObject<Record<string, ZodTypeAny>>,
  schema: JsonSchema
): ZodTypeAny {
  const shape = zodObj.shape;
  const updatedShape: Record<string, ZodTypeAny> = {};

  for (const [key, zodProp] of Object.entries(shape)) {
    const jsonProp = schema.properties?.[key] as JsonSchema | undefined;
    if (jsonProp) {
      updatedShape[key] = fixZodFromJsonSchema(jsonProp, zodProp as ZodTypeAny);
    } else {
      updatedShape[key] = zodProp as ZodTypeAny;
    }
  }

  const updated = zodObj.extend(updatedShape);
  return applyNullability(updated, schema);
}

/**
 * Fix Zod string schema from JSON schema
 */
function fixZodStringFromSchema(
  zodString: ZodString,
  schema: JsonSchema
): ZodTypeAny {
  let updated = zodString;

  if (schema.format === "email") {
    const isRequired = !Array.isArray(schema.type) || !schema.type.includes("null");
    updated = applyEmailFormat(updated, isRequired) as ZodString;
  }

  if (typeof schema.minLength === "number") {
    updated = updated.min(schema.minLength);
  }

  if (typeof schema.maxLength === "number") {
    updated = updated.max(schema.maxLength);
  }

  return applyNullability(updated, schema);
}

/**
 * Fix Zod array schema from JSON schema
 */
function fixZodArrayFromSchema(
  zodArray: ZodArray<ZodTypeAny>,
  schema: JsonSchema
): ZodTypeAny {
  let updated = zodArray;

  if (typeof schema.minItems === "number") {
    updated = updated.min(schema.minItems);
  }

  if (typeof schema.maxItems === "number") {
    updated = updated.max(schema.maxItems);
  }

  return applyNullability(updated, schema);
}

/**
 * Fix Zod number schema from JSON schema
 */
function fixZodNumberFromSchema(
  zodNumber: ZodNumber,
  schema: JsonSchema
): ZodTypeAny {
  let updated = zodNumber;

  if (typeof schema.minimum === "number") {
    updated = updated.min(schema.minimum);
  }

  if (typeof schema.maximum === "number") {
    updated = updated.max(schema.maximum);
  }

  return applyNullability(updated, schema);
}

/**
 * Fix Zod enum schema from JSON schema
 */
function fixZodEnumFromSchema(
  zodObj: ZodEnum<[string, ...string[]]>,
  schema: JsonSchema
): ZodTypeAny {
  return applyNullability(zodObj, schema);
}

/**
 * Fix Zod schema from JSON schema recursively
 */
export function fixZodFromJsonSchema(
  schema: JsonSchema,
  zodObj: ZodTypeAny
): ZodTypeAny {
  if (zodObj instanceof ZodObject) {
    return fixZodObjectFromSchema(zodObj, schema);
  }

  if (zodObj instanceof ZodString) {
    return fixZodStringFromSchema(zodObj, schema);
  }

  if (zodObj instanceof ZodArray) {
    return fixZodArrayFromSchema(zodObj, schema);
  }

  if (zodObj instanceof ZodNumber) {
    return fixZodNumberFromSchema(zodObj, schema);
  }

  if (zodObj instanceof ZodEnum) {
    return fixZodEnumFromSchema(zodObj, schema);
  }

  return applyNullability(zodObj, schema);
}
