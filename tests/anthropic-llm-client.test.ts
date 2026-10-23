import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import {
  AnthropicLLMClient,
  outputConfigFor,
  buildOutputFormat,
  toAnthropicSchema,
  splitInput,
} from '../src/clients/anthropic-llm-client.js';
import { LLMClientFactory } from '../src/clients/llm-client-factory.js';
import { OpenAILLMClient } from '../src/clients/openai-llm-client.js';
import { LLMRequestError } from '../src/clients/llm-errors.js';
import type { LLMAnalysisRequest } from '../src/interfaces/llm-client.interface.js';

// Mock the Anthropic SDK so no network calls happen. The subpath helper
// `@anthropic-ai/sdk/helpers/json-schema` is NOT mocked: it is a pure function and the
// tests below check what it does to the schema.
vi.mock('@anthropic-ai/sdk', () => {
  const ctor = vi.fn().mockImplementation(() => ({ messages: { create: vi.fn() } }));
  return { default: ctor };
});

const ENV_KEYS = [
  'LLM_PROVIDER',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MAX_RETRIES',
  'OPENAI_MAX_RETRIES',
  'DEFAULT_MODEL',
  'FALLBACK_MODEL',
] as const;

const baseRequest = (overrides: Partial<LLMAnalysisRequest> = {}): LLMAnalysisRequest => ({
  model: 'claude-sonnet-5-5',
  instructions: 'Extract entities',
  input: [
    { role: 'system', content: 'Extract entities' },
    { role: 'user', content: '[{"name":"John"}]' },
  ],
  zodSchema: z.object({ entities: z.array(z.object({ name: z.string().min(1) })) }),
  ...overrides,
});

const okResponse = (json: unknown) => ({
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: JSON.stringify(json) },
  ],
});

