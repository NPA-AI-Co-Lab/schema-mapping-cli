import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

import { setupCliProgram } from '../src/cli/cli-setup.js';
import type { CliOptions } from '../src/cli/cli-types.js';

/**
 * `--llm-fields <fields>` and `--no-llm-fields <fields>` are two independent options: the
 * first forces fields through the LLM, the second keeps them deterministic. Commander treats a
 * `--no-` prefix as the negated form of the positive option by default, which would store the
 * `--no-llm-fields` value under `llmFields` and make the flag do the opposite of what it says.
 */

function parseAnalyzeOptions(argv: string[]): CliOptions {
  const program = new Command();
  program.exitOverride();
  setupCliProgram(program, { name: 'npa-insight', version: '0.0.0-test' });
  const analyze = program.commands.find((c) => c.name() === 'analyze');
  if (!analyze) throw new Error('analyze command not registered');
  analyze.parseOptions(argv);
  return analyze.opts() as CliOptions;
}

describe('--llm-fields / --no-llm-fields parsing', () => {
  it('stores --no-llm-fields under noLlmFields and leaves llmFields unset', () => {
    const opts = parseAnalyzeOptions(['--no-llm-fields', 'person.consentType,person.tags']);

    expect(opts.noLlmFields).toBe('person.consentType,person.tags');
    expect(opts.llmFields).toBeUndefined();
  });

  it('stores --llm-fields under llmFields and leaves noLlmFields unset', () => {
    const opts = parseAnalyzeOptions(['--llm-fields', 'object.responses']);

    expect(opts.llmFields).toBe('object.responses');
    expect(opts.noLlmFields).toBeUndefined();
  });

  it('keeps both lists when the two flags are used together', () => {
    const opts = parseAnalyzeOptions([
      '--llm-fields',
      'object.responses',
      '--no-llm-fields',
      'person.consentType',
    ]);

    expect(opts.llmFields).toBe('object.responses');
    expect(opts.noLlmFields).toBe('person.consentType');
  });
});
