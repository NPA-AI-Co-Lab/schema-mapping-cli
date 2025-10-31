import path from 'path';
import ora, { Ora } from 'ora';
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import { resolveRefs } from 'json-refs';
import pLimit from 'p-limit';
import { ZodTypeAny } from 'zod';

import { ILLMClient } from '../interfaces/llm-client.interface.js';
import { LLMClientFactory } from '../clients/llm-client-factory.js';
import {
  loadInstructions,
  loadData,
  enumerateAsync,
  startSpinnerProgress,
  withSigintHandler,
  analysisShutDown,
  fixZodFromJsonSchema,
  loadJSON,
  loadGlobalConfig,
  runWithRetries,
  basePath,
} from '../utils/index.js';
import {
  getLLMSchema,
  createJsonLDWriter,
  createAppendingJsonLDWriter,
  JsonLdSchema,
} from '../jsonld/index.js';
import { createLogger } from '../logging.js';
import { createPIIHandlers } from '../pii_handling/pii_handling.js';
import { assignUuidsToBatch, getUuidCache } from '../emailUuid.js';
import { processBatch } from './processor.js';
import { buildPartialSchema } from './rules/partial-schema.js';
import { loadRulesConfig, transformRow } from './rules/index.js';
import { StreamingProcessor } from './streaming-processor.js';
import { CheckpointManager, UuidIndex, CheckpointData } from './checkpoint-manager.js';
import type { DeterministicFieldResult, LlmFieldOverrides, LoadedRules } from './rules/index.js';

type JsonSchema = Record<string, unknown>;

const INSTRUCTION_PATH = path.resolve(basePath, 'static', 'instructions.txt');

/**
 * Main analysis function that processes CSV data using LLM
 */