describe('AnthropicLLMClient', () => {
  let client: AnthropicLLMClient;
  let mockAnthropic: { messages: { create: ReturnType<typeof vi.fn> } };
  let Ctor: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const sdk = await import('@anthropic-ai/sdk');
    Ctor = vi.mocked(sdk.default) as unknown as ReturnType<typeof vi.fn>;
    Ctor.mockClear();
    mockAnthropic = { messages: { create: vi.fn() } };
    Ctor.mockReturnValue(mockAnthropic);
    client = new AnthropicLLMClient('sk-ant-test', 'claude-sonnet-5-5', 'claude-haiku-5-5');
  });

  it('throws when the API key is missing', () => {
    expect(() => new AnthropicLLMClient('')).toThrow('Anthropic API key is required');
  });

  it('uses Sonnet 5.5 and Haiku 5.5 as the default and fallback models', () => {
    const c = new AnthropicLLMClient('sk-ant-test');
    expect(c.getDefaultModel()).toBe('claude-sonnet-5-5');
    expect(c.getFallbackModel()).toBe('claude-haiku-5-5');
    expect(c.isConfigured()).toBe(true);
  });

  it('passes maxRetries and timeout to the SDK, with the same defaults as the OpenAI client', () => {
    expect(Ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test', maxRetries: 0, timeout: 150_000 })
    );
    Ctor.mockClear();
    new AnthropicLLMClient('sk-ant-test', undefined, undefined, {
      maxRetries: 3,
      timeoutMs: 20_000,
    });
    expect(Ctor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 3, timeout: 20_000 }));
  });

  it('sends the instructions as the system prompt, the rows as the user message, and a JSON schema format', async () => {
    mockAnthropic.messages.create.mockResolvedValue(okResponse({ entities: [{ name: 'John' }] }));

    const result = await client.analyze(baseRequest());

    expect(result.result).toEqual({ entities: [{ name: 'John' }] });
    expect(result.rawText).toBe(JSON.stringify({ entities: [{ name: 'John' }] }));
    expect(result.model).toBe('claude-sonnet-5-5');

    expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(1);
    const params = mockAnthropic.messages.create.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.system).toBe('Extract entities');
    expect(params.messages).toEqual([{ role: 'user', content: '[{"name":"John"}]' }]);
    expect(params.max_tokens).toBe(16_000);
    // Claude 5.x models reject temperature and run with thinking on; the client must not send
    // either and asks for low effort to keep bulk extraction fast and cheap.
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');
    const schema = params.output_config.format.schema;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['entities']);
    expect(schema.properties.entities.items.additionalProperties).toBe(false);
    // Constraints Anthropic's structured outputs reject (minLength) must leave the schema
    // itself and survive only as a hint in the description.
    const nameSchema = schema.properties.entities.items.properties.name;
    expect(nameSchema).not.toHaveProperty('minLength');
    expect(nameSchema.description).toContain('minLength: 1');
    expect(schema).not.toHaveProperty('$schema');
  });

  it('does not send a duplicate system message but keeps extra, different system text', () => {
    const { system, messages } = splitInput(
      baseRequest({
        input: [
          { role: 'system', content: 'Extract entities' },
          { role: 'system', content: 'Answer in English.' },
          { role: 'user', content: 'data' },
        ],
      })
    );
    expect(system).toBe('Extract entities\n\nAnswer in English.');
    expect(messages).toEqual([{ role: 'user', content: 'data' }]);
  });

  it('rejects a request with no user message instead of sending an invalid API call', () => {
    expect(() => splitInput(baseRequest({ input: [] }))).toThrow(LLMRequestError);
    expect(() => splitInput(baseRequest({ input: [] }))).toThrow(/at least one user/);
  });

  it('refuses to send a non-Claude model name to Anthropic with a clear message', async () => {
    await expect(client.analyze(baseRequest({ model: 'gpt-6-luna' }))).rejects.toThrow(
      /gpt-6-luna.*not a Claude model.*claude-sonnet-5-5/
    );
    expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
  });

  it('turns a safety refusal into a non-retryable LLMRequestError', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: 'nope' },
      content: [],
    });
    const err = await client.analyze(baseRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err.code).toBe('refusal');
    expect(err.isRetryable).toBe(false);
    expect(err.message).toMatch(/declined/);
    expect(err.message).toContain('nope');
  });

  it('flags a response cut off by max_tokens so the caller can lower the batch size', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"entities":[' }],
    });
    const err = await client.analyze(baseRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err.code).toBe('max_tokens');
    expect(err.isRetryable).toBe(false);
    expect(err.message).toMatch(/batchSize/);
  });

  it('preserves status and Retry-After on a 429 so the rate-limit gate can pause', async () => {
    mockAnthropic.messages.create.mockRejectedValue({
      status: 429,
      headers: new Headers({ 'retry-after': '7' }),
      message: 'rate limited',
    });
    const err = await client.analyze(baseRequest()).catch((e) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err.status).toBe(429);
    expect(err.isRateLimit).toBe(true);
    expect(err.isRetryable).toBe(true);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('treats an Anthropic 529 overloaded error as retryable', async () => {
    mockAnthropic.messages.create.mockRejectedValue({ status: 529, message: 'Overloaded' });
    const err = await client.analyze(baseRequest()).catch((e) => e);
    expect(err.isRetryable).toBe(true);
    expect(err.isRateLimit).toBe(false);
  });

  it('throws when the model returns text that is not JSON', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json {' }],
    });
    await expect(client.analyze(baseRequest())).rejects.toBeInstanceOf(LLMRequestError);
  });

  it('throws when the response has no text block at all', async () => {
    mockAnthropic.messages.create.mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(client.analyze(baseRequest())).rejects.toThrow(/no text/);
  });
});

describe('outputConfigFor', () => {
  it.each([
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-opus-5-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
  ])('asks %s for low effort', (model) => {
    expect(outputConfigFor(model)).toEqual({ effort: 'low' });
  });

  it.each(['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest'])(
    'sends no effort setting to %s (the API would reject it)',
    (model) => {
      expect(outputConfigFor(model)).toEqual({});
    }
  );
});

