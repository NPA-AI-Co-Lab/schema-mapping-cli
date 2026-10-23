import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  ILLMClient,
  LLMAnalysisRequest,
  LLMAnalysisResponse,
} from '../interfaces/llm-client.interface.js';
import { LLMRequestError, normalizeLLMError } from './llm-errors.js';
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_FALLBACK_MODEL } from './llm-provider.js';

/**
 * Claude models that accept `output_config.effort`: every Claude 5.x model, Opus/Sonnet 4.6–4.8
 * and Opus 4.5. Older models (Haiku 4.5, Sonnet 4.5, Claude 3.x) reject the field.
 */
const EFFORT_MODEL =
  /^claude-(?:(?:fable|mythos|opus|sonnet|haiku)-5(?:-\d+)?|(?:opus|sonnet)-4-[678]|opus-4-5)$/i;

/** Upper bound on output tokens per request. 16K comfortably fits a batch of up to 50 rows. */
const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Per-model output settings. Bulk extraction does not need deep reasoning, so models that
 * support `effort` are asked for `low`: it keeps cost and latency close to the OpenAI path.
 * Thinking is left at the model default (adaptive) because Claude 5.x models reject
 * `thinking: { type: 'disabled' }`; `temperature` is never sent for the same reason.
 */
export function outputConfigFor(model: string): { effort?: 'low' } {
  return EFFORT_MODEL.test(model) ? { effort: 'low' } : {};
}

/** String formats Anthropic's structured outputs enforce; any other `format` becomes a description hint. */
const SUPPORTED_STRING_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

type JsonSchemaObject = Record<string, unknown>;

/**
 * Rewrite a JSON schema into the subset Anthropic's structured outputs accept.
 *
 * Kept as-is: `type`, `enum`, `const`, `anyOf`/`oneOf` (as `anyOf`), `allOf`, `description`,
 * `title`, `properties`, `required`, `items`, supported string `format`s and `minItems` of 0/1.
 * Every object gets `additionalProperties: false`. A `type` array such as `["string", "null"]`
 * becomes an `anyOf` of single types. Anything else (`minLength`, `minimum`, `pattern`, …) is
 * removed from the schema and appended to the field's description as a hint, so the model still
 * sees the intent while the API never rejects the schema. The pipeline validates every response
 * against the full Zod schema afterwards, so nothing is lost.
 *
 * The SDK ships a similar helper (`jsonSchemaOutputFormat`), but it also moves `enum` into the
 * description — and enum values are how the ADC taxonomies are enforced — so this one keeps them.
 */
export function toAnthropicSchema(input: JsonSchemaObject): JsonSchemaObject {
  const rest: JsonSchemaObject = { ...input };
  const out: JsonSchemaObject = {};
  const take = (key: string): unknown => {
    const value = rest[key];
    delete rest[key];
    return value;
  };

  // Metadata the API has no use for; dropped silently rather than turned into hints.
  for (const key of ['$schema', '$id', 'default', 'examples', 'markdownDescription']) {
    delete rest[key];
  }

  const defs = take('$defs') ?? take('definitions');
  if (defs && typeof defs === 'object') {
    out.$defs = Object.fromEntries(
      Object.entries(defs as Record<string, JsonSchemaObject>).map(([name, def]) => [
        name,
        toAnthropicSchema(def),
      ])
    );
  }

  const ref = take('$ref');
  if (typeof ref === 'string') {
    out.$ref = ref.replace('#/definitions/', '#/$defs/');
    return out;
  }

  const type = take('type');
  const anyOf = take('anyOf') ?? take('oneOf');
  const allOf = take('allOf');
  const description = take('description');
  const title = take('title');

  if (Array.isArray(type) && type.length > 1) {
    // `["string", "null"]` → anyOf of each type, carrying the remaining keywords on the
    // non-null variant (enum, format, properties, …).
    const nonNull = type.filter((t) => t !== 'null');
    const variants: JsonSchemaObject[] = nonNull.map((t) =>
      toAnthropicSchema({ ...rest, type: t })
    );
    if (type.includes('null')) variants.push({ type: 'null' });
    out.anyOf = variants;
    if (description !== undefined) out.description = description;
    if (title !== undefined) out.title = title;
    return out;
  }

  if (Array.isArray(anyOf)) {
    out.anyOf = (anyOf as JsonSchemaObject[]).map((variant) => toAnthropicSchema(variant));
  } else if (Array.isArray(allOf)) {
    out.allOf = (allOf as JsonSchemaObject[]).map((entry) => toAnthropicSchema(entry));
  } else if (type !== undefined) {
    out.type = Array.isArray(type) ? type[0] : type;
  } else {
    throw new Error('JSON schema node must have a type, anyOf/oneOf, allOf or $ref');
  }

  if (description !== undefined) out.description = description;
  if (title !== undefined) out.title = title;

  const enumValues = take('enum');
  if (Array.isArray(enumValues)) out.enum = enumValues;
  if ('const' in rest) out.const = take('const');

  if (out.type === 'object') {
    const properties = (take('properties') ?? {}) as Record<string, JsonSchemaObject>;
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, prop]) => [key, toAnthropicSchema(prop)])
    );
    take('additionalProperties');
    out.additionalProperties = false;
    const required = take('required');
    if (Array.isArray(required)) out.required = required;
  } else if (out.type === 'string') {
    const format = take('format');
    if (typeof format === 'string') {
      if (SUPPORTED_STRING_FORMATS.has(format)) out.format = format;
      else rest.format = format;
    }
  } else if (out.type === 'array') {
    const items = take('items');
    if (items && typeof items === 'object')
      out.items = toAnthropicSchema(items as JsonSchemaObject);
    const minItems = take('minItems');
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) rest.minItems = minItems;
  }

  // Whatever is left is unsupported by the API: keep it as a human-readable hint.
  const leftover = Object.entries(rest);
  if (leftover.length > 0) {
    const hint = '{' + leftover.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') + '}';
    out.description = out.description ? `${out.description}\n\n${hint}` : hint;
  }

  return out;
}

