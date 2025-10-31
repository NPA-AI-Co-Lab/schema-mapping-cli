/**
 * Type definitions for PII handling module
 */

/**
 * Configuration for a PII field mapping
 */
export interface PIIFieldConfig {
  /** The placeholder pattern to use (e.g., "NAME_{ind}") */
  placeholder: string;
  /** Whether this field can contain multiple values */
  multi?: boolean;
}

/**
 * Mapping of field names to their PII configuration
 */
export type PIIFieldMap = Record<string, PIIFieldConfig>;

/**
 * Mapping of placeholders to their original values
 */
export type EncodingMap = Record<string, string>;

/**
 * A single record of data (key-value pairs)
 */
export type RecordData = Record<string, string>;

/**
 * Result of analysis processing
 */
export type AnalysisResult = Record<string, unknown>;

/**
 * PII processing handlers
 */
export interface PIIHandlers {
  encodePII: (records: RecordData[]) => {
    processedBatch: RecordData[];
    encodingMap: EncodingMap;
  };
  decodePII: (results: AnalysisResult, encodingMap: EncodingMap) => AnalysisResult;
}
