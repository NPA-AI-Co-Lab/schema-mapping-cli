import { ILLMClient } from '../interfaces/llm-client.interface.js';
import { OpenAILLMClient } from './openai-llm-client.js';

export interface LLMClientConfig {
  provider: string;
  apiKey: string;
  defaultModel?: string;
  fallbackModel?: string;
}

/**
 * Factory for creating LLM client instances
 */
export class LLMClientFactory {
  static create(config: LLMClientConfig): ILLMClient {
    switch (config.provider) {
      case 'openai':
        return new OpenAILLMClient(config.apiKey, config.defaultModel, config.fallbackModel);
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }

  static createFromEnv(): ILLMClient {
    const provider = process.env.LLM_PROVIDER || 'openai';
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    return LLMClientFactory.create({
      provider,
      apiKey,
      defaultModel: process.env.DEFAULT_MODEL || 'gpt-4.1',
      fallbackModel: process.env.FALLBACK_MODEL || 'gpt-4.1',
    });
  }
}
