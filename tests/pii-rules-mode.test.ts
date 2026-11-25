import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { analyzeDataWithDb } from '../src/analysis/pipeline-db.js';
import {
  createFixture,
  cleanupFixture,
  baseConfig,
  FakeLLMClient,
  scoreResponse,
  type FixturePaths,
} from './helpers/db-pipeline-fixture.js';
import type { AppConfig } from '../src/utils/types.js';

/**
 * Regression test for issue #7: with a rules file, `hidePII: true` must still mask what goes
 * to the LLM. The record sent in rules mode is the rule-mapped one (nested objects, arrays,
 * `{ value, present }` wrappers); a masker that only looked at top-level strings sent names,
 * emails and postcodes verbatim. Drives the real pipeline; only the LLM client is faked.
 */

const SCHEMA = {
  '@context': { '@vocab': 'https://schema.org/', userID: 'identifier' },
  entities: {
    person: {
      '@type': 'Person',
      idProp: 'userID',
      properties: {
        userID: { type: 'string', description: 'Global user ID', required: true },
        givenName: { type: 'string', description: 'First name' },
        familyName: { type: 'string', description: 'Last name', required: true },
        primaryEmail: { type: 'string', description: 'Primary email' },
        additionalEmails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Other emails',
        },
        location: {
          type: 'object',
          properties: { postalCode: { type: 'string', description: 'Postal code' } },
        },
        notes: { type: 'string', description: 'Free text' },
        sourceRecord: { type: 'string', description: 'Reference to the source user record' },
        score: { type: 'number', description: 'LLM-derived score' },
      },
    },
  },
};

const RULES = {
  schema: 'schema.jsonld',
  llm: { default: false, fields: ['person.score'] },
  fields: {
    'person.userID': { source: 'userID', transforms: ['trim'] },
    'person.givenName': { source: 'givenName', transforms: ['trim'] },
    'person.familyName': { source: 'familyName', transforms: ['trim'] },
    'person.primaryEmail': { source: 'primaryEmail', transforms: ['trim'] },
    'person.additionalEmails': { source: 'additionalEmails', transforms: ['split'] },
    'person.location.postalCode': { source: 'postalCode', transforms: ['trim'] },
    'person.notes': { source: 'comment', transforms: ['trim'] },
    // A second, non-PII-named field fed from the same column (like `action.person` in the
    // shipped rules): the value must be masked here too.
    'person.sourceRecord': { source: 'userID', transforms: ['trim'] },
  },
};

const CSV = [
  'userID,givenName,familyName,primaryEmail,additionalEmails,postalCode,comment',
  'u1,Jane,Doe,jane.doe@example.com,"j.doe@alt.com, jane.alt@example.org",95409,Minimal engagement. np@aboba.com',
  'u2,Michael,Brown,michael.brown@example.com,m.brown@alt.com,60601,Michael Brown opened the newsletter',
].join('\n');

/** Every personal value of the CSV above; none of them may reach the LLM. */
const PERSONAL_VALUES = [
  'Jane',
  'Doe',
  'jane.doe@example.com',
  'j.doe@alt.com',
  'jane.alt@example.org',
  '95409',
  'np@aboba.com',
  'Michael',
  'Brown',
  'michael.brown@example.com',
  'm.brown@alt.com',
  '60601',
];

