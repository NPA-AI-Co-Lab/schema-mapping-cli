import { basePath, loadJSON, splitValues } from "./utils/index.js";
import path from "path";

const PII_FIELD_MAP = loadJSON<
  Record<string, { placeholder: string; multi?: boolean }>
>(path.resolve(basePath, "static", "pii_field_map.json"));

function encodeMultiValueField(
  value: string,
  placeholder: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  const values = splitValues(value);
  const placeholders: string[] = [];

  for (const singleValue of values) {
    counters[placeholder] = (counters[placeholder] ?? 0) + 1;
    const newPlaceholder = placeholder.replace(
      "{ind}",
      String(counters[placeholder])
    );
    placeholders.push(newPlaceholder);
    encodingMap[newPlaceholder] = singleValue;
  }

  return placeholders.join(", ");
}

function encodeSingleValueField(
  value: string,
  placeholder: string,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): string {
  counters[placeholder] = (counters[placeholder] ?? 0) + 1;
  const newPlaceholder = placeholder.replace(
    "{ind}",
    String(counters[placeholder])
  );
  encodingMap[newPlaceholder] = value;
  return newPlaceholder;
}

function encodeDataRow(
  record: RecordData,
  counters: Record<string, number>,
  encodingMap: EncodingMap
): RecordData {
  const newRecord: RecordData = { ...record };

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
    const fieldConfig = PII_FIELD_MAP[normalizedKey];
    const shouldEncodeField = fieldConfig && value;

    if (shouldEncodeField) {
      const { placeholder, multi = false } = fieldConfig;

      newRecord[key] = multi
        ? encodeMultiValueField(value, placeholder, counters, encodingMap)
        : encodeSingleValueField(value, placeholder, counters, encodingMap);
    }
  }
  return newRecord;
}

function encodePII(records: RecordData[]): {
  processedBatch: RecordData[];
  encodingMap: EncodingMap;
} {
  const encodingMap: EncodingMap = {};
  const counters: Record<string, number> = {};

  const processedBatch = records.map((record) =>
    encodeDataRow(record, counters, encodingMap)
  );

  return { processedBatch, encodingMap };
}

function buildDecodeRegex(encodingMap: EncodingMap): RegExp | null {
  const keys = Object.keys(encodingMap);
  if (keys.length === 0) return null;
  const sortedKeys = keys.sort((a, b) => b.length - a.length);
  const escaped = sortedKeys.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`(${escaped.join("|")})`, "g");
}

function decodePlaceholder(
  value: unknown,
  regex: RegExp,
  encodingMap: EncodingMap,
  depth: number = 0
): unknown {
  if (depth > 100) {
    console.warn("PII decoding: Maximum recursion depth reached");
    return value;
  }

  if (typeof value === "string") {
    return value.replace(regex, (match) => encodingMap[match] ?? match);
  }
  
  if (Array.isArray(value)) {
    return value.map((item) =>
      decodePlaceholder(item, regex, encodingMap, depth + 1)
    );
  }
  
  const isNonNullObject = value !== null && typeof value === "object";
  if (isNonNullObject) {
    const decodedObject: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      decodedObject[key] = decodePlaceholder(
        val,
        regex,
        encodingMap,
        depth + 1
      );
    }
    return decodedObject;
  }
  return value;
}

function decodePII(
  encodedRecords: AnalysisResult,
  encodingMap: EncodingMap
): AnalysisResult {
  const regex = buildDecodeRegex(encodingMap);
  if (!regex) return encodedRecords;

  const decodedRecord: AnalysisResult = {};
  for (const [key, value] of Object.entries(encodedRecords)) {
    decodedRecord[key] = decodePlaceholder(value, regex, encodingMap);
  }
  return decodedRecord;
}

export function createPIIHandlers(enablePiiProcessing: boolean) {
  return enablePiiProcessing
    ? { encodePII, decodePII }
    : {
        encodePII: (records: RecordData[]) => ({
          processedBatch: records,
          encodingMap: {},
        }),
        decodePII: (results: AnalysisResult) => results,
      };
}
