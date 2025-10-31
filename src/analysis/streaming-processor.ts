import { JsonLDWriter } from '../jsonld/types.js';
import { mergeRecordsByUuidMap } from '../emailUuid.js';
import { batchCleanupRequiredFields } from '../jsonld/index.js';
import type { JsonLdSchema } from '../jsonld/index.js';
import type { UuidIndex } from './checkpoint-manager.js';

/**
 * Streaming processor that handles incremental writing while preserving UUID merging
 */
export class StreamingProcessor {
  private readonly accumulatedResults: Map<string, Record<string, unknown>[]> = new Map();
  private readonly processedRowIndices: Set<number> = new Set();
  private readonly pendingUuids: Set<string> = new Set();
  private readonly completedUuids: Set<string> = new Set();
  private readonly writer: JsonLDWriter;
  private readonly rawJsonLdSchema: JsonLdSchema;
  private readonly schema: Record<string, unknown>;
  private readonly uuidIndex: UuidIndex;
  private currentRowIndex: number = 0;

  constructor(
    writer: JsonLDWriter,
    rawJsonLdSchema: JsonLdSchema,
    schema: Record<string, unknown>,
    uuidIndex: UuidIndex
  ) {
    if (!writer) {
      throw new Error('StreamingProcessor: Writer is required but not provided');
    }
    if (!rawJsonLdSchema) {
      throw new Error('StreamingProcessor: Raw JSON-LD schema is required but not provided');
    }
    if (!schema) {
      throw new Error('StreamingProcessor: Schema is required but not provided');
    }
    if (!uuidIndex) {
      throw new Error('StreamingProcessor: UUID index is required but not provided');
    }
    if (!uuidIndex.uuidToRowIndices || !(uuidIndex.uuidToRowIndices instanceof Map)) {
      throw new Error('StreamingProcessor: UUID index must contain a valid uuidToRowIndices Map');
    }
    if (typeof uuidIndex.totalRows !== 'number' || uuidIndex.totalRows < 0) {
      throw new Error(
        `StreamingProcessor: UUID index totalRows must be a non-negative number, got ${uuidIndex.totalRows}`
      );
    }

    this.writer = writer;
    this.rawJsonLdSchema = rawJsonLdSchema;
    this.schema = schema;
    this.uuidIndex = uuidIndex;
  }

