import { describeTaxonomySource, type TaxonomyResolution } from '../jsonld/taxonomy.js';

/**
 * Show configuration options summary.
 *
 * `taxonomies` is the *resolved* source (explicit | package | vendor plus the directory
 * actually used), not the configured value, so the summary reports what the run will really
 * read.
 */
export function showOptionsSummary(
  outputPath: string,
  enableLogging: boolean,
  hidePII: boolean,
  retriesNumber: number,
  rateLimitMaxRetries?: number,
  rateLimitMaxWaitMs?: number,
  sdkMaxRetries?: number,
  adaptiveConcurrency?: boolean,
  taxonomies?: TaxonomyResolution
) {
  console.log(`- Output path: ${outputPath}`);
  if (taxonomies) {
    console.log(`- Taxonomies: ${describeTaxonomySource(taxonomies)}`);
  }
  console.log(`- Logging: ${enableLogging ? 'enabled' : 'disabled'}`);
  console.log(`- PII protection: ${hidePII ? 'enabled' : 'disabled'}`);
  console.log(`- Retries set: ${retriesNumber}`);
  const maxWaitSec = ((rateLimitMaxWaitMs ?? 90000) / 1000).toFixed(0);
  const adaptiveStr = adaptiveConcurrency ? 'on' : 'off';
  console.log(
    `- Rate limits: retries ${rateLimitMaxRetries ?? 6}, max wait ${maxWaitSec}s, SDK retries ${sdkMaxRetries ?? 0}, adaptive concurrency ${adaptiveStr}\n`
  );
}
