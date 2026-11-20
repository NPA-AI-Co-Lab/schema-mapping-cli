import { basePath, loadJSON, splitValues } from '../utils/index.js';
import path from 'path';
import { detectAndReplacePII } from './regex-detector.js';
import type { EncodingMap, AnalysisResult, PIIFieldConfig } from './types.js';
import { getOrCreatePlaceholder } from './handle_placeholder.js';

const PII_FIELD_MAP = loadJSON<Record<string, PIIFieldConfig>>(
  path.resolve(basePath, 'static', 'pii_field_map.json')
);

function encodeMultiValueField(
  value: string,
  placeholder: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  const values = splitValues(value);
  const placeholders: string[] = [];

  for (const singleValue of values) {
    const newPlaceholder = getOrCreatePlaceholder(singleValue, placeholder, counters, encodingMap);
    placeholders.push(newPlaceholder);
  }

  return placeholders.join(', ');
}

function encodeSingleValueField(
  value: string,
  placeholder: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  return getOrCreatePlaceholder(value, placeholder, counters, encodingMap);
}

const MAX_ENCODE_DEPTH = 100;

function lookupFieldConfig(key: string): PIIFieldConfig | undefined {
  const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
  return PII_FIELD_MAP[normalizedKey];
}

/**
 * Required schema fields are carried as `{ value, present }` by the deterministic rules
 * (see `transformRow`). The wrapper is transparent for masking: its `value` is treated as
 * if it sat directly under the wrapped field's own name.
 */
function isRequiredFieldWrapper(value: object): value is { value: unknown; present: boolean } {
  return 'value' in value && typeof (value as { present?: unknown }).present === 'boolean';
}

function encodeString(
  value: string,
  fieldConfig: PIIFieldConfig | undefined,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  if (!value) return value;

  if (fieldConfig) {
    // Handle fields that are explicitly defined in the PII field map
    const { placeholder, multi = false } = fieldConfig;
    return multi
      ? encodeMultiValueField(value, placeholder, counters, encodingMap)
      : encodeSingleValueField(value, placeholder, counters, encodingMap);
  }

  // For fields not in the map, scan for PII patterns using regex
  return detectAndReplacePII(value, counters, encodingMap);
}

/**
 * Mask one value of a record, however deep it sits.
 *
 * A raw CSV row is flat (`{ primaryEmail: '…' }`), but in rules mode the record that goes to
 * the LLM is the rule-mapped one: nested (`{ person: { primaryEmail, location: { postalCode } } }`),
 * with arrays (`additionalEmails` after a `split` transform) and `{ value, present }` wrappers
 * around required fields. Every string in that tree has to be masked, so this walks all of it.
 *
 * `fieldConfig` is the PII field map entry of the nearest enclosing key that has one: array
 * items, a required-field wrapper's `value` and the properties of an object stored under a PII
 * key are all masked with that key's placeholder. Strings with no such key are regex-scanned.
 * Always returns new containers; the input is never mutated (in rules mode it is the
 * deterministic prefill, which is merged into the output as-is).
 */
function encodeValue(
  value: unknown,
  fieldConfig: PIIFieldConfig | undefined,
  counters: Record<string, number>,
  encodingMap: EncodingMap,
  depth: number
): unknown {
  if (depth > MAX_ENCODE_DEPTH) {
    throw new Error('PII encoding: maximum nesting depth exceeded; refusing to send unmasked data');
  }

  if (typeof value === 'string') {
    return encodeString(value, fieldConfig, counters, encodingMap);
  }

  // A number under a PII key (e.g. a postal code after `toNumber`) is still PII.
  if (fieldConfig && (typeof value === 'number' || typeof value === 'bigint')) {
    return encodeSingleValueField(String(value), fieldConfig.placeholder, counters, encodingMap);
  }

  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item, fieldConfig, counters, encodingMap, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    if (isRequiredFieldWrapper(value)) {
      return {
        ...value,
        value: encodeValue(value.value, fieldConfig, counters, encodingMap, depth + 1),
      };
    }

    const encoded: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childConfig = lookupFieldConfig(key) ?? fieldConfig;
      encoded[key] = encodeValue(child, childConfig, counters, encodingMap, depth + 1);
    }
    return encoded;
  }

  return value;
}

function encodeDataRow<T extends Record<string, unknown>>(
  record: T,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): T {
  return encodeValue(record, undefined, counters, encodingMap, 0) as T;
}

function createEncodePII() {
  // Persistent counters across all batches
  const globalCounters: Record<string, number> = {};

  return function encodePII<T extends Record<string, unknown>>(
    records: T[]
  ): {
    processedBatch: T[];
    encodingMap: EncodingMap;
  } {
    const encodingMap: EncodingMap = {};

    const processedBatch = records.map((record) =>
      encodeDataRow(record, globalCounters, encodingMap)
    );

    return { processedBatch, encodingMap };
  };
}

function buildDecodeRegex(encodingMap: EncodingMap): RegExp | null {
  const keys = Object.keys(encodingMap);
  if (keys.length === 0) return null;
  const sortedKeys = keys.sort((a, b) => b.length - a.length);
  const escaped = sortedKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'g');
}

function decodePlaceholder(
  value: unknown,
  regex: RegExp,
  encodingMap: EncodingMap,
  depth: number = 0
): unknown {
  if (depth > 100) {
    console.warn('PII decoding: Maximum recursion depth reached');
    return value;
  }

  if (typeof value === 'string') {
    return value.replace(regex, (match) => encodingMap[match] ?? match);
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodePlaceholder(item, regex, encodingMap, depth + 1));
  }

  const isNonNullObject = value !== null && typeof value === 'object';
  if (isNonNullObject) {
    const decodedObject: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      decodedObject[key] = decodePlaceholder(val, regex, encodingMap, depth + 1);
    }
    return decodedObject;
  }
  return value;
}

function decodePII(encodedRecords: AnalysisResult, encodingMap: EncodingMap): AnalysisResult {
  const regex = buildDecodeRegex(encodingMap);
  if (!regex) return encodedRecords;

  const decodedRecord: AnalysisResult = {};
  for (const [key, value] of Object.entries(encodedRecords)) {
    decodedRecord[key] = decodePlaceholder(value, regex, encodingMap);
  }
  return decodedRecord;
}

export function createPIIHandlers(enablePiiProcessing: boolean) {
  if (enablePiiProcessing) {
    return {
      encodePII: createEncodePII(),
      decodePII,
    };
  }
  return {
    encodePII: <T extends Record<string, unknown>>(records: T[]) => ({
      processedBatch: records,
      encodingMap: {},
    }),
    decodePII: (results: AnalysisResult) => results,
  };
}
