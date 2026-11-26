import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { analyzeDataWithDb } from '../src/analysis/pipeline-db.js';
import { buildLlmRecord, transformRow } from '../src/analysis/rules/index.js';
import type { LoadedRules } from '../src/analysis/rules/index.js';
import type { NormalizedFieldRule } from '../src/analysis/rules/types.js';
import {
  createFixture,
  cleanupFixture,
  baseConfig,
  FakeLLMClient,
  scoreResponse,
  nonRetryableError,
  type FixturePaths,
} from './helpers/db-pipeline-fixture.js';

/**
 * Issue #8: in rules mode the LLM received only the rule-mapped record, so a column with no
 * rule (typically the free text the LLM fields are inferred from) never reached it. The LLM
 * input now also carries those columns under `unmappedSource`.
 */

function rule(partial: Partial<NormalizedFieldRule>): NormalizedFieldRule {
  return { transforms: [], when: [], ...partial };
}

function rulesOf(fields: Record<string, NormalizedFieldRule>): LoadedRules {
  return {
    rulesPath: 'rules.json',
    schemaPath: 'schema.jsonld',
    llmFields: new Set(['person.score']),
    fieldRules: new Map(Object.entries(fields)),
    schemaFields: [],
    requiredFields: new Set(),
    schema: {} as LoadedRules['schema'],
  };
}

function llmRecord(row: Record<string, string>, rules: LoadedRules) {
  return buildLlmRecord(row, transformRow(row, rules), rules);
}

describe('buildLlmRecord (#8)', () => {
  it('adds the columns no rule names, and leaves out the ones a rule used', () => {
    const rules = rulesOf({ 'person.name': rule({ source: 'name' }) });

    const record = llmRecord({ name: 'Jane', comment: 'Loved it', rating: '5' }, rules);

    expect(record).toEqual({
      person: { name: 'Jane' },
      unmappedSource: { comment: 'Loved it', rating: '5' },
    });
  });

  it('adds nothing when every column was used', () => {
    const rules = rulesOf({ 'person.name': rule({ source: 'name' }) });
    const row = { name: 'Jane' };
    const prefill = transformRow(row, rules);

    expect(buildLlmRecord(row, prefill, rules)).toBe(prefill.mapped);
  });

  it('keeps an empty column that no rule names, and drops an empty one a rule names', () => {
    const rules = rulesOf({
      'person.name': rule({ source: 'name' }),
      'person.nick': rule({ source: 'nick' }),
    });

    const record = llmRecord({ name: 'Jane', nick: '  ', 'Newsletters?': '' }, rules);

    expect(record.unmappedSource).toEqual({ 'Newsletters?': '' });
  });

  it('adds a column whose rule did not run because its `when` condition failed', () => {
    const rules = rulesOf({
      'person.name': rule({
        source: 'name',
        when: [{ type: 'equals', column: 'kind', value: 'person' }],
      }),
    });

    const record = llmRecord({ name: 'Acme Ltd', kind: 'org' }, rules);

    expect(record).toEqual({ unmappedSource: { name: 'Acme Ltd', kind: 'org' } });
  });

  it('adds the alternates of a `source` list that were not the one used', () => {
    const rules = rulesOf({ 'person.name': rule({ source: ['fullName', 'displayName'] }) });

    const record = llmRecord({ fullName: 'Jane Doe', displayName: 'jd' }, rules);

    expect(record).toEqual({
      person: { name: 'Jane Doe' },
      unmappedSource: { displayName: 'jd' },
    });
  });

  it('adds a column whose value the transforms discarded in favour of the fallback', () => {
    const rules = rulesOf({
      'person.age': rule({ source: 'age', transforms: [{ type: 'toNumber' }], fallback: 0 }),
    });

    const record = llmRecord({ age: 'late thirties' }, rules);

    expect(record).toEqual({
      person: { age: 0 },
      unmappedSource: { age: 'late thirties' },
    });
  });

  it('does not change the mapped record, which is merged into the output as is', () => {
    const rules = rulesOf({ 'person.name': rule({ source: 'name' }) });
    const row = { name: 'Jane', comment: 'Loved it' };
    const prefill = transformRow(row, rules);

    buildLlmRecord(row, prefill, rules);

    expect(prefill.mapped).toEqual({ person: { name: 'Jane' } });
  });
});

