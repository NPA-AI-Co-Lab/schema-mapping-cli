import { getTaxonomy } from '../../jsonld/taxonomy.js';
import {
  DeterministicFieldResult,
  LoadedRules,
  NormalizedFieldRule,
  SchemaFieldMeta,
} from './types.js';
import { applyTransforms } from './transforms.js';

function evaluateConditions(row: Record<string, string>, rule: NormalizedFieldRule): boolean {
  if (!rule.when.length) {
    return true;
  }

  return rule.when.every((condition) => {
    const value = row[condition.column];

    switch (condition.type) {
      case 'columnExists':
        return Object.prototype.hasOwnProperty.call(row, condition.column);
      case 'notEmpty':
        return value !== undefined && String(value).trim().length > 0;
      case 'equals':
        return value !== undefined && String(value) === condition.value;
      case 'matches':
        return value !== undefined && new RegExp(condition.pattern).test(String(value));
      default:
        return false;
    }
  });
}

function normalizeTaxonomyValue(value: unknown, taxonomyName: string): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  const normalized = new Map<string, string>();
  const entries = getTaxonomy(taxonomyName);
  for (const entry of entries) {
    normalized.set(entry.value.toLowerCase(), entry.value);
    normalized.set(entry.notation.toLowerCase(), entry.value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTaxonomyValue(item, taxonomyName))
      .filter((item) => item !== undefined && item !== null);
  }

  const key = String(value).toLowerCase().trim();
  if (normalized.has(key)) {
    return normalized.get(key);
  }

  return value;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }

  return false;
}

function setValueAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = target;

  for (let index = 0; index < segments.length; index++) {
    const key = segments[index];
    const isLeaf = index === segments.length - 1;

    if (isLeaf) {
      current[key] = value;
      return;
    }

    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }

    current = current[key] as Record<string, unknown>;
  }
}

function hasValueForField(resolvedFields: Set<string>, fieldPath: string): boolean {
  if (resolvedFields.has(fieldPath)) {
    return true;
  }

  // Check parent paths for nested objects so that person.location.postalCode
  // counts towards person.location
  const segments = fieldPath.split('.');
  while (segments.length > 1) {
    segments.pop();
    const candidate = segments.join('.');
    if (resolvedFields.has(candidate)) {
      return true;
    }
  }

  return false;
}

function resolveSourceValue(row: Record<string, string>, source?: string | string[]): unknown {
  if (!source) {
    return undefined;
  }

  if (Array.isArray(source)) {
    for (const column of source) {
      const candidate = row[column];
      if (candidate === undefined || candidate === null) {
        continue;
      }
      if (String(candidate).trim().length === 0) {
        continue;
      }
      return candidate;
    }

    const lastColumn = source[source.length - 1];
    return row[lastColumn];
  }

  return row[source];
}

function evaluateRule(
  row: Record<string, string>,
  fieldPath: string,
  rule: NormalizedFieldRule
): unknown {
  if (!evaluateConditions(row, rule)) {
    return undefined;
  }

  let value = rule.literal;
  if (value === undefined && rule.source) {
    value = resolveSourceValue(row, rule.source);
  }

  if (rule.transforms.length > 0) {
    value = applyTransforms(value, rule.transforms);
  }

  if ((value === undefined || isEmptyValue(value)) && rule.fallback !== undefined) {
    value = rule.fallback;
  }

  if (value === undefined || isEmptyValue(value)) {
    return undefined;
  }

  if (rule.taxonomy) {
    value = normalizeTaxonomyValue(value, rule.taxonomy);
  }

  return value;
}

function ensureRequiredMetadata(
  schemaFields: SchemaFieldMeta[],
  resolvedFields: Set<string>,
  pending: Set<string>,
  missingRequired: Set<string>
): void {
  for (const meta of schemaFields) {
    if (!meta.required) continue;
    if (!hasValueForField(resolvedFields, meta.path)) {
      missingRequired.add(meta.path);
      pending.add(meta.path);
    }
  }
}

export function transformRow(
  row: Record<string, string>,
  rules: LoadedRules
): DeterministicFieldResult {
  const mapped: Record<string, unknown> = {};
  const resolvedFields = new Set<string>();
  const pendingFields = new Set<string>(rules.llmFields);
  const missingRequired = new Set<string>();

  for (const [fieldPath, rule] of rules.fieldRules.entries()) {
    const isRequiredField = rules.requiredFields.has(fieldPath);
    const resolved = evaluateRule(row, fieldPath, rule);

    if (resolved === undefined) {
      if (rules.llmFields.has(fieldPath) || isRequiredField) {
        pendingFields.add(fieldPath);
      }
      continue;
    }

    const valueToStore = isRequiredField ? { value: resolved, present: true } : resolved;

    setValueAtPath(mapped, fieldPath, valueToStore);
    resolvedFields.add(fieldPath);
    // If a value is provided deterministically, remove from pending set.
    if (!rules.llmFields.has(fieldPath)) {
      pendingFields.delete(fieldPath);
    }
  }

  ensureRequiredMetadata(rules.schemaFields, resolvedFields, pendingFields, missingRequired);

  return {
    mapped,
    resolvedFields,
    pendingFields,
    missingRequired,
  };
}
