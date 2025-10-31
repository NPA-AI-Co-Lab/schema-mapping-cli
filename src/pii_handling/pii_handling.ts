import { basePath, loadJSON, splitValues } from '../utils/index.js';
import path from 'path';
import { detectAndReplacePII } from './regex-detector.js';
import type { EncodingMap, RecordData, AnalysisResult } from './types.js';
import { getOrCreatePlaceholder } from './handle_placeholder.js';

const PII_FIELD_MAP = loadJSON<Record<string, { placeholder: string; multi?: boolean }>>(
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

function encodeDataRow(
  record: RecordData,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): RecordData {
  const newRecord: RecordData = { ...record };

  for (const [key, value] of Object.entries(record)) {
    if (!value || typeof value !== 'string') continue;

    const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
    const fieldConfig = PII_FIELD_MAP[normalizedKey];

    if (fieldConfig) {
      // Handle fields that are explicitly defined in the PII field map
      const { placeholder, multi = false } = fieldConfig;
      newRecord[key] = multi
        ? encodeMultiValueField(value, placeholder, counters, encodingMap)
        : encodeSingleValueField(value, placeholder, counters, encodingMap);
    } else {
      // For fields not in the map, scan for PII patterns using regex
      const processedValue = detectAndReplacePII(value, counters, encodingMap);
      if (processedValue !== value) {
        newRecord[key] = processedValue;
      }
    }
  }
  return newRecord;
}

function createEncodePII() {
  // Persistent counters across all batches
  const globalCounters: Record<string, number> = {};

  return function encodePII(records: RecordData[]): {
    processedBatch: RecordData[];
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
    encodePII: (records: RecordData[]) => ({
      processedBatch: records,
      encodingMap: {},
    }),
    decodePII: (results: AnalysisResult) => results,
  };
}