  /**
   * Add batch results, tracking UUIDs and writing when complete
   */
  async addBatchResults(
    batchResults: Record<string, unknown>[],
    batchStartRowIndex: number
  ): Promise<void> {
    if (!Array.isArray(batchResults)) {
      throw new Error(
        `StreamingProcessor.addBatchResults: Expected array of results, got ${typeof batchResults}`
      );
    }
    if (typeof batchStartRowIndex !== 'number' || batchStartRowIndex < 0) {
      throw new Error(
        `StreamingProcessor.addBatchResults: batchStartRowIndex must be a non-negative number, got ${batchStartRowIndex}`
      );
    }
    if (batchResults.length === 0) {
      console.warn(
        `StreamingProcessor: Empty batch provided at row index ${batchStartRowIndex}. No processing needed.`
      );
      return;
    }

    // Process each result and group by UUID
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      const rowIndex = batchStartRowIndex + i;
      const person = result.person as Record<string, unknown>;
      let uuid = person?.userID;
      // Handle required field format: { "value": "uuid", "present": true }
      if (uuid && typeof uuid === 'object' && 'value' in uuid && typeof uuid.value === 'string') {
        uuid = uuid.value;
      }

      if (!uuid) {
        console.warn(
          `⚠️ Streaming processor: Row ${rowIndex} has no UUID (person.userID is ${typeof uuid}). This record will be skipped and may cause data loss.`
        );
        continue;
      }

      if (typeof uuid !== 'string') {
        console.warn(
          `⚠️ Streaming processor: Row ${rowIndex} has invalid UUID type '${typeof uuid}' (value: ${uuid}). Expected string. This record will be skipped.`
        );
        continue;
      }

      // Skip processing if this UUID is already completed (from checkpoint restoration)
      if (this.completedUuids.has(uuid)) {
        this.processedRowIndices.add(rowIndex);
        continue;
      }

      // Add to accumulated results for this UUID
      if (!this.accumulatedResults.has(uuid)) {
        this.accumulatedResults.set(uuid, []);
        this.pendingUuids.add(uuid);
      }
      this.accumulatedResults.get(uuid)!.push(result);
      this.processedRowIndices.add(rowIndex);

      // Check if we have all records for this UUID
      const expectedRowIndices = this.uuidIndex.uuidToRowIndices.get(uuid) || [];
      const hasAllRecords = expectedRowIndices.every((idx) => this.processedRowIndices.has(idx));

      if (hasAllRecords) {
        // We have all records for this UUID, can write it now
        const uuidResults = this.accumulatedResults.get(uuid)!;
        await this.writeCompletedUuid(uuid, uuidResults);
        this.accumulatedResults.delete(uuid);
        this.pendingUuids.delete(uuid);
        this.completedUuids.add(uuid);
      }
    }
  }

  /**
   * Write all records for a completed UUID
   */
  private async writeCompletedUuid(
    uuid: string,
    results?: Record<string, unknown>[]
  ): Promise<void> {
    try {
      const uuidResults = results || this.accumulatedResults.get(uuid);
      if (!uuidResults || uuidResults.length === 0) {
        console.warn(
          `Streaming processor: Attempted to write UUID '${uuid}' but no results found. This may indicate a logic error.`
        );
        return;
      }

      const cleanedResults = batchCleanupRequiredFields(uuidResults, this.rawJsonLdSchema);
      const mergedOutput = mergeRecordsByUuidMap(cleanedResults, this.schema);

      if (!Array.isArray(mergedOutput) || mergedOutput.length === 0) {
        console.warn(
          `Streaming processor: UUID '${uuid}' produced no output after cleanup and merging. ${uuidResults.length} input records were processed.`
        );
        return;
      }

      await this.writer.write(mergedOutput);

      if (!results) {
        this.accumulatedResults.delete(uuid);
      }
    } catch (error) {
      const writeError = error as Error;
      throw new Error(
        `Failed to write UUID '${uuid}': ${writeError.message}. This may indicate schema validation or output stream issues.`
      );
    }
  }

  /**
   * Final flush for any remaining results (shouldn't happen if index is correct)
   */
  async finalize(): Promise<void> {
    if (this.accumulatedResults.size > 0) {
      const pendingUuids = Array.from(this.accumulatedResults.keys());
      console.warn(
        `⚠️ Streaming processor finalization: ${pendingUuids.length} UUIDs still pending. This indicates UUID indexing may be incomplete.`
      );
      console.warn(
        `⚠️ Pending UUIDs (first 5): ${pendingUuids.slice(0, 5).join(', ')}${pendingUuids.length > 5 ? '...' : ''}`
      );

      for (const uuid of this.accumulatedResults.keys()) {
        try {
          await this.writeCompletedUuid(uuid);
        } catch (error) {
          const writeError = error as Error;
          console.error(`Failed to write UUID ${uuid} during finalization: ${writeError.message}`);
        }
      }
    }
  }

  /**
   * Get current memory usage info
   */
  getMemoryInfo(): { pendingUuids: number; totalProcessedRows: number } {
    return {
      pendingUuids: this.accumulatedResults.size,
      totalProcessedRows: this.processedRowIndices.size,
    };
  }

  /**
   * Set current row index for tracking (used when resuming)
   */
  setCurrentRowIndex(index: number): void {
    this.currentRowIndex = index;
  }

  /**
   * Restore streaming processor state from checkpoint
   */
  restoreFromCheckpoint(completedUuids: string[], pendingUuids: string[]): void {
    // Mark completed UUIDs so we don't reprocess them
    for (const uuid of completedUuids) {
      this.completedUuids.add(uuid);
    }

    // Mark pending UUIDs so we continue tracking them
    for (const uuid of pendingUuids) {
      this.pendingUuids.add(uuid);
    }
  }

  /**
   * Getter methods for checkpoint state
   */
  getUuidCache(): Map<string, Record<string, unknown>[]> {
    return this.accumulatedResults;
  }

  getPendingUuids(): Set<string> {
    return this.pendingUuids;
  }

  getCompletedUuids(): Set<string> {
    return this.completedUuids;
  }
}
