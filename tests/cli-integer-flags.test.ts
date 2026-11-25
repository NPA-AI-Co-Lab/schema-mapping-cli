import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseIntegerOption, validateOptions } from '../src/cli/cli-config.js';
import type { CliOptions } from '../src/cli/cli-types.js';

describe('parseIntegerOption', () => {
  it.each([
    ['5', 5],
    [' 10 ', 10],
    ['0', 0],
    ['2.7', 2.7],
  ])('keeps %j as %d', (input, expected) => {
    expect(parseIntegerOption(input)).toBe(expected);
  });

  it.each(['5abc', 'abc', '', '  '])('turns %j into NaN instead of a truncated number', (input) => {
    expect(parseIntegerOption(input)).toBeNaN();
  });
});

describe('validateOptions rejects non-integer numeric flags', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function errorsFor(options: Partial<CliOptions>): string {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    try {
      validateOptions({ config: 'config.json', ...options } as CliOptions);
    } catch {
      // process.exit, mocked above
    }
    const printed = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    return exitSpy.mock.calls.length > 0 ? printed : '';
  }

  it.each([
    [{ batchSize: '2.7' }, 'Batch size'],
    [{ batchSize: '5abc' }, 'Batch size'],
    [{ concurrency: '1.5' }, 'Concurrency'],
    [{ retries: '2.5' }, 'Retries'],
  ])('%j', (options, label) => {
    const printed = errorsFor(options);
    expect(printed).toContain(`${label} must be a whole number`);
  });

  it('accepts whole numbers in range', () => {
    expect(errorsFor({ batchSize: '10', concurrency: '3', retries: '0' })).toBe('');
  });
});
