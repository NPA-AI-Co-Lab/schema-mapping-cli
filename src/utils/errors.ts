/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "ValidationError";
    
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Custom analysis error class
 */
export class AnalysisError extends Error {
  constructor(
    message: string,
    public readonly batchIndex?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "AnalysisError";
    
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Custom configuration error class
 */
export class ConfigurationError extends Error {
  constructor(message: string, public readonly configPath?: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
