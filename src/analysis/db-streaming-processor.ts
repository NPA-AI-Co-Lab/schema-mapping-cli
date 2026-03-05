/**
 * Database-backed streaming processor for incremental writing with UUID merging
 * Replaces in-memory accumulation with database queries
 */

import { JsonLDWriter } from '../jsonld/types.js';
import { mergeRecordsByUuidMap } from '../emailUuid.js';
import { batchCleanupRequiredFields } from '../jsonld/index.js';
import type { JsonLdSchema } from '../jsonld/index.js';
import type { DatabaseManager } from '../database/index.js';

export class DbStreamingProcessor {
  private readonly writer: JsonLDWriter;
  private readonly rawJsonLdSchema: JsonLdSchema;
  private readonly schema: Record<string, unknown>;
  private readonly db: DatabaseManager;

  constructor(
    writer: JsonLDWriter,
    rawJsonLdSchema: JsonLdSchema,
    schema: Record<string, unknown>,
    db: DatabaseManager
  ) {
    if (!writer) {
      throw new Error('DbStreamingProcessor: Writer is required but not provided');
    }
    if (!rawJsonLdSchema) {
      throw new Error('DbStreamingProcessor: Raw JSON-LD schema is required but not provided');
    }
    if (!schema) {
      throw new Error('DbStreamingProcessor: Schema is required but not provided');
    }
    if (!db) {
      throw new Error('DbStreamingProcessor: Database manager is required but not provided');
    }

    this.writer = writer;
    this.rawJsonLdSchema = rawJsonLdSchema;
    this.schema = schema;
    this.db = db;
  }

  /**
   * Add batch results - stores in database and writes completed UUIDs
   */
  async addBatchResults(batchResults: Record<string, unknown>[], rowIds: number[]): Promise<void> {
    if (!Array.isArray(batchResults)) {
      throw new Error(
        `DbStreamingProcessor.addBatchResults: Expected array of results, got ${typeof batchResults}`
      );
    }
    if (!Array.isArray(rowIds) || rowIds.length !== batchResults.length) {
      throw new Error(
        `DbStreamingProcessor.addBatchResults: rowIds array must match batchResults length`
      );
    }
    if (batchResults.length === 0) {
      return;
    }

    // Store results in database
    const resultsToInsert = [];
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      const rowId = rowIds[i];
      
      const person = result.person as Record<string, unknown>;
      let uuid = person?.userID;
      
      // Handle required field format: { "value": "uuid", "present": true }
      if (uuid && typeof uuid === 'object' && 'value' in uuid && typeof uuid.value === 'string') {
        uuid = uuid.value;
      }

      if (!uuid || typeof uuid !== 'string') {
        console.warn(
          `⚠️  Row ${rowId} has invalid UUID (${typeof uuid}), skipping result storage`
        );
        continue;
      }

      resultsToInsert.push({
        row_id: rowId,
        uuid: uuid,
        llm_result: JSON.stringify(result),
      });
    }

    // Batch insert results
    if (resultsToInsert.length > 0) {
      // Ensure UUID registry has entries for all UUIDs referenced in this batch
      const uuidsInBatch = Array.from(new Set(resultsToInsert.map(r => r.uuid)));
      for (const u of uuidsInBatch) {
        if (!this.db.uuids.uuidExists(u)) {
          // Insert a placeholder UUID record so foreign key constraints are satisfied
          this.db.uuids.upsertUuid({ uuid: u, source_value: '', record_count: 0 });
        }
      }

      this.db.results.insertProcessedResultsBatch(resultsToInsert);
    }

    // Update UUID processed counts and check for completion
    const uuidsToCheck = new Set(resultsToInsert.map(r => r.uuid));

    this.db.uuids.syncUuidCounts(Array.from(uuidsToCheck));

    for (const uuid of uuidsToCheck) {
      // Check if UUID is now complete
      if (this.db.uuids.isUuidComplete(uuid)) {
        await this.writeCompletedUuid(uuid);
        this.db.uuids.updateUuidStatus(uuid, 'completed');
      }
    }
  }

  /**
   * Write all records for a completed UUID
   */
  private async writeCompletedUuid(uuid: string): Promise<void> {
    try {
      // Get all processed results for this UUID from database
      const processedResults = this.db.results.getProcessedResultsByUuid(uuid);

      if (processedResults.length === 0) {
        console.warn(
          `DbStreamingProcessor: Attempted to write UUID '${uuid}' but no results found in database`
        );
        return;
      }

      // Parse JSON results
      const uuidResults = processedResults.map(pr => JSON.parse(pr.llm_result));

      // Clean and merge results
      const cleanedResults = batchCleanupRequiredFields(uuidResults, this.rawJsonLdSchema);
      const mergedOutput = mergeRecordsByUuidMap(cleanedResults, this.schema);

      // Store merged output in database
      this.db.results.upsertMergedOutput({
        uuid: uuid,
        merged_result: JSON.stringify(mergedOutput),
      });

      // Write to file
      await this.writer.write(mergedOutput);

      // Mark as written
      this.db.results.markAsWritten(uuid);
    } catch (error) {
      const writeError = error as Error;
      console.error(
        `❌ Failed to write UUID '${uuid}': ${writeError.message}`
      );
      throw error;
    }
  }

  /**
   * Get count of completed UUIDs
   */
  getCompletedUuidCount(): number {
    return this.db.uuids.getCompletedUuids().length;
  }

  /**
   * Get all completed UUIDs
   */
  getCompletedUuids(): Set<string> {
    const completed = this.db.uuids.getCompletedUuids();
    return new Set(completed.map(u => u.uuid));
  }

  /**
   * Finalize writing and close file
   */
  async finalize(): Promise<void> {
    try {
      // Check for any UUIDs that are complete but not yet written
      const readyForMerging = this.db.uuids.getUuidsReadyForMerging();
      
      for (const uuid of readyForMerging) {
        await this.writeCompletedUuid(uuid);
        this.db.uuids.updateUuidStatus(uuid, 'completed');
      }

      // Finalize writer if method exists
      if (this.writer.finalize) {
        await this.writer.finalize();
      }
    } catch (error) {
      console.error('Error during streaming processor finalization:', error);
      throw error;
    }
  }

  /**
   * Get processing progress
   */
  getProgress(): {
    totalUuids: number;
    completedUuids: number;
    pendingUuids: number;
    totalRows: number;
    processedRows: number;
  } {
    const progress = this.db.state.getProcessingProgress();
    
    return {
      totalUuids: progress.total_uuids,
      completedUuids: progress.completed_uuids,
      pendingUuids: progress.pending_uuids,
      totalRows: progress.total_rows,
      processedRows: progress.processed_rows,
    };
  }

  /**
   * Restore from existing database state (for resume)
   */
  async restoreFromDatabase(): Promise<void> {
    // Reconcile placeholder UUIDs (where processed_count > 0 but record_count == 0)
    // so they can be considered ready for merging.
    const reconciled = this.db.uuids.reconcileOrphanedUuids();
    if (reconciled.length > 0) {
      console.log(`⚙️  Reconciled ${reconciled.length} placeholder UUID(s) from processed counts`);
    }

    // Check for any completed UUIDs that weren't written to file
    const unwrittenOutputs = this.db.results.getUnwrittenMergedOutputs();
    
    if (unwrittenOutputs.length > 0) {
      console.log(`📝 Found ${unwrittenOutputs.length} merged results not yet written to file`);
      
      for (const output of unwrittenOutputs) {
        const mergedData = JSON.parse(output.merged_result);
        await this.writer.write(mergedData);
        this.db.results.markAsWritten(output.uuid);
      }
    }
  }
}
