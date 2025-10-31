import { JsonLdSchema } from '../../jsonld/types.js';

export type TransformStepConfig =
  | { type: 'trim' }
  | { type: 'lowercase' }
  | { type: 'uppercase' }
  | {
      type: 'split';
      delimiter?: string;
      trimItems?: boolean;
      filterEmpty?: boolean;
    }
  | {
      type: 'map';
      values: Record<string, unknown>;
      caseInsensitive?: boolean;
    }
  | { type: 'toNumber' }
  | { type: 'secondsToDuration' }
  | { type: 'filterEmpty' }
  | { type: 'unique' };

export type TransformConfig = Array<TransformStepConfig | string>;

export type ConditionConfig =
  | { type: 'columnExists'; column: string }
  | { type: 'notEmpty'; column: string }
  | { type: 'equals'; column: string; value: string }
  | { type: 'matches'; column: string; pattern: string };

export interface FieldRuleConfig {
  /** Input column name to read value from */
  source?: string | string[];
  /** Literal value to use regardless of input */
  literal?: unknown;
  /** Sequence of transforms to apply */
  transforms?: TransformConfig;
  /** Optional taxonomy enum to normalize against */
  taxonomy?: string;
  /** Fallback value when the resolved value is empty */
  fallback?: unknown;
  /** Conditional checks to determine whether the rule should run */
  when?: ConditionConfig[];
  /** Reserved hook for custom resolver functions */
  custom?: string;
}

export interface RulesLLMConfig {
  /** When true, every field uses the LLM unless explicitly excluded. */
  default?: boolean;
  /** Field paths to toggle relative to the default. */
  fields?: string[];
}

export interface RulesConfig {
  /** Path to the JSON-LD schema this rule set targets */
  schema: string;
  /** Optional metadata about supported sources */
  sources?: Array<{ path: string; dataSource?: string }>;
  /** LLM usage preferences */
  llm?: RulesLLMConfig;
  /** Field-level rule definitions */
  fields: Record<string, FieldRuleConfig>;
}

export interface SchemaFieldMeta {
  path: string;
  required: boolean;
  types: string[];
}

export interface NormalizedFieldRule {
  source?: string | string[];
  literal?: unknown;
  transforms: TransformStepConfig[];
  taxonomy?: string;
  fallback?: unknown;
  when: ConditionConfig[];
  custom?: string;
}

export interface LoadedRules {
  rulesPath: string;
  schemaPath: string;
  llmFields: Set<string>;
  fieldRules: Map<string, NormalizedFieldRule>;
  schemaFields: SchemaFieldMeta[];
  requiredFields: Set<string>;
  schema: JsonLdSchema;
}

export interface LlmFieldOverrides {
  include?: string[];
  exclude?: string[];
}

export interface DeterministicFieldResult {
  mapped: Record<string, unknown>;
  resolvedFields: Set<string>;
  pendingFields: Set<string>;
  missingRequired: Set<string>;
}