describe('toAnthropicSchema', () => {
  it('keeps enum values in the schema (they enforce the ADC taxonomies) instead of demoting them to text', () => {
    const out = toAnthropicSchema({
      type: 'object',
      properties: { gender: { type: 'string', enum: ['female', 'male'] } },
      required: ['gender'],
    });
    expect((out.properties as any).gender).toEqual({ type: 'string', enum: ['female', 'male'] });
    expect(out.additionalProperties).toBe(false);
  });

  it('turns a nullable type array into anyOf and keeps the keywords on the non-null variant', () => {
    const out = toAnthropicSchema({
      type: ['string', 'null'],
      enum: ['a', 'b', null],
      description: 'Pick one',
    });
    expect(out).toEqual({
      anyOf: [{ type: 'string', enum: ['a', 'b', null] }, { type: 'null' }],
      description: 'Pick one',
    });
  });

  it('moves numeric and string constraints into the description and keeps supported formats', () => {
    const out = toAnthropicSchema({
      type: 'object',
      properties: {
        age: { type: 'integer', minimum: 0, maximum: 120 },
        email: { type: 'string', format: 'email' },
        zip: { type: 'string', pattern: '^\\d{5}$', format: 'zip-code' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      },
      required: ['age', 'email', 'zip', 'tags'],
      additionalProperties: true,
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
    const props = out.properties as any;
    expect(props.age).toEqual({ type: 'integer', description: '{minimum: 0, maximum: 120}' });
    expect(props.email).toEqual({ type: 'string', format: 'email' });
    expect(props.zip).not.toHaveProperty('pattern');
    expect(props.zip).not.toHaveProperty('format');
    expect(props.zip.description).toContain('pattern');
    expect(props.zip.description).toContain('format: "zip-code"');
    expect(props.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: '{maxItems: 5}',
    });
    expect(out.additionalProperties).toBe(false);
    expect(out).not.toHaveProperty('$schema');
  });

  it('rejects a node with no type information rather than sending an invalid schema', () => {
    expect(() => toAnthropicSchema({ description: 'typeless' })).toThrow(/must have a type/);
  });
});

describe('buildOutputFormat', () => {
  it('keeps nullable fields and enums the way the ADC schema uses them', () => {
    const schema = z.object({
      age: z.number().nullable(),
      gender: z.enum(['female', 'male', 'other']).nullable(),
      email: z.string().email(),
    });
    const format = buildOutputFormat(schema);
    const text = JSON.stringify(format.schema);
    expect(format.type).toBe('json_schema');
    expect(text).toContain('"null"');
    const props = format.schema.properties as any;
    expect(props.gender.anyOf[0].enum).toEqual(['female', 'male', 'other']);
    expect(props.age.anyOf).toEqual([{ type: 'number' }, { type: 'null' }]);
    expect(props.email).toEqual({ type: 'string', format: 'email' });
    expect(format.schema.required).toEqual(['age', 'gender', 'email']);
    expect(text).not.toContain('$ref');
  });
});

describe('LLMClientFactory with the Anthropic provider', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it('creates an Anthropic client when LLM_PROVIDER=anthropic', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(40);
    expect(LLMClientFactory.createFromEnv()).toBeInstanceOf(AnthropicLLMClient);
  });

  it('auto-selects Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(40);
    const c = LLMClientFactory.createFromEnv();
    expect(c).toBeInstanceOf(AnthropicLLMClient);
    expect(c.getDefaultModel()).toBe('claude-sonnet-5-5');
    expect(c.getFallbackModel()).toBe('claude-haiku-5-5');
  });

  it('keeps OpenAI when both keys are set and no provider is forced', () => {
    process.env.OPENAI_API_KEY = 'sk-' + 'a'.repeat(40);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(40);
    expect(LLMClientFactory.createFromEnv()).toBeInstanceOf(OpenAILLMClient);
  });

  it('names the Anthropic key when the provider is forced but the key is missing', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.OPENAI_API_KEY = 'sk-' + 'a'.repeat(40);
    expect(() => LLMClientFactory.createFromEnv()).toThrow(
      'ANTHROPIC_API_KEY environment variable is required'
    );
  });

  it('rejects an unknown provider', () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.OPENAI_API_KEY = 'sk-' + 'a'.repeat(40);
    expect(() => LLMClientFactory.createFromEnv()).toThrow(/Unsupported LLM provider/);
  });

  it('passes DEFAULT_MODEL / FALLBACK_MODEL overrides through', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(40);
    process.env.DEFAULT_MODEL = 'claude-opus-5-5';
    process.env.FALLBACK_MODEL = 'claude-sonnet-5-5';
    const c = LLMClientFactory.createFromEnv();
    expect(c.getDefaultModel()).toBe('claude-opus-5-5');
    expect(c.getFallbackModel()).toBe('claude-sonnet-5-5');
  });

  it('warns about a placeholder Anthropic key, naming the right variable', async () => {
    vi.resetModules();
    const { LLMClientFactory: Factory } = await import('../src/clients/llm-client-factory.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.ANTHROPIC_API_KEY = 'placeholder-key';

    Factory.createFromEnv();

    expect(warnSpy).toHaveBeenCalledWith(
      'ANTHROPIC_API_KEY does not look like a real Anthropic key. The AI path will fail with 401 if this is a placeholder.'
    );
  });

  it('reads ANTHROPIC_MAX_RETRIES for the SDK retry count', async () => {
    const sdk = await import('@anthropic-ai/sdk');
    const Ctor = vi.mocked(sdk.default) as unknown as ReturnType<typeof vi.fn>;
    Ctor.mockClear();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(40);
    process.env.ANTHROPIC_MAX_RETRIES = '2';

    LLMClientFactory.createFromEnv();

    expect(Ctor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
  });
});
