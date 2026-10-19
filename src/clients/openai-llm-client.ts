import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  ILLMClient,
  LLMAnalysisRequest,
  LLMAnalysisResponse,
  LLMError,
} from '../interfaces/llm-client.interface.js';
import { normalizeLLMError } from './llm-errors.js';

/** Reasoning models (o-series, gpt-5 and gpt-6 families) reject `temperature` while reasoning is on. */
const REASONING_MODEL = /^(o\d|gpt-5|gpt-6)/i;
/** Reasoning models that accept `reasoning.effort: 'none'` (checked against the API in October 2026). */
const REASONING_OFF_MODEL = /^(gpt-5\.\d|gpt-6-(sol|luna))/i;

/**
 * Sampling parameters for a Responses API request. Classic models get `temperature`. Reasoning models that can
 * turn reasoning off get `effort: 'none'` plus `temperature`, which keeps extraction fast and deterministic.
 * The remaining reasoning models (gpt-5, gpt-5-mini, gpt-6-astra, gpt-6.1-sol, o-series) are called with
 * their default settings, because they reject both.
 */
export function samplingParams(model: string, temperature: number): Record<string, unknown> {
  if (!REASONING_MODEL.test(model)) return { temperature };
  if (REASONING_OFF_MODEL.test(model)) return { reasoning: { effort: 'none' }, temperature };
  return {};
}

/**
 * OpenAI implementation of the LLM client interface
 */
export class OpenAILLMClient implements ILLMClient {
  private client: OpenAI;
  private defaultModel: string;
  private fallbackModel: string;

  constructor(
    apiKey: string,
    defaultModel: string = 'gpt-6-luna',
    fallbackModel: string = 'gpt-6-sol',
    options?: { maxRetries?: number; timeoutMs?: number }
  ) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey,
      timeout: options?.timeoutMs ?? 150_000,
      maxRetries: options?.maxRetries ?? 0,
    });
    this.defaultModel = defaultModel;
    this.fallbackModel = fallbackModel;
  }

  async analyze(request: LLMAnalysisRequest): Promise<LLMAnalysisResponse> {
    try {
      const response = await this.client.responses.create({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        ...samplingParams(request.model, request.temperature ?? 0),
        text: {
          format: zodTextFormat(request.zodSchema, 'entities'),
        },
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming);

      if (response.error) {
        const error = new Error(`OpenAI API error: ${response.error.message}`) as LLMError;
        error.code = response.error.code || 'OPENAI_ERROR';
        error.type = 'openai_error';
        throw error;
      }

      const result = JSON.parse(response.output_text);

      return {
        result,
        rawText: response.output_text,
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
    try {
      // Try to access the API key through the client
      return !!this.client.apiKey;
    } catch {
      return false;
    }
  }
}