export async function analyzeData(
  dataPath: string,
  schemaPath: string,
  outputPath: string,
  enableLogging: boolean = false,
  enablePiiProcessing: boolean = false,
  retriesNumber: number = 2,
  requiredFieldErrorsFailBatch: boolean = false,
  llmClient?: ILLMClient,
  quiet: boolean = false,
  uuidColumn?: string,
  rulesPath?: string,
  llmFieldOverrides?: LlmFieldOverrides,
  enableCheckpoints: boolean = true
) {
  const { BATCH_SIZE, CONC_SIZE, DEFAULT_MODEL } = loadGlobalConfig();

  let client = llmClient;

  const schema = getLLMSchema(schemaPath);
  const rawJsonLdSchema = loadJSON<JsonLdSchema>(schemaPath);

  const { resolved } = await resolveRefs(schema);
  const resolvedSchema = resolved as JsonSchema;
  const zodSchema = fixZodFromJsonSchema(resolvedSchema, convertJsonSchemaToZod(resolvedSchema));

  const inputFileName = path.basename(dataPath);
  const baseInstructions = loadInstructions(INSTRUCTION_PATH, schema, inputFileName);

  const {
    log,
    logValidationError,
    parseZodError,
    flushLogs,
    logUuidGeneration,
    logRetryAttempt,
    logBatchOutcome,
  } = createLogger(enableLogging);

  const { encodePII, decodePII } = createPIIHandlers(enablePiiProcessing);

  const rulesContext: LoadedRules | null = loadRulesConfig({
    rulesPath,
    schemaPath,
    overrides: llmFieldOverrides,
  });

  const partialSchemaCache = new Map<string, { instructions: string; zodSchema: ZodTypeAny }>();

  const checkpointManager = enableCheckpoints ? new CheckpointManager(outputPath) : null;
  const configHash = checkpointManager
    ? CheckpointManager.createConfigHash({
        dataPath,
        schemaPath,
        enablePiiProcessing,
        retriesNumber,
        requiredFieldErrorsFailBatch,
        uuidColumn,
        rulesPath,
        llmFieldOverrides,
        BATCH_SIZE,
        CONC_SIZE,
      })
    : '';

  if (!quiet) {
    console.log('🔍 Building UUID index for proper merging...');
  }

  let uuidIndex: UuidIndex;
  try {
    uuidIndex = await CheckpointManager.createUuidIndex(dataPath, BATCH_SIZE, uuidColumn);
  } catch (error) {
    const indexError = error as Error;
    throw new Error(
      `Failed to build UUID index, cannot proceed with processing: ${indexError.message}`
    );
  }

  if (!quiet) {
    console.log(
      `📊 Found ${uuidIndex.uuidToRowIndices.size} unique UUIDs across ${uuidIndex.totalRows} rows`
    );
  }

  let resumedFromCheckpoint = false;
  let checkpointData: CheckpointData | null = null;
  if (checkpointManager) {
    const checkpoint = await checkpointManager.loadCheckpoint();
    if (checkpoint && checkpointManager.isCheckpointValid(checkpoint, dataPath, configHash)) {
      if (!quiet) {
        console.log(
          `📁 Found valid checkpoint. Resuming processing (${checkpoint.completedUuids.length} UUIDs already completed)`
        );
      }
      resumedFromCheckpoint = true;
      checkpointData = checkpoint;
    } else if (checkpoint) {
      if (!quiet) {
        console.log('⚠️  Found checkpoint but configuration has changed. Starting fresh.');
      }
      await checkpointManager.clearCheckpoint();
    }
  }

  // Create writer after checkpoint decision - don't overwrite if resuming
  const resultsWriter = resumedFromCheckpoint
    ? createAppendingJsonLDWriter(outputPath, schemaPath)
    : createJsonLDWriter(outputPath, schemaPath);

  const streamingProcessor = new StreamingProcessor(
    resultsWriter,
    rawJsonLdSchema,
    schema,
    uuidIndex
  );

  // Restore streaming processor state if resuming from checkpoint
  if (resumedFromCheckpoint && checkpointData) {
    streamingProcessor.restoreFromCheckpoint(
      checkpointData.completedUuids,
      checkpointData.pendingUuids
    );
    const { setUuidCache } = await import('../emailUuid.js');
    setUuidCache(checkpointData.uuidCache);
  }

  const initialCompletedUuids = new Set<string>(streamingProcessor.getCompletedUuids());

  // Helper function to save checkpoint on interruption
  let currentBatchIndex = 0;
  let currentProcessedRows = 0;
  const saveInterruptionCheckpoint = async () => {
    if (checkpointManager && currentBatchIndex > 0) {
      try {
        // Calculate pending UUIDs: all UUIDs from index minus completed ones
        const allUuids = new Set(uuidIndex.uuidToRowIndices.keys());
        const completedUuids = streamingProcessor.getCompletedUuids();
        const pendingUuids = new Set([...allUuids].filter((uuid) => !completedUuids.has(uuid)));

        await checkpointManager.saveCheckpoint({
          lastProcessedBatchIndex: currentBatchIndex - 1, // Last completed batch
          totalBatches: 0,
          processedRows: currentProcessedRows,
          startTime: new Date().toISOString(),
          dataPath,
          outputPath,
          configHash,
          uuidCache: getUuidCache(),
          pendingUuids: pendingUuids,
          completedUuids: completedUuids,
        });
        if (!quiet) {
          console.log(
            `📁 Checkpoint saved at batch ${currentBatchIndex - 1} (${currentProcessedRows} rows processed)`
          );
        }
      } catch (error) {
        console.warn(`Failed to save interruption checkpoint: ${error}`);
      }
    }
  };

  const shouldRenderSpinner = !quiet && Boolean(outputPath);
  let spinner: Ora = ora({
    stream: process.stderr,
    isEnabled: shouldRenderSpinner,
  });
  let stopSpinnerUpdate: (() => void) | null = null;
  let processedRows = 0;

  if (!quiet) {
    const statusMessage = resumedFromCheckpoint ? 'Resuming analysis...' : 'Starting analysis...';
    spinner = ora(statusMessage).start();
    stopSpinnerUpdate = await startSpinnerProgress(spinner, () => processedRows, dataPath);
    spinner.color = 'yellow';
  }

  let hasError = false;
  const handleAnalysisShutdown = async () => {
    if (hasError) return;
    hasError = true;
    await saveInterruptionCheckpoint();
    try {
      await streamingProcessor.finalize();
    } catch (streamError) {
      console.error('Error finalizing stream during shutdown:', streamError);
    }
    // Compare completed UUIDs for shutdown message
    const currentCompleted = streamingProcessor.getCompletedUuids();
    let newResultsWritten = false;
    for (const uuid of currentCompleted) {
      if (!initialCompletedUuids.has(uuid)) {
        newResultsWritten = true;
        break;
      }
    }
    if (!newResultsWritten && currentCompleted.size !== initialCompletedUuids.size) {
      newResultsWritten = true;
    }
    await analysisShutDown(
      spinner as Ora,
      stopSpinnerUpdate || (() => {}),
      resultsWriter,
      enableLogging,
      flushLogs,
      newResultsWritten
    );
    if (spinner) spinner.stop();
    process.exit(0);
  };

  const restoreSigintHandlers = withSigintHandler(handleAnalysisShutdown);
  const limit = pLimit(CONC_SIZE);
  const tasks = [];

  try {
    let csvRowCounter = 0;
    let batchIndex = 0;
    for await (const { index, batch } of enumerateAsync(loadData(dataPath, BATCH_SIZE))) {
      if (hasError) break;

      const batchWithUuid = assignUuidsToBatch(batch, uuidColumn, logUuidGeneration);

      // Skip processing if all UUIDs in this batch are already completed (checkpoint optimization)
      if (resumedFromCheckpoint && checkpointData) {
        const completedUuids = new Set(checkpointData.completedUuids);
        const batchUuids = batchWithUuid.map((row) => row.userID as string).filter(Boolean);
        const allUuidsCompleted =
          batchUuids.length > 0 && batchUuids.every((uuid) => completedUuids.has(uuid));

        if (allUuidsCompleted) {
          csvRowCounter += batch.length;
          processedRows += batch.length;
          batchIndex++;
          continue;
        }
      }
      const { processedBatch, encodingMap } = encodePII(batchWithUuid);

      log(index, processedBatch).catch((err) => {
        const logError = err as Error;
        console.error(
          `Failed to log LLM input for batch ${index} (rows ${csvRowCounter - batch.length + 1}-${csvRowCounter}): ${logError.message}. Processing will continue but this batch won't be logged.`
        );
      });

      const currentInput = [{ role: 'user' as const, content: JSON.stringify(processedBatch) }];
      const currentCsvRowStart = csvRowCounter;
      csvRowCounter += batch.length;

      let deterministicPrefills: DeterministicFieldResult[] | undefined;

      if (rulesContext) {
        deterministicPrefills = processedBatch.map((row: RecordData, _: number) => {
          return transformRow(row, rulesContext!);
        });
      }

      const requiresLLM =
        !deterministicPrefills ||
        deterministicPrefills.some((prefill) => prefill.pendingFields.size > 0);

      if (requiresLLM && !client) {
        client = LLMClientFactory.createFromEnv();
      }

      const task = limit(async () => {
        if (hasError) return;

        let instructionsForBatch = baseInstructions;
        let schemaForBatch = zodSchema;

        if (requiresLLM && deterministicPrefills) {
          const pendingFields = new Set<string>();
          for (const prefill of deterministicPrefills) {
            for (const field of prefill.pendingFields) {
              pendingFields.add(field);
            }
          }

          const fieldList = Array.from(pendingFields).sort();
          if (fieldList.length > 0) {
            const cacheKey = fieldList.join('|');
            let cached = partialSchemaCache.get(cacheKey);
            if (!cached) {
              const partialSchema = buildPartialSchema(resolvedSchema, fieldList);
              const partialZodSchema = fixZodFromJsonSchema(
                partialSchema,
                convertJsonSchemaToZod(partialSchema)
              );
              const partialInstructions = loadInstructions(
                INSTRUCTION_PATH,
                partialSchema,
                inputFileName
              );
              cached = {
                instructions: partialInstructions,
                zodSchema: partialZodSchema,
              };
              partialSchemaCache.set(cacheKey, cached);
            }

            instructionsForBatch = cached.instructions;
            schemaForBatch = cached.zodSchema;
          }
        }

        const args = {
          llmClient: requiresLLM ? client : undefined,
          instructions: instructionsForBatch,
          zodSchema: schemaForBatch,
          batchLength: batch.length,
          index,
          input: currentInput,
          model: DEFAULT_MODEL,
          logValidationError,
          parseZodError,
          logRetryAttempt,
          csvLineStart: currentCsvRowStart,
          decodePII,
          encodingMap,
          requiredFieldErrorsFailBatch,
          prefills: deterministicPrefills,
        };

        const processWithRetries = async () => {
          const startTime = Date.now();
          try {
            const result = await processBatch(args);
            const processingTimeMs = Date.now() - startTime;

            await logBatchOutcome({
              batchIndex: index,
              csvLineRange: `${currentCsvRowStart}-${currentCsvRowStart + batch.length - 1}`,
              status: 'success',
              totalAttempts: 1,
              processingTimeMs,
            });

            return result;
          } catch (error) {
            const processingTimeMs = Date.now() - startTime;
            await logBatchOutcome({
              batchIndex: index,
              csvLineRange: `${currentCsvRowStart}-${currentCsvRowStart + batch.length - 1}`,
              status: 'failed',
              totalAttempts: retriesNumber + 1,
              processingTimeMs,
              finalErrorMessage: error instanceof Error ? error.message : String(error),
            });
            let errorMsg = '';
            if (error instanceof Error) {
              errorMsg = error.message;
            } else if (typeof error === 'object' && error !== null && 'message' in error) {
              errorMsg = String((error as { message: unknown }).message);
            } else {
              errorMsg = String(error);
            }
            if (!quiet) {
              console.error(`❌ Skipping batch index ${index} due to LLM error:`, errorMsg);
            }
            return [];
          }
        };

        const processedResults = (await runWithRetries(
          processWithRetries,
          args,
          spinner,
          retriesNumber
        )) as Record<string, unknown>[];

        await streamingProcessor.addBatchResults(processedResults, currentCsvRowStart);

        processedRows += batch.length;

        // Update tracking variables for checkpoint saving
        currentBatchIndex = batchIndex + 1; // Next batch index (for interruption checkpoint)
        currentProcessedRows = processedRows;
      });

      tasks.push(task);
      batchIndex++;
    }

    await Promise.all(tasks);
    await flushLogs();

    await streamingProcessor.finalize();
  } catch (error) {
    hasError = true;
    restoreSigintHandlers();
    try {
      await saveInterruptionCheckpoint();
    } catch (checkpointError) {
      console.warn(`Failed to save checkpoint during error: ${checkpointError}`);
    }

    try {
      await streamingProcessor.finalize();
    } catch (streamError) {
      console.error('Error finalizing stream during shutdown:', streamError);
    }

    const currentCompleted = streamingProcessor.getCompletedUuids();
    let newResultsWritten = false;
    for (const uuid of currentCompleted) {
      if (!initialCompletedUuids.has(uuid)) {
        newResultsWritten = true;
        break;
      }
    }
    if (!newResultsWritten && currentCompleted.size !== initialCompletedUuids.size) {
      newResultsWritten = true;
    }

    await analysisShutDown(
      spinner as Ora,
      stopSpinnerUpdate || (() => {}),
      resultsWriter,
      enableLogging,
      flushLogs,
      newResultsWritten
    );

    if (spinner) {
      spinner.stop();
    }
    throw error;
  }

  if (resultsWriter.finalize) {
    await resultsWriter.finalize();
  }

  if (checkpointManager) {
    await checkpointManager.clearCheckpoint();
  }

  restoreSigintHandlers();
  if (stopSpinnerUpdate) {
    stopSpinnerUpdate();
  }

  if (outputPath) {
    if (shouldRenderSpinner && !quiet) {
      spinner.succeed(
        `Data analysis completed successfully! JSON-LD output saved to: ${outputPath}`
      );
    } else if (!quiet) {
      console.error(
        `✅ Data analysis completed successfully! JSON-LD output saved to: ${outputPath}`
      );
    }
  } else {
    // For stdout output, ensure spinner state is cleared and write success message to stderr
    if (shouldRenderSpinner && !quiet) {
      spinner.stop();
    }
    if (!quiet) {
      console.error('✅ Data analysis completed successfully!');
    }
  }
}
