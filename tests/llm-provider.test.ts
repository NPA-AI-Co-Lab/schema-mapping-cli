import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveProviderFromEnv,
  providerKeyEnvVar,
  providerMaxRetriesEnvVar,
  providerDisplayName,
  providerDefaultModels,
  looksLikeRealKey,
  isLLMProvider,
} from '../src/clients/llm-provider.js';
import { getDefaultModel, getFallbackModel } from '../src/utils/config.js';

// These tests check how the CLI decides whether to talk to OpenAI or to Claude (Anthropic),
// and which model names it falls back to when the config file does not name any.

const ENV_KEYS = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

describe('llm-provider', () => {
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
  });

  describe('resolveProviderFromEnv', () => {
    it('defaults to OpenAI when no key and no LLM_PROVIDER are set', () => {
      expect(resolveProviderFromEnv({})).toBe('openai');
    });

    it('picks OpenAI when only OPENAI_API_KEY is set', () => {
      expect(resolveProviderFromEnv({ OPENAI_API_KEY: 'sk-x' })).toBe('openai');
    });

    it('picks Anthropic when only ANTHROPIC_API_KEY is set', () => {
      expect(resolveProviderFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('anthropic');
    });

    it('prefers OpenAI when both keys are set and LLM_PROVIDER is absent (no behavior change for existing users)', () => {
      expect(
        resolveProviderFromEnv({ OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-ant-x' })
      ).toBe('openai');
    });

    it('lets LLM_PROVIDER override key detection, case-insensitively', () => {
      expect(
        resolveProviderFromEnv({
          LLM_PROVIDER: 'Anthropic',
          OPENAI_API_KEY: 'sk-x',
          ANTHROPIC_API_KEY: 'sk-ant-x',
        })
      ).toBe('anthropic');
      expect(
        resolveProviderFromEnv({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant-x' })
      ).toBe('openai');
    });

    it('rejects an unknown LLM_PROVIDER value with a helpful message', () => {
      expect(() => resolveProviderFromEnv({ LLM_PROVIDER: 'gemini' })).toThrow(
        /Unsupported LLM provider: gemini .*openai, anthropic/
      );
    });

    it('reads process.env by default', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      expect(resolveProviderFromEnv()).toBe('anthropic');
    });
  });

  describe('provider lookups', () => {
    it('maps each provider to its key, retries variable and display name', () => {
      expect(providerKeyEnvVar('openai')).toBe('OPENAI_API_KEY');
      expect(providerKeyEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY');
      expect(providerMaxRetriesEnvVar('openai')).toBe('OPENAI_MAX_RETRIES');
      expect(providerMaxRetriesEnvVar('anthropic')).toBe('ANTHROPIC_MAX_RETRIES');
      expect(providerDisplayName('openai')).toBe('OpenAI');
      expect(providerDisplayName('anthropic')).toBe('Anthropic');
    });

    it('returns the documented default models per provider', () => {
      expect(providerDefaultModels('openai')).toEqual({
        defaultModel: 'gpt-6-luna',
        fallbackModel: 'gpt-6-sol',
      });
      expect(providerDefaultModels('anthropic')).toEqual({
        defaultModel: 'claude-sonnet-5-5',
        fallbackModel: 'claude-haiku-5-5',
      });
    });

    it('recognises only the supported provider names', () => {
      expect(isLLMProvider('openai')).toBe(true);
      expect(isLLMProvider('anthropic')).toBe(true);
      expect(isLLMProvider('claude')).toBe(false);
      expect(isLLMProvider(undefined)).toBe(false);
    });
  });

  describe('looksLikeRealKey', () => {
    it('accepts keys with the vendor prefix and a plausible length', () => {
      expect(looksLikeRealKey('openai', 'sk-' + 'a'.repeat(40))).toBe(true);
      expect(looksLikeRealKey('anthropic', 'sk-ant-' + 'a'.repeat(40))).toBe(true);
    });

    it('rejects placeholders and keys with the wrong vendor prefix', () => {
      expect(looksLikeRealKey('openai', 'your_api_key_here')).toBe(false);
      expect(looksLikeRealKey('anthropic', 'sk-' + 'a'.repeat(40))).toBe(false);
      expect(looksLikeRealKey('anthropic', 'sk-ant-short')).toBe(false);
    });
  });

  describe('config defaults follow the provider', () => {
    it('uses the GPT defaults when OpenAI is the provider', () => {
      process.env.OPENAI_API_KEY = 'sk-x';
      expect(getDefaultModel()).toBe('gpt-6-luna');
      expect(getFallbackModel()).toBe('gpt-6-sol');
    });

    it('uses the Claude defaults when Anthropic is the provider', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      expect(getDefaultModel()).toBe('claude-sonnet-5-5');
      expect(getFallbackModel()).toBe('claude-haiku-5-5');
    });

    it('still honours explicit models from the config file', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      const config = { defaultModel: 'claude-opus-5-5', fallbackModel: 'claude-sonnet-5-5' } as any;
      expect(getDefaultModel(config)).toBe('claude-opus-5-5');
      expect(getFallbackModel(config)).toBe('claude-sonnet-5-5');
    });
  });
});
