import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  normalizeConfig,
  validateConfig,
  createConfigHash,
} from '../src/utils/config-normalizer.js';
import { AppConfig } from '../src/utils/types.js';

// Mock the database module
vi.mock('../src/database/index.js', () => ({
  deriveDatabasePath: vi.fn((outputPath: string) => outputPath.replace(/\.[^.]+$/, '.db')),
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((filePath: string) => {
      // Allow the base config paths to pass
      if (
        filePath === 'test.csv' ||
        filePath === 'schema.jsonld' ||
        filePath === 'output.jsonld' ||
        filePath === '.'
      ) {
        return true;
      }
      return false;
    }),
  },
  existsSync: vi.fn((filePath: string) => {
    // Allow the base config paths to pass
    if (
      filePath === 'test.csv' ||
      filePath === 'schema.jsonld' ||
      filePath === 'output.jsonld' ||
      filePath === '.'
    ) {
      return true;
    }
    return false;
  }),
}));

describe('Config Normalizer - Rate Limit Handling', () => {
  const baseConfig: AppConfig = {
    dataPaths: ['test.csv'],
    schemaPath: 'schema.jsonld',
    outputPath: 'output.jsonld',
    enableLogging: false,
    hidePII: false,
    retriesNumber: 2,
    requiredFieldErrorsFailBatch: false,
    batchSize: 5,
    concurrencySize: 5,
    defaultModel: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  };

  describe('normalizeConfig - defaults applied', () => {
    it('should apply default rateLimitMaxRetries (6)', () => {
      const config = { ...baseConfig };
      const normalized = normalizeConfig(config);
      expect(normalized.rateLimitMaxRetries).toBe(6);
    });

    it('should apply default rateLimitMaxWaitMs (90000)', () => {
      const config = { ...baseConfig };
      const normalized = normalizeConfig(config);
      expect(normalized.rateLimitMaxWaitMs).toBe(90000);
    });

    it('should apply default sdkMaxRetries (0)', () => {
      const config = { ...baseConfig };
      const normalized = normalizeConfig(config);
      expect(normalized.sdkMaxRetries).toBe(0);
    });

    it('should apply default adaptiveConcurrency (true)', () => {
      const config = { ...baseConfig };
      const normalized = normalizeConfig(config);
      expect(normalized.adaptiveConcurrency).toBe(true);
    });

    it('should apply default failFast (false)', () => {
      const config = { ...baseConfig };
      const normalized = normalizeConfig(config);
      expect(normalized.failFast).toBe(false);
    });

    it('should preserve user-provided values', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxRetries: 10,
        rateLimitMaxWaitMs: 60000,
        sdkMaxRetries: 4,
        adaptiveConcurrency: false,
        failFast: true,
      };
      const normalized = normalizeConfig(config);
      expect(normalized.rateLimitMaxRetries).toBe(10);
      expect(normalized.rateLimitMaxWaitMs).toBe(60000);
      expect(normalized.sdkMaxRetries).toBe(4);
      expect(normalized.adaptiveConcurrency).toBe(false);
      expect(normalized.failFast).toBe(true);
    });
  });

  describe('validateConfig - range validation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should reject rateLimitMaxRetries < 0', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxRetries: -1,
      };
      expect(() => validateConfig(config)).toThrow('rateLimitMaxRetries must be between 0 and 20');
    });

    it('should reject rateLimitMaxRetries > 20', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxRetries: 21,
      };
      expect(() => validateConfig(config)).toThrow('rateLimitMaxRetries must be between 0 and 20');
    });

    it('should accept rateLimitMaxRetries in valid range', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxRetries: 10,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should reject rateLimitMaxWaitMs < 1000', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxWaitMs: 999,
      };
      expect(() => validateConfig(config)).toThrow(
        'rateLimitMaxWaitMs must be between 1000 and 600000'
      );
    });

    it('should reject rateLimitMaxWaitMs > 600000', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxWaitMs: 600001,
      };
      expect(() => validateConfig(config)).toThrow(
        'rateLimitMaxWaitMs must be between 1000 and 600000'
      );
    });

    it('should accept rateLimitMaxWaitMs in valid range', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxWaitMs: 60000,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should reject sdkMaxRetries < 0', () => {
      const config: AppConfig = {
        ...baseConfig,
        sdkMaxRetries: -1,
      };
      expect(() => validateConfig(config)).toThrow('sdkMaxRetries must be between 0 and 5');
    });

    it('should reject sdkMaxRetries > 5', () => {
      const config: AppConfig = {
        ...baseConfig,
        sdkMaxRetries: 6,
      };
      expect(() => validateConfig(config)).toThrow('sdkMaxRetries must be between 0 and 5');
    });

    it('should accept sdkMaxRetries in valid range', () => {
      const config: AppConfig = {
        ...baseConfig,
        sdkMaxRetries: 4,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should accept boundary values', () => {
      const config: AppConfig = {
        ...baseConfig,
        rateLimitMaxRetries: 0,
        rateLimitMaxWaitMs: 1000,
        sdkMaxRetries: 5,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });
  });
});

