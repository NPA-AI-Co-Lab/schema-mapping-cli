import { ILLMClient } from '../interfaces/llm-client.interface.js';
import { OpenAILLMClient } from './openai-llm-client.js';
import { AnthropicLLMClient } from './anthropic-llm-client.js';
import {
  LLMProvider,
  looksLikeRealKey,
  providerDefaultModels,
  providerDisplayName,
  providerKeyEnvVar,
  providerMaxRetriesEnvVar,
  resolveProviderFromEnv,
} from './llm-provider.js';

export interface LLMClientConfig {
  provider: string;
  apiKey: string;
  defaultModel?: string;
  fallbackModel?: string;
  maxRetries?: number;
}

/**
 * Factory for creating LLM client instances
 */
export class LLMClientFactory {
  private static warnedAboutClamp = false;
  private static warnedAboutPlaceholderKey = false;

  static create(config: LLMClientConfig): ILLMClient {
    const maxRetries = config.maxRetries ?? 0;
    const clampedMaxRetries = LLMClientFactory.clampMaxRetries(maxRetries);

    switch (config.provider) {
      case 'openai':
        return new OpenAILLMClient(config.apiKey, config.defaultModel, config.fallbackModel, {
          maxRetries: clampedMaxRetries,
        });
      case 'anthropic':
        return new AnthropicLLMClient(config.apiKey, config.defaultModel, config.fallbackModel, {
          maxRetries: clampedMaxRetries,
        });
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }

  /**
   * Build the client from environment variables. The provider comes from `LLM_PROVIDER`
   * or, when that is unset, from whichever API key is present (see `resolveProviderFromEnv`).
   */
  static createFromEnv(overrides?: { maxRetries?: number }): ILLMClient {
    const provider = resolveProviderFromEnv();
    const keyEnvVar = providerKeyEnvVar(provider);
    const apiKey = process.env[keyEnvVar];

    if (!apiKey) {
      throw new Error(`${keyEnvVar} environment variable is required`);
    }

    LLMClientFactory.warnAboutPlaceholderKey(provider, apiKey);

    const envMaxRetriesRaw = process.env[providerMaxRetriesEnvVar(provider)];
    const envMaxRetries = envMaxRetriesRaw ? parseInt(envMaxRetriesRaw, 10) : undefined;
    const maxRetries = overrides?.maxRetries ?? envMaxRetries;

    const defaults = providerDefaultModels(provider);

    return LLMClientFactory.create({
      provider,
      apiKey,
      defaultModel: process.env.DEFAULT_MODEL || defaults.defaultModel,
      fallbackModel: process.env.FALLBACK_MODEL || defaults.fallbackModel,
      maxRetries,
    });
  }

  private static warnAboutPlaceholderKey(provider: LLMProvider, apiKey: string): void {
    if (!this.warnedAboutPlaceholderKey) {
      if (!looksLikeRealKey(provider, apiKey)) {
        console.warn(
          `${providerKeyEnvVar(provider)} does not look like a real ${providerDisplayName(provider)} key. The AI path will fail with 401 if this is a placeholder.`
        );
        this.warnedAboutPlaceholderKey = true;
      }
    }
  }

  private static clampMaxRetries(maxRetries: number): number {
    if (maxRetries < 0 || maxRetries > 5) {
      if (!this.warnedAboutClamp) {
        console.warn(`LLM SDK maxRetries clamped to [0, 5] range from ${maxRetries}`);
        this.warnedAboutClamp = true;
      }
      return Math.max(0, Math.min(5, maxRetries));
    }
    return maxRetries;
  }
}