/**
 * Turn the pipeline's Zod schema into Anthropic's structured-output format. `$refStrategy: 'none'`
 * inlines every definition so the schema is self-contained.
 */
export function buildOutputFormat(zodSchema: ZodTypeAny): {
  type: 'json_schema';
  schema: JsonSchemaObject;
} {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    target: 'openAi',
    $refStrategy: 'none',
  }) as JsonSchemaObject;
  return { type: 'json_schema', schema: toAnthropicSchema(jsonSchema) };
}

/**
 * Map the provider-neutral request onto Anthropic's shape: the instructions (plus any
 * extra system-role input that differs from them) become the system prompt, everything
 * else becomes the conversation. The pipeline sends the instructions twice — as
 * `instructions` and as a system-role message — so identical text is sent once.
 */
export function splitInput(request: LLMAnalysisRequest): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemParts = [request.instructions];
  const messages: Anthropic.MessageParam[] = [];

  for (const message of request.input) {
    if (message.role === 'system') {
      if (message.content !== request.instructions) systemParts.push(message.content);
    } else {
      messages.push({ role: message.role, content: message.content });
    }
  }

  if (messages.length === 0) {
    throw new LLMRequestError('Anthropic requests need at least one user message', {
      code: 'empty_input',
      isRetryable: false,
      model: request.model,
    });
  }

  return { system: systemParts.join('\n\n'), messages };
}

/**
 * Anthropic (Claude) implementation of the LLM client interface.
 */
export class AnthropicLLMClient implements ILLMClient {
  private client: Anthropic;
  private defaultModel: string;
  private fallbackModel: string;
  private maxTokens: number;
  private hasApiKey: boolean;

  constructor(
    apiKey: string,
    defaultModel: string = ANTHROPIC_DEFAULT_MODEL,
    fallbackModel: string = ANTHROPIC_FALLBACK_MODEL,
    options?: { maxRetries?: number; timeoutMs?: number; maxTokens?: number }
  ) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.client = new Anthropic({
      apiKey,
      timeout: options?.timeoutMs ?? 150_000,
      maxRetries: options?.maxRetries ?? 0,
    });
    this.defaultModel = defaultModel;
    this.fallbackModel = fallbackModel;
    this.maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.hasApiKey = true;
  }

  async analyze(request: LLMAnalysisRequest): Promise<LLMAnalysisResponse> {
    try {
      // A config file written for OpenAI still names GPT models; fail with a clear message
      // instead of a bare 404 from the API.
      if (!/^claude-/i.test(request.model)) {
        throw new LLMRequestError(
          `Model "${request.model}" is not a Claude model. With the Anthropic provider set ` +
            `defaultModel / fallbackModel to Claude models (for example ${ANTHROPIC_DEFAULT_MODEL} ` +
            `and ${ANTHROPIC_FALLBACK_MODEL}) or remove them to use the defaults.`,
          { code: 'invalid_model', isRetryable: false, model: request.model }
        );
      }

      const { system, messages } = splitInput(request);

      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: this.maxTokens,
        system,
        messages,
        output_config: {
          ...outputConfigFor(request.model),
          format: buildOutputFormat(request.zodSchema),
        },
      });

      if (response.stop_reason === 'refusal') {
        const explanation = response.stop_details?.explanation;
        throw new LLMRequestError(
          `Anthropic declined the request${explanation ? `: ${explanation}` : ''}`,
          { code: 'refusal', isRetryable: false, model: request.model }
        );
      }

      if (response.stop_reason === 'max_tokens') {
        throw new LLMRequestError(
          `Anthropic response was cut off at ${this.maxTokens} output tokens; lower batchSize so each request has fewer rows`,
          { code: 'max_tokens', isRetryable: false, model: request.model }
        );
      }

      // Read by block type: Claude 5.x models may put a thinking block before the text.
      const rawText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!rawText) {
        throw new LLMRequestError('Anthropic response contained no text', {
          code: 'empty_response',
          isRetryable: false,
          model: request.model,
        });
      }

      const result = JSON.parse(rawText);

      return {
        result,
        rawText,
        model: request.model,
      };
    } catch (error) {
      throw normalizeLLMError(error, { model: request.model });
    }
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getFallbackModel(): string {
    return this.fallbackModel;
  }

  isConfigured(): boolean {
    return this.hasApiKey;
  }
}
