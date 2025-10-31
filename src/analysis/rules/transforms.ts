import { TransformStepConfig } from './types.js';
import { checkPropertyExists } from '../../utils/index.js';

function applyToString(value: unknown, transformer: (input: string) => string): unknown {
  if (typeof value === 'string') {
    return transformer(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? transformer(item) : item));
  }

  return value;
}

function splitValue(
  value: unknown,
  delimiter: string,
  trimItems: boolean,
  filterEmpty: boolean
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  const raw = Array.isArray(value) ? value.join(delimiter) : String(value);
  const parts = raw.split(delimiter);
  const processed = parts.map((part) => (trimItems ? part.trim() : part));

  const filtered = filterEmpty ? processed.filter((part) => part.length > 0) : processed;

  return filtered;
}

function mapValues(
  value: unknown,
  mapping: Record<string, unknown>,
  caseInsensitive: boolean
): unknown {
  const mapKey = (input: string) => (caseInsensitive ? input.toLowerCase() : input);

  const normalizedMapping: Record<string, unknown> = {};
  for (const [key, mapped] of Object.entries(mapping)) {
    normalizedMapping[mapKey(key)] = mapped;
  }

  if (typeof value === 'string') {
    const lookupKey = mapKey(value);
    return checkPropertyExists(normalizedMapping, lookupKey) ? normalizedMapping[lookupKey] : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item !== 'string') return item;
      const lookupKey = mapKey(item);
      return checkPropertyExists(normalizedMapping, lookupKey)
        ? normalizedMapping[lookupKey]
        : item;
    });
  }

  return value;
}

function toNumber(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;

  if (typeof normalized === 'string' && normalized.length === 0) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function secondsToDuration(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const totalSeconds = Math.max(0, Math.round(numeric));
  return `PT${totalSeconds}S`;
}

function filterEmpty(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.filter((item) => {
    if (item === null || item === undefined) return false;
    if (typeof item === 'string') return item.trim().length > 0;
    return true;
  });
}

function uniqueValues(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const seen = new Set<unknown>();
  const result: unknown[] = [];
  for (const item of value) {
    const key = typeof item === 'string' ? item.toLowerCase() : item;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function applyTransforms(initialValue: unknown, steps: TransformStepConfig[]): unknown {
  let current = initialValue;

  for (const step of steps) {
    switch (step.type) {
      case 'trim':
        current = applyToString(current, (value) => value.trim());
        break;
      case 'lowercase':
        current = applyToString(current, (value) => value.toLowerCase());
        break;
      case 'uppercase':
        current = applyToString(current, (value) => value.toUpperCase());
        break;
      case 'split': {
        const { delimiter = ',', trimItems = true, filterEmpty = true } = step;
        current = splitValue(current, delimiter, trimItems, filterEmpty);
        break;
      }
      case 'map':
        current = mapValues(current, step.values, step.caseInsensitive ?? true);
        break;
      case 'toNumber':
        current = toNumber(current);
        break;
      case 'secondsToDuration':
        current = secondsToDuration(current);
        break;
      case 'filterEmpty':
        current = filterEmpty(current);
        break;
      case 'unique':
        current = uniqueValues(current);
        break;
      default:
        break;
    }
  }

  return current;
}