describe('issue #7: hidePII masks the LLM input in rules mode', () => {
  let fixture: FixturePaths;

  beforeEach(async () => {
    fixture = await createFixture([]);
    await fs.writeFile(fixture.csvPath, CSV + '\n', 'utf-8');
    await fs.writeFile(fixture.schemaPath, JSON.stringify(SCHEMA, null, 2), 'utf-8');
    await fs.writeFile(fixture.rulesPartialPath, JSON.stringify(RULES, null, 2), 'utf-8');
  });

  afterEach(async () => {
    await cleanupFixture(fixture);
  });

  function configFor(hidePII: boolean) {
    return baseConfig(fixture, {
      rulesPath: fixture.rulesPartialPath,
      hidePII,
      batchSize: 2,
      uuidColumn: 'primaryEmail',
    });
  }

  function userMessages(client: FakeLLMClient): string {
    return client.calls
      .flatMap((call) => call.input.filter((message) => message.role === 'user'))
      .map((message) => message.content)
      .join('\n');
  }

  it('sends placeholders, not the personal values, when hidePII is true', async () => {
    const client = new FakeLLMClient((request) => {
      const rows = JSON.parse(request.input.find((m) => m.role === 'user')!.content);
      return scoreResponse(rows.length, 4);
    });

    const summary = await analyzeDataWithDb(configFor(true), client, false);

    expect(summary.failedBatchCount).toBe(0);
    expect(client.calls.length).toBeGreaterThan(0);

    const sent = userMessages(client);
    for (const value of PERSONAL_VALUES) {
      expect(sent, `"${value}" was sent to the LLM unmasked`).not.toContain(value);
    }

    // What the LLM sees instead: field-map placeholders at every depth…
    const [first] = JSON.parse(client.calls[0].input.find((m) => m.role === 'user')!.content);
    expect(first.person.givenName).toMatch(/^NAME_\d+$/);
    expect(first.person.familyName.value).toMatch(/^NAME_\d+$/); // required → { value, present }
    expect(first.person.primaryEmail).toMatch(/^EMAIL_\d+@GMAIL\.COM$/);
    expect(first.person.additionalEmails).toHaveLength(2);
    for (const email of first.person.additionalEmails) {
      expect(email).toMatch(/^EMAIL_\d+@GMAIL\.COM$/);
    }
    expect(first.person.location.postalCode).toMatch(/^ADDRESS_\d+$/);
    // …and regex masking of an email inside free text mapped by a rule.
    expect(first.person.notes).toMatch(/^Minimal engagement\. EMAIL_\d+@GMAIL\.COM$/);

    // The user ID copied into a reference field gets the same placeholder as person.userID,
    // and names mentioned in free text are masked too.
    expect(first.person.userID.value).toMatch(/^ID_\d+$/);
    expect(first.person.sourceRecord).toBe(first.person.userID.value);
    expect(sent).not.toMatch(/"u[12]"/);
    const second = JSON.parse(client.calls[0].input.find((m) => m.role === 'user')!.content)[1];
    expect(second.person.notes).toBe(
      `${second.person.givenName} ${second.person.familyName.value} opened the newsletter`
    );
  });

  it('still writes the real values to the output', async () => {
    const client = new FakeLLMClient((request) => {
      const rows = JSON.parse(request.input.find((m) => m.role === 'user')!.content);
      return scoreResponse(rows.length, 4);
    });

    await analyzeDataWithDb(configFor(true), client, false);

    const output = await fs.readFile(fixture.outputPath, 'utf-8');
    for (const value of PERSONAL_VALUES) {
      expect(output, `"${value}" is missing from the output`).toContain(value);
    }
    expect(output).not.toMatch(/NAME_\d|EMAIL_\d+@GMAIL\.COM|ADDRESS_\d|ID_\d/);
  });

  it('masks by default when the config does not set hidePII (#13)', async () => {
    const client = new FakeLLMClient((request) => {
      const rows = JSON.parse(request.input.find((m) => m.role === 'user')!.content);
      return scoreResponse(rows.length, 4);
    });
    const config: Partial<AppConfig> = { ...configFor(true) };
    delete config.hidePII;

    await analyzeDataWithDb(config as AppConfig, client, false);

    const sent = userMessages(client);
    expect(client.calls.length).toBeGreaterThan(0);
    for (const value of PERSONAL_VALUES) {
      expect(sent, `"${value}" was sent to the LLM unmasked`).not.toContain(value);
    }
  });

  it('sends the values as they are when hidePII is false', async () => {
    const client = new FakeLLMClient((request) => {
      const rows = JSON.parse(request.input.find((m) => m.role === 'user')!.content);
      return scoreResponse(rows.length, 4);
    });

    await analyzeDataWithDb(configFor(false), client, false);

    const sent = userMessages(client);
    expect(sent).toContain('jane.doe@example.com');
    expect(sent).not.toMatch(/EMAIL_\d+@GMAIL\.COM/);
  });
});