describe('Config Normalizer - batchSize / concurrencySize (#9)', () => {
  const baseConfig: AppConfig = {
    dataPaths: ['test.csv'],
    schemaPath: 'schema.jsonld',
    outputPath: 'output.jsonld',
    enableLogging: false,
    hidePII: false,
    retriesNumber: 2,
    requiredFieldErrorsFailBatch: false,
    batchSize: 5,
    concurrencySize: 5,
    defaultModel: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  };

  function without(...keys: (keyof AppConfig)[]): AppConfig {
    const config: Partial<AppConfig> = { ...baseConfig };
    for (const key of keys) delete config[key];
    return config as AppConfig;
  }

  it('defaults both to 5 when they are missing', () => {
    const normalized = normalizeConfig(without('batchSize', 'concurrencySize'));
    expect(normalized.batchSize).toBe(5);
    expect(normalized.concurrencySize).toBe(5);
    expect(() => validateConfig(normalized)).not.toThrow();
  });

  it('defaults each one on its own', () => {
    expect(normalizeConfig(without('batchSize')).batchSize).toBe(5);
    expect(normalizeConfig(without('concurrencySize')).concurrencySize).toBe(5);
  });

  it('treats null like a missing value', () => {
    const config = {
      ...baseConfig,
      batchSize: null,
      concurrencySize: null,
    } as unknown as AppConfig;
    const normalized = normalizeConfig(config);
    expect(normalized.batchSize).toBe(5);
    expect(normalized.concurrencySize).toBe(5);
  });

  it('keeps values that are set', () => {
    const normalized = normalizeConfig({ ...baseConfig, batchSize: 10, concurrencySize: 2 });
    expect(normalized.batchSize).toBe(10);
    expect(normalized.concurrencySize).toBe(2);
  });

  it.each([
    ['batchSize', 0],
    ['batchSize', -1],
    ['batchSize', 2.5],
    ['batchSize', '5'],
    ['batchSize', Number.NaN],
    ['concurrencySize', 0],
    ['concurrencySize', 1.5],
    ['concurrencySize', '5'],
    ['concurrencySize', Number.NaN],
  ])('rejects %s = %s, naming the setting', (key, value) => {
    const config = { ...baseConfig, [key]: value } as unknown as AppConfig;
    expect(() => validateConfig(config)).toThrow(new RegExp(`${key} must be a positive integer`));
  });

  it('reports NaN as NaN and a string with its quotes', () => {
    const withNaN = { ...baseConfig, batchSize: Number.NaN };
    expect(() => validateConfig(withNaN)).toThrow('batchSize must be a positive integer, got NaN');
    const withString = { ...baseConfig, concurrencySize: '5' } as unknown as AppConfig;
    expect(() => validateConfig(withString)).toThrow(
      'concurrencySize must be a positive integer, got "5"'
    );
  });
});

