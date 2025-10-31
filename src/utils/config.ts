import dotenv from 'dotenv';
import { EnvConfig, AppConfig } from './types.js';
import { loadJSON } from './file-system.js';
import path from 'path';

dotenv.config({ quiet: true });

/**
 * Load and validate environment configuration
 */
export function loadEnvConfig(): EnvConfig {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
}

/**
 * Load application configuration from config.json
 */
export function loadAppConfig(configPath?: string): AppConfig {
  const configFile = configPath || path.resolve(process.cwd(), 'config.json');
  return loadJSON<AppConfig>(configFile);
}

/**
 * Load configuration values globally (similar to loadEnvConfig approach)
 * This makes config values available as constants throughout the app
 */
export function loadGlobalConfig(configPath?: string) {
  const config = loadAppConfig(configPath);
  return {
    BATCH_SIZE: config.batchSize,
    CONC_SIZE: config.concurrencySize,
    DEFAULT_MODEL: config.defaultModel,
    FALLBACK_MODEL: config.fallbackModel,
  };
}

/**
 * Get batch size from configuration
 */
export function getBatchSize(config?: AppConfig): number {
  return config?.batchSize ?? 5;
}

/**
 * Get concurrency size from configuration
 */
export function getConcurrencySize(config?: AppConfig): number {
  return config?.concurrencySize ?? 5;
}

/**
 * Get default model from configuration
 */
export function getDefaultModel(config?: AppConfig): string {
  return config?.defaultModel ?? 'gpt-4.1-mini';
}

/**
 * Get fallback model from configuration
 */
export function getFallbackModel(config?: AppConfig): string {
  return config?.fallbackModel ?? 'gpt-4.1';
}

/**
 * Check if OpenAI API key is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Get OpenAI API key or throw error
 */
export function getOpenAIAPIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return apiKey;
}
