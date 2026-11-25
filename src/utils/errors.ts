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
    this.name = 'ValidationError';

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
    this.name = 'AnalysisError';

    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Custom configuration error class
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly configPath?: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * The configuration no longer matches the one a resumable database was created with, and
 * `resumeMode` is "resume". Re-running the same command fails the same way, so the caller must
 * not suggest it.
 */
export class ConfigChangedError extends ConfigurationError {
  constructor(public readonly databasePath: string) {
    super(
      `The configuration has changed since the database at '${databasePath}' was created, so its ` +
        'progress cannot be resumed (resumeMode is "resume"). To start over, set "resumeMode": ' +
        `"fresh" (or "auto") in the config, or delete '${databasePath}'. To continue the old run, ` +
        'restore the settings it used.'
    );
    this.name = 'ConfigChangedError';
  }
}