describe('Config Normalizer - hidePII / retriesNumber / logging defaults (#13)', () => {
  const baseConfig: AppConfig = {
    dataPaths: ['test.csv'],
    schemaPath: 'schema.jsonld',
    outputPath: 'output.jsonld',
    enableLogging: false,
    hidePII: false,
    retriesNumber: 2,
    requiredFieldErrorsFailBatch: false,
    batchSize: 5,
    concurrencySize: 5,
    defaultModel: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  };

  function without(...keys: (keyof AppConfig)[]): AppConfig {
    const config: Partial<AppConfig> = { ...baseConfig };
    for (const key of keys) delete config[key];
    return config as AppConfig;
  }

  it('turns PII masking on when hidePII is missing or null', () => {
    expect(normalizeConfig(without('hidePII')).hidePII).toBe(true);
    const withNull = { ...baseConfig, hidePII: null } as unknown as AppConfig;
    expect(normalizeConfig(withNull).hidePII).toBe(true);
  });

  it('keeps an explicit hidePII: false', () => {
    expect(normalizeConfig({ ...baseConfig, hidePII: false }).hidePII).toBe(false);
  });

  it('defaults retriesNumber to 2 and keeps an explicit 0', () => {
    expect(normalizeConfig(without('retriesNumber')).retriesNumber).toBe(2);
    expect(normalizeConfig({ ...baseConfig, retriesNumber: 0 }).retriesNumber).toBe(0);
  });

  it('defaults enableLogging and forceReingestion to false', () => {
    const normalized = normalizeConfig(without('enableLogging'));
    expect(normalized.enableLogging).toBe(false);
    expect(normalized.forceReingestion).toBe(false);
  });

  it('leaves a missing requiredFieldErrorsFailBatch unset, so the config hash does not change', () => {
    const normalized = normalizeConfig(without('requiredFieldErrorsFailBatch'));
    expect(normalized.requiredFieldErrorsFailBatch).toBeUndefined();
  });

  it('hashes a config without hidePII like one with hidePII: true', () => {
    const missing = normalizeConfig(without('hidePII'));
    const explicit = normalizeConfig({ ...baseConfig, hidePII: true });
    expect(createConfigHash(missing)).toBe(createConfigHash(explicit));
  });

  it('a config file with neither hidePII nor retriesNumber validates', () => {
    expect(() =>
      validateConfig(normalizeConfig(without('hidePII', 'retriesNumber')))
    ).not.toThrow();
  });

  it.each([-1, 1.5, '2', Number.NaN])('rejects retriesNumber = %s', (value) => {
    const config = { ...baseConfig, retriesNumber: value } as unknown as AppConfig;
    expect(() => validateConfig(config)).toThrow(/retriesNumber must be a non-negative integer/);
  });
});

describe('Config Normalizer - retry counts must be whole numbers', () => {
  const baseConfig: AppConfig = {
    dataPaths: ['test.csv'],
    schemaPath: 'schema.jsonld',
    outputPath: 'output.jsonld',
    enableLogging: false,
    hidePII: false,
    retriesNumber: 2,
    requiredFieldErrorsFailBatch: false,
    batchSize: 5,
    concurrencySize: 5,
    defaultModel: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  };

  it('rejects a fractional rateLimitMaxRetries (e.g. --rate-limit-retries 2.7)', () => {
    expect(() => validateConfig({ ...baseConfig, rateLimitMaxRetries: 2.7 })).toThrow(
      'rateLimitMaxRetries must be between 0 and 20, got 2.7'
    );
  });

  it('rejects a fractional sdkMaxRetries', () => {
    expect(() => validateConfig({ ...baseConfig, sdkMaxRetries: 1.5 })).toThrow(
      'sdkMaxRetries must be between 0 and 5, got 1.5'
    );
  });
});
