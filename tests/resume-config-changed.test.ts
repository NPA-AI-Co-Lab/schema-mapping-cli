import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeDataWithDb } from '../src/analysis/pipeline-db.js';
import { ConfigChangedError } from '../src/utils/errors.js';
import {
  createFixture,
  cleanupFixture,
  baseConfig,
  FakeLLMClient,
  scoreResponse,
  type FixturePaths,
} from './helpers/db-pipeline-fixture.js';

/**
 * With resumeMode "resume", a database created under another configuration is refused. The
 * error used to suggest a non-existent `--resume-mode=fresh` flag and was followed by
 * "Re-run the same command to resume", which can only fail the same way again.
 */
describe('resumeMode "resume" with a changed configuration', () => {
  let fixture: FixturePaths;

  beforeEach(async () => {
    fixture = await createFixture([
      { userID: 'u1', name: 'Jane' },
      { userID: 'u2', name: 'John' },
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupFixture(fixture);
  });

  function configFor(overrides: Record<string, unknown> = {}) {
    return baseConfig(fixture, { rulesPath: fixture.rulesPartialPath, ...overrides });
  }

  const client = () => new FakeLLMClient(() => scoreResponse(1));

  it('names the real fix and does not tell the user to re-run the same command', async () => {
    await analyzeDataWithDb(configFor({ batchSize: 1 }), client(), true);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const run = analyzeDataWithDb(
      configFor({ batchSize: 2, resumeMode: 'resume' }),
      client(),
      false
    );

    await expect(run).rejects.toBeInstanceOf(ConfigChangedError);
    await expect(run).rejects.toThrow(/"resumeMode": "fresh"/);
    await expect(run).rejects.not.toThrow(/--resume-mode/);

    const printed = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(printed).toContain('Processing stopped');
    expect(printed).not.toContain('Re-run the same command');
  });

  it('still resumes when the configuration is unchanged', async () => {
    await analyzeDataWithDb(configFor({ batchSize: 1 }), client(), true);

    await expect(
      analyzeDataWithDb(configFor({ batchSize: 1, resumeMode: 'resume' }), client(), true)
    ).resolves.toMatchObject({ failedBatchCount: 0 });
  });
});
