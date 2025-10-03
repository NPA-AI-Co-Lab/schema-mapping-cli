import path from "path";
import ora, { Ora } from "ora";
import { convertJsonSchemaToZod } from "zod-from-json-schema";
import { resolveRefs } from "json-refs";
import pLimit from "p-limit";

import { ILLMClient } from "../interfaces/llm-client.interface.js";
import { LLMClientFactory } from "../clients/llm-client-factory.js";
import {
  loadInstructions,
  loadData,
  enumerateAsync,
  startSpinnerProgress,
  createShutdownHandlerWithCleanup,
  withSigintHandler,
  analysisShutDown,
  fixZodFromJsonSchema,
  loadJSON,
  loadGlobalConfig,
  runWithRetries,
  basePath
} from "../utils/index.js";
import { getLLMSchema, createJsonLDWriter, batchCleanupRequiredFields } from "../jsonld/index.js";
import { createLogger } from "../logging.js";
import { createPIIHandlers } from "../pii_handling.js";
import { mergeRecordsByUuidMap, assignUuidsToBatch } from "../emailUuid.js";
import { processBatch } from "./processor.js";

const INSTRUCTION_PATH = path.resolve(basePath, "static", "instructions.txt");

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
  quiet: boolean = false
) {
  const { BATCH_SIZE, CONC_SIZE, DEFAULT_MODEL } = loadGlobalConfig();

  const client = llmClient || LLMClientFactory.createFromEnv();

  const schema = getLLMSchema(schemaPath);
  const rawJsonLdSchema = loadJSON<JsonLdSchema>(schemaPath);

  const { resolved } = await resolveRefs(schema);
  const zodSchema = fixZodFromJsonSchema(
    resolved as JsonSchema,
    convertJsonSchemaToZod(resolved)
  );

  const inputFileName = path.basename(dataPath);
  const instructions = loadInstructions(INSTRUCTION_PATH, schema, inputFileName);

  const resultsWriter = createJsonLDWriter(outputPath, schemaPath);

  const { log, logValidationError, parseZodError, flushLogs } =
    createLogger(enableLogging);
  const { encodePII, decodePII } = createPIIHandlers(enablePiiProcessing);

  let spinner: Ora | null = null;
  let stopSpinnerUpdate: (() => void) | null = null;
  let processedRows = 0;
  
  if (!quiet) {
    spinner = ora("Starting analysis...").start();
    stopSpinnerUpdate = await startSpinnerProgress(
      spinner,
      () => processedRows,
      dataPath
    );
    spinner.color = "yellow";
  }

  const allResults: Record<string, unknown>[] = [];

  const handleAnalysisShutdown = createShutdownHandlerWithCleanup(
    spinner as Ora,
    stopSpinnerUpdate || (() => {}),
    resultsWriter,
    allResults,
    batchCleanupRequiredFields,
    mergeRecordsByUuidMap,
    rawJsonLdSchema,
    schema,
    enableLogging,
    flushLogs,
    () => { hasError = true; }
  );

  const restoreSigintHandlers = withSigintHandler(handleAnalysisShutdown);

  const limit = pLimit(CONC_SIZE);
  let hasError = false;
  const tasks = [];

  try {
    let csvRowCounter = 0;
    for await (const { index, batch } of enumerateAsync(
      loadData(dataPath, BATCH_SIZE)
    )) {
      if (hasError) break;
      
      const batchWithUuid = assignUuidsToBatch(batch);
      const { processedBatch, encodingMap } = encodePII(batchWithUuid);
      
      log(index, processedBatch).catch((err) => {
        console.error(`Failed to log batch ${index}:`, err);
      });

      const currentInput = [
        { role: "user" as const, content: JSON.stringify(processedBatch) },
      ];
      const currentCsvRowStart = csvRowCounter;
      csvRowCounter += batch.length;

      const task = limit(async () => {
        if (hasError) return;
        
        const args = {
          llmClient: client,
          instructions,
          zodSchema,
          batchLength: batch.length,
          index,
          input: currentInput,
          model: DEFAULT_MODEL,
          logValidationError,
          parseZodError,
          csvLineStart: currentCsvRowStart,
          decodePII,
          encodingMap,
          requiredFieldErrorsFailBatch
        };

        const processWithRetries = async () => {
          return await processBatch(args);
        };

        const processedResults = (await runWithRetries(
          processWithRetries,
          args,
          spinner as Ora,
          retriesNumber
        )) as Record<string, unknown>[];
        
        processedRows += batch.length;
        allResults.push(...processedResults);
      });
      
      tasks.push(task);
    }
    
    await Promise.all(tasks);
    await flushLogs();
  } catch (error) {
    hasError = true;
    restoreSigintHandlers();
    await analysisShutDown(
      spinner as Ora,
      stopSpinnerUpdate || (() => {}),
      resultsWriter,
      enableLogging,
      flushLogs
    );

    if (spinner) {
      spinner.stop();
    }
    throw error;
  }

  const cleanedResults = batchCleanupRequiredFields(allResults, rawJsonLdSchema);
  const mergedOutput = mergeRecordsByUuidMap(cleanedResults, schema);
  
  await resultsWriter.write(mergedOutput);
  if (resultsWriter.finalize) {
    await resultsWriter.finalize();
  }
  
  restoreSigintHandlers();
  if (stopSpinnerUpdate) {
    stopSpinnerUpdate();
  }
  
  if (outputPath) {
    if (spinner) {
      spinner.succeed(
        `Data analysis completed successfully! JSON-LD output saved to: ${outputPath}`
      );
    } else if (!quiet) {
      console.error(`✅ Data analysis completed successfully! JSON-LD output saved to: ${outputPath}`);
    }
  } else {
    // For stdout output, ensure spinner is stopped and write success message to stderr
    if (spinner) {
      spinner.stop();
    }
    if (!quiet) {
      console.error("✅ Data analysis completed successfully!");
    }
  }
}
