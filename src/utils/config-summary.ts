/**
 * Show configuration options summary
 */
export function showOptionsSummary(
  outputPath: string,
  enableLogging: boolean,
  hidePII: boolean,
  retriesNumber: number
) {
  console.log(`- Output path: ${outputPath}`);
  console.log(`- Logging: ${enableLogging ? 'enabled' : 'disabled'}`);
  console.log(`- PII protection: ${hidePII ? 'enabled' : 'disabled'}`);
  console.log(`- Retries set: ${retriesNumber}\n`);
}
