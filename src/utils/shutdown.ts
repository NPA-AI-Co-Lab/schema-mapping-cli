import ora, { Ora } from "ora";
import { bold } from "./ui.js";
import { JsonLdSchema } from "../jsonld/types.js";

type OutputWriter = {
  write: (results: Record<string, unknown>[]) => Promise<void>;
  finalize?: () => Promise<void>;
};

/**
 * Handle CLI shutdown (Ctrl+C without cleanup)
 */
export function handleCliShutdown() {
  console.log("\n" + bold(`⚠️  Process interrupted by user` + "\n"));
  process.exit(0);
}

/**
 * Handle analysis shutdown with cleanup
 */
export async function analysisShutDown(
  spinner: Ora,
  stopSpinnerUpdate: () => void,
  resultsWriter: OutputWriter,
  enableLogging: boolean = false,
  flushLogs?: () => Promise<void>
) {
  spinner.stop();
  stopSpinnerUpdate();

  console.log(bold("\n\n⚠️  Analysis interrupted - saving partial results..."));
  const finalizeSpinner = ora("Finalizing...").start();

  if (resultsWriter.finalize) {
    try {
      await resultsWriter.finalize();
    } catch {
      finalizeSpinner.fail("Failed to finalize output file");
    }
  }

  if (enableLogging && flushLogs) {
    try {
      await flushLogs();
    } catch {
      finalizeSpinner.fail("Failed to flush logs");
    }
  }

  finalizeSpinner.succeed("Partial results saved");
}

/**
 * Create shutdown handler with cleanup logic for partial results
 */
export function createShutdownHandlerWithCleanup(
  spinner: Ora,
  stopSpinnerUpdate: () => void,
  resultsWriter: OutputWriter,
  allResults: Record<string, unknown>[],
  batchCleanupRequiredFields: (results: Record<string, unknown>[], schema: JsonLdSchema) => Record<string, unknown>[],
  mergeRecordsByUuidMap: (results: Record<string, unknown>[], schema: JsonSchema) => Record<string, unknown>[],
  rawJsonLdSchema: JsonLdSchema,
  schema: JsonSchema,
  enableLogging: boolean = false,
  flushLogs?: () => Promise<void>,
  setErrorFlag?: () => void
) {
  let shuttingDown = false;

  const handleAnalysisShutdownWithCleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (setErrorFlag) {
      setErrorFlag();
    }

    try {
      if (allResults.length > 0) {
        console.log(`\n⚠️  Processing ${allResults.length} partial results before shutdown...`);
        const cleanedResults = batchCleanupRequiredFields(allResults, rawJsonLdSchema);
        const mergedOutput = mergeRecordsByUuidMap(cleanedResults, schema);
        await resultsWriter.write(mergedOutput);
      }
    } catch (cleanupError) {
      console.error("Failed to process partial results during shutdown:", cleanupError);
    }

    await analysisShutDown(
      spinner,
      stopSpinnerUpdate,
      resultsWriter,
      enableLogging,
      flushLogs
    );

    process.exit(0);
  };

  return handleAnalysisShutdownWithCleanup;
}

/**
 * Add SIGINT handler with cleanup removal
 */
export function withSigintHandler(handler: () => void | Promise<void>) {
  process.prependListener("SIGINT", handler);

  return () => {
    process.removeListener("SIGINT", handler);
  };
}
