import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '../src/utils/types.js';

/**
 * The numeric flags must reach the run as parsed by numericFlagOverrides: this drives
 * runAnalyzeCommand in CLI mode with the pipeline mocked, and checks the config it receives.
 */
const received: AppConfig[] = [];
vi.mock('../src/analysis/pipeline-db.js', () => ({
  analyzeDataWithDb: vi.fn(async (config: AppConfig) => {
    received.push(config);
    return { warningCount: 0, failedBatchCount: 0 };
  }),
}));

const { runAnalyzeCommand } = await import('../src/cli/cli-commands.js');

describe('analyze -c: numeric flags reach the run', () => {
  beforeEach(() => {
    received.length = 0;
  });

  it('passes every numeric flag as a whole number under its config key', async () => {
    await runAnalyzeCommand(
      {
        config: 'config.json',
        quiet: true,
        batchSize: '7',
        concurrency: '3',
        retries: '0',
        rateLimitRetries: '4',
        rateLimitMaxWait: '5000',
        sdkRetries: '1',
      },
      { name: 'npa-insight', version: '0.0.0-test' }
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      batchSize: 7,
      concurrencySize: 3,
      retriesNumber: 0,
      rateLimitMaxRetries: 4,
      rateLimitMaxWaitMs: 5000,
      sdkMaxRetries: 1,
    });
  });

  it('keeps the config file values for flags that were not given', async () => {
    await runAnalyzeCommand(
      { config: 'config.json', quiet: true },
      { name: 'npa-insight', version: '0.0.0-test' }
    );

    expect(received[0].batchSize).toBe(5); // config.json
    expect(received[0].concurrencySize).toBe(5);
  });
});
