/**
 * Which LLM vendor the CLI talks to, and the environment-variable conventions for each.
 *
 * This module has no imports on purpose: both the client factory and the config helpers
 * read it, so it must not pull either of them in.
 */

export type LLMProvider = 'openai' | 'anthropic';

export const LLM_PROVIDERS: readonly LLMProvider[] = ['openai', 'anthropic'];

/** Default Claude models: Sonnet for the main pass, Haiku as the cheaper fallback. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_FALLBACK_MODEL = 'claude-haiku-5-5';

/** Default OpenAI models (unchanged from before the Anthropic provider existed). */
export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';
export const OPENAI_FALLBACK_MODEL = 'gpt-6-sol';

type Env = Record<string, string | undefined>;

export function isLLMProvider(value: unknown): value is LLMProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Decide which provider a run uses.
 *
 * 1. `LLM_PROVIDER` wins when set (`openai` or `anthropic`; anything else is an error).
 * 2. Otherwise the provider whose API key is present: OpenAI first, then Anthropic.
 * 3. With no key at all, OpenAI — so the "key is missing" error names the historical default.
 */
export function resolveProviderFromEnv(env: Env = process.env): LLMProvider {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (!isLLMProvider(explicit)) {
      throw new Error(
        `Unsupported LLM provider: ${env.LLM_PROVIDER} (expected one of: ${LLM_PROVIDERS.join(', ')})`
      );
    }
    return explicit;
  }
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'openai';
}

export function providerKeyEnvVar(provider: LLMProvider): 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

export function providerMaxRetriesEnvVar(
  provider: LLMProvider
): 'OPENAI_MAX_RETRIES' | 'ANTHROPIC_MAX_RETRIES' {
  return provider === 'anthropic' ? 'ANTHROPIC_MAX_RETRIES' : 'OPENAI_MAX_RETRIES';
}

export function providerDisplayName(provider: LLMProvider): 'OpenAI' | 'Anthropic' {
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
}

export function providerDefaultModels(provider: LLMProvider): {
  defaultModel: string;
  fallbackModel: string;
} {
  return provider === 'anthropic'
    ? { defaultModel: ANTHROPIC_DEFAULT_MODEL, fallbackModel: ANTHROPIC_FALLBACK_MODEL }
    : { defaultModel: OPENAI_DEFAULT_MODEL, fallbackModel: OPENAI_FALLBACK_MODEL };
}

/**
 * Cheap sanity check so a placeholder such as `your_api_key_here` is flagged before the
 * first request fails with a 401. OpenAI keys start with `sk-`, Anthropic keys with `sk-ant-`.
 */
export function looksLikeRealKey(provider: LLMProvider, apiKey: string): boolean {
  const prefix = provider === 'anthropic' ? 'sk-ant-' : 'sk-';
  return apiKey.startsWith(prefix) && apiKey.length >= 20;
}
