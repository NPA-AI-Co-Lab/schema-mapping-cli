// Export types
export type { 
  JsonLdProperty, 
  JsonLdEntity, 
  JsonLdSchema, 
  WrappedRequiredField,
  ValidationErrorDetails 
} from './types.js';

// Export taxonomy functions
export { getTaxonomy, handleTaxonomyEnum, clearTaxonomyCache } from './taxonomy.js';

// Export schema conversion functions
export { 
  convertProperty, 
  convertEntityToJsonSchema, 
  jsonLdToJsonSchema 
} from './schema-converter.js';

// Export schema processing functions
export { getLLMSchema } from './schema-processor.js';

// Export converter functions
export { 
  convertSingleEntityToJsonLd, 
  convertArrayEntitiesToJsonLd, 
  llmOutputToJsonLd 
} from './converter.js';

// Export writer functions
export { createJsonLDWriter } from './writer.js';

// Export required fields functions
export { batchCleanupRequiredFields } from './required-fields.js';

// Export validation orchestrator functions
export { validateRequiredFields } from './validation-orchestrator.js';

// Export validation traversal functions
export { validateObjectRecursively } from './validation-traversal.js';

// Export validation utilities
export { 
  isValidObject, 
  isWrappedRequiredField, 
  shouldSkipField, 
  buildArrayItemPath, 
  buildFieldPath 
} from './validation-utils.js';