describe('issue #8: the LLM sees the columns without a rule (real pipeline)', () => {
  let fixture: FixturePaths;

  const CSV = [
    'userID,name,email,comment,rating,Newsletters?',
    'u1,Jane,jane.doe@example.com,"Jane read the newsletter carefully, write to np@aboba.com",5,',
    'u2,Michael,michael.b@example.com,Browsed the article,2,Already do',
  ].join('\n');

  beforeEach(async () => {
    // The fixture's partial rules map userID and name; `person.score` is left to the LLM.
    fixture = await createFixture([]);
    await fs.writeFile(fixture.csvPath, CSV + '\n', 'utf-8');
  });

  afterEach(async () => {
    await cleanupFixture(fixture);
  });

  function scoringClient() {
    return new FakeLLMClient((request) => {
      const rows = JSON.parse(request.input.find((m) => m.role === 'user')!.content);
      return scoreResponse(rows.length, 4);
    });
  }

  function sentRows(client: FakeLLMClient): Array<Record<string, any>> {
    return client.calls.flatMap((call) =>
      JSON.parse(call.input.find((message) => message.role === 'user')!.content)
    );
  }

  function configFor(hidePII: boolean) {
    return baseConfig(fixture, { rulesPath: fixture.rulesPartialPath, hidePII, batchSize: 2 });
  }

  it('sends the unmapped columns next to the rule-mapped record', async () => {
    const client = scoringClient();

    await analyzeDataWithDb(configFor(false), client, false);

    const [first, second] = sentRows(client);
    expect(first.person.name).toBe('Jane');
    expect(first.unmappedSource).toEqual({
      email: 'jane.doe@example.com',
      comment: 'Jane read the newsletter carefully, write to np@aboba.com',
      rating: '5',
      'Newsletters?': '',
    });
    expect(second.unmappedSource.comment).toBe('Browsed the article');
    expect(second.unmappedSource['Newsletters?']).toBe('Already do');
  });

  it('masks the unmapped columns like the rest of the record when hidePII is true', async () => {
    const client = scoringClient();

    await analyzeDataWithDb(configFor(true), client, false);

    const sent = client.calls
      .flatMap((call) => call.input.filter((message) => message.role === 'user'))
      .map((message) => message.content)
      .join('\n');
    for (const value of [
      'Jane',
      'Michael',
      'jane.doe@example.com',
      'michael.b@example.com',
      'np@aboba.com',
    ]) {
      expect(sent, `"${value}" was sent to the LLM unmasked`).not.toContain(value);
    }

    const [first] = sentRows(client);
    // A PII-named column is masked by its name, free text by the regexes, and the name the
    // rules mapped is masked where the comment mentions it.
    expect(first.unmappedSource.email).toMatch(/^EMAIL_\d+@GMAIL\.COM$/);
    expect(first.unmappedSource.comment).toMatch(
      /^NAME_\d+ read the newsletter carefully, write to EMAIL_\d+@GMAIL\.COM$/
    );
    expect(first.unmappedSource.comment.startsWith(first.person.name)).toBe(true);
    expect(first.unmappedSource.rating).toBe('5');
  });

  it('never writes unmappedSource to the output', async () => {
    const client = scoringClient();

    const summary = await analyzeDataWithDb(configFor(true), client, false);

    expect(summary.failedBatchCount).toBe(0);
    const output = await fs.readFile(fixture.outputPath, 'utf-8');
    expect(output).not.toContain('unmappedSource');
    expect(output).not.toContain('read the newsletter');
    expect(output).toContain('Jane');
    expect(output).not.toMatch(/NAME_\d|EMAIL_\d+@GMAIL\.COM/);
  });

  it('tells the model what unmappedSource is', async () => {
    const client = scoringClient();

    await analyzeDataWithDb(configFor(false), client, false);

    const system = client.calls[0].input.find((message) => message.role === 'system')!.content;
    expect(system).toContain('"unmappedSource"');
  });
});

describe('issue #8: the shipped sample config', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'npa-sample-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('puts the comment text of sample_comments.csv into the LLM input', async () => {
    const shipped = JSON.parse(await fs.readFile('./config.json', 'utf-8'));
    // Stop at the first request: only what was sent matters here.
    const client = new FakeLLMClient(() => {
      throw nonRetryableError('stop after the first request');
    });

    await expect(
      analyzeDataWithDb(
        {
          ...shipped,
          outputPath: path.join(dir, 'output.jsonld'),
          databasePath: path.join(dir, 'pipeline.db'),
          enableLogging: false,
          retriesNumber: 0,
          concurrencySize: 1,
          failFast: true,
        },
        client,
        true
      )
    ).rejects.toThrow();

    expect(shipped.rulesPath).toBe('./config/sample_comments.rules.json');
    const [first] = JSON.parse(client.calls[0].input.find((m) => m.role === 'user')!.content);
    expect(first.unmappedSource.comment).toBe(
      'Read the newsletter carefully and clicked on survey link'
    );
  });
});
