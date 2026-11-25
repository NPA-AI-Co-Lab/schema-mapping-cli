import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseIntegerOption,
  numericFlagErrors,
  numericFlagOverrides,
  validateOptions,
} from '../src/cli/cli-config.js';
import { validateConfig } from '../src/utils/config-normalizer.js';
import type { CliOptions } from '../src/cli/cli-types.js';
import type { AppConfig } from '../src/utils/types.js';

describe('parseIntegerOption', () => {
  it.each([
    ['5', 5],
    [' 10 ', 10],
    ['0', 0],
    ['600000', 600000],
  ])('parses %j as %d', (input, expected) => {
    expect(parseIntegerOption(input)).toBe(expected);
  });

  it.each(['2.7', '5abc', '5000abc', '0x10', '1e1', '-1', '+5', 'abc', '', '  '])(
    'turns %j into NaN instead of a truncated or reinterpreted number',
    (input) => {
      expect(parseIntegerOption(input)).toBeNaN();
    }
  );
});

describe('numericFlagErrors: every numeric flag, one message format', () => {
  it.each([
    [{ batchSize: '2.7' }, '--batch-size must be a whole number between 1 and 50, got "2.7"'],
    [{ batchSize: '0x10' }, '--batch-size must be a whole number between 1 and 50, got "0x10"'],
    [{ batchSize: '' }, '--batch-size must be a whole number between 1 and 50, got ""'],
    [{ concurrency: '1.5' }, '--concurrency must be a whole number between 1 and 20, got "1.5"'],
    [{ retries: '1e1' }, '--retries must be a whole number between 0 and 10, got "1e1"'],
    [
      { rateLimitRetries: '2.7' },
      '--rate-limit-retries must be a whole number between 0 and 20, got "2.7"',
    ],
    [
      { rateLimitMaxWait: '5abc' },
      '--rate-limit-max-wait must be a whole number between 1000 and 600000, got "5abc"',
    ],
    [
      { rateLimitMaxWait: '5000abc' },
      '--rate-limit-max-wait must be a whole number between 1000 and 600000, got "5000abc"',
    ],
    [
      { rateLimitMaxWait: '2000.5' },
      '--rate-limit-max-wait must be a whole number between 1000 and 600000, got "2000.5"',
    ],
    [{ sdkRetries: '6' }, '--sdk-retries must be a whole number between 0 and 5, got "6"'],
  ])('%j', (options, message) => {
    expect(numericFlagErrors(options as CliOptions)).toEqual([message]);
  });

  it('accepts whole numbers in range and ignores flags that were not given', () => {
    expect(
      numericFlagErrors({
        batchSize: '10',
        concurrency: '3',
        retries: '0',
        rateLimitRetries: '20',
        rateLimitMaxWait: '1000',
        sdkRetries: '5',
      } as CliOptions)
    ).toEqual([]);
    expect(numericFlagErrors({} as CliOptions)).toEqual([]);
  });
});

describe('numericFlagOverrides: what reaches the run', () => {
  it('maps every given flag to its config key as a number', () => {
    expect(
      numericFlagOverrides({
        batchSize: '10',
        concurrency: '3',
        retries: '0',
        rateLimitRetries: '7',
        rateLimitMaxWait: '5000',
        sdkRetries: '2',
      } as CliOptions)
    ).toEqual({
      batchSize: 10,
      concurrencySize: 3,
      retriesNumber: 0,
      rateLimitMaxRetries: 7,
      rateLimitMaxWaitMs: 5000,
      sdkMaxRetries: 2,
    });
  });

  it('sets nothing for flags that were not given, so the config value stays', () => {
    expect(numericFlagOverrides({ batchSize: '4' } as CliOptions)).toEqual({ batchSize: 4 });
  });

  it('passes an invalid value on as NaN (never truncated), which validateConfig rejects', () => {
    const overrides = numericFlagOverrides({ rateLimitMaxWait: '5000abc' } as CliOptions);
    expect(overrides.rateLimitMaxWaitMs).toBeNaN();
    const config = {
      dataPaths: ['x.csv'],
      schemaPath: '',
      outputPath: '',
      batchSize: 5,
      concurrencySize: 5,
      retriesNumber: 2,
      ...overrides,
    } as unknown as AppConfig;
    expect(() => validateConfig(config)).toThrow(
      /rateLimitMaxWaitMs must be between 1000 and 600000/
    );
  });
});

describe('validateOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(options: Partial<CliOptions>): { exited: boolean; printed: string } {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    try {
      validateOptions(options as CliOptions);
    } catch {
      // process.exit, mocked above
    }
    return {
      exited: exitSpy.mock.calls.length > 0,
      printed: errorSpy.mock.calls.map((args) => args.join(' ')).join('\n'),
    };
  }

  it('rejects a bad numeric flag in CLI mode', () => {
    const { exited, printed } = run({ config: 'config.json', rateLimitMaxWait: '5abc' });
    expect(exited).toBe(true);
    expect(printed).toContain('--rate-limit-max-wait must be a whole number');
  });

  it('rejects a bad numeric flag in interactive mode too', () => {
    const { exited, printed } = run({ batchSize: '2.7' });
    expect(exited).toBe(true);
    expect(printed).toContain('--batch-size must be a whole number between 1 and 50, got "2.7"');
  });

  it('lets interactive mode through when the numeric flags are fine', () => {
    expect(run({ batchSize: '10' }).exited).toBe(false);
  });
});
