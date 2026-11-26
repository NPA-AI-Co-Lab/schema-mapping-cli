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

interface SourceValue {
  value: unknown;
  /** The column the value was read from; undefined when the rule has no `source`. */
  column?: string;
}

function resolveSourceValue(row: Record<string, string>, source?: string | string[]): SourceValue {
  if (!source) {
    return { value: undefined };
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
      return { value: candidate, column };
    }

    const lastColumn = source[source.length - 1];
    return { value: row[lastColumn], column: lastColumn };
  }

  return { value: row[source], column: source };
}

interface RuleResult {
  value: unknown;
  /** The source column the value came from; undefined for a literal or a fallback. */
  column?: string;
}

function evaluateRule(
  row: Record<string, string>,
  fieldPath: string,
  rule: NormalizedFieldRule
): RuleResult {
  if (!evaluateConditions(row, rule)) {
    return { value: undefined };
  }

  let value = rule.literal;
  let column: string | undefined;
  if (value === undefined && rule.source) {
    ({ value, column } = resolveSourceValue(row, rule.source));
  }

  if (rule.transforms.length > 0) {
    value = applyTransforms(value, rule.transforms);
  }

  if ((value === undefined || isEmptyValue(value)) && rule.fallback !== undefined) {
    value = rule.fallback;
    // The fallback replaced whatever the column held, so the column was not used.
    column = undefined;
  }

  if (value === undefined || isEmptyValue(value)) {
    return { value: undefined };
  }

  if (rule.taxonomy) {
    value = normalizeTaxonomyValue(value, rule.taxonomy);
  }

  return { value, column };
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
  const consumedColumns = new Set<string>();

  for (const [fieldPath, rule] of rules.fieldRules.entries()) {
    const isRequiredField = rules.requiredFields.has(fieldPath);
    const { value: resolved, column } = evaluateRule(row, fieldPath, rule);

    if (resolved === undefined) {
      if (rules.llmFields.has(fieldPath) || isRequiredField) {
        pendingFields.add(fieldPath);
      }
      continue;
    }

    const valueToStore = isRequiredField ? { value: resolved, present: true } : resolved;

    setValueAtPath(mapped, fieldPath, valueToStore);
    resolvedFields.add(fieldPath);
    if (column !== undefined) {
      consumedColumns.add(column);
    }
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
    consumedColumns,
  };
}

/**
 * Key under which the LLM input carries the source columns that no rule used. Not a schema
 * field: it exists only in what is sent to the LLM, never in the output.
 */
export const UNMAPPED_SOURCE_KEY = 'unmappedSource';

const ruleColumnsCache = new WeakMap<LoadedRules, Set<string>>();

/** Every column that some rule names as a `source`. */
function ruleSourceColumns(rules: LoadedRules): Set<string> {
  let columns = ruleColumnsCache.get(rules);
  if (!columns) {
    columns = new Set<string>();
    for (const rule of rules.fieldRules.values()) {
      if (!rule.source) continue;
      for (const column of Array.isArray(rule.source) ? rule.source : [rule.source]) {
        columns.add(column);
      }
    }
    ruleColumnsCache.set(rules, columns);
  }
  return columns;
}

/**
 * The record sent to the LLM in rules mode: the rule-mapped record plus, under
 * `unmappedSource`, every source column whose value no rule used for this row (#8). Without it
 * a column with no rule — typically the free text the LLM fields are inferred from, such as
 * `comment` — never reached the LLM.
 *
 * A column is left out when a rule used its value for this row (it is already in the mapped
 * record), or when a rule names it and it is empty (nothing to add). A column no rule names is
 * always included, empty or not: an unanswered survey question is still a question-answer pair.
 *
 * Returns a new object; `prefill.mapped` is merged into the output as is and must not change.
 */
export function buildLlmRecord(
  row: Record<string, unknown>,
  prefill: DeterministicFieldResult,
  rules: LoadedRules
): Record<string, unknown> {
  const ruleColumns = ruleSourceColumns(rules);
  const unmapped: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (prefill.consumedColumns.has(column)) continue;
    if (ruleColumns.has(column) && isEmptyValue(value)) continue;
    unmapped[column] = value;
  }

  if (Object.keys(unmapped).length === 0) {
    return prefill.mapped;
  }
  return { ...prefill.mapped, [UNMAPPED_SOURCE_KEY]: unmapped };
}
