// Export types
export type {
  PIIFieldConfig,
  PIIFieldMap,
  EncodingMap,
  RecordData,
  AnalysisResult,
  PIIHandlers,
} from './types.js';

// Export main PII handling functionality
export { createPIIHandlers } from './pii_handling.js';

// Export regex-based PII detection utilities
export { detectAndReplacePII } from './regex-detector.js';
