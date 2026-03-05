import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseManager } from '../src/database/index.js';
import { FileIngestionManager } from '../src/analysis/file-ingestion.js';
import { DbStreamingProcessor } from '../src/analysis/db-streaming-processor.js';
import { calculateFileHash } from '../src/utils/config-normalizer.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock logger
vi.mock('../src/logging.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    logValidationError: vi.fn(),
    parseZodError: vi.fn(),
    flushLogs: vi.fn(),
    logUuidGeneration: vi.fn(),
    logRetryAttempt: vi.fn(),
    logBatchOutcome: vi.fn(),
  }),
}));

// Mock LLM utilities
vi.mock('../src/jsonld/index.js', () => ({
  getLLMSchema: vi.fn(() => ({})),
  createJsonLDWriter: vi.fn(() => ({
    write: vi.fn(),
    finalize: vi.fn(),
  })),
  createAppendingJsonLDWriter: vi.fn(() => ({
    write: vi.fn(),
    finalize: vi.fn(),
  })),
  batchCleanupRequiredFields: vi.fn((results) => results),
}));

vi.mock('../src/emailUuid.js', () => ({
  mergeRecordsByUuidMap: vi.fn((results) => ({
    person: {
      userID: { value: 'test-uuid', present: true },
      name: { value: 'merged', present: true },
    },
  })),
  assignUuidsToBatch: vi.fn((batch) =>
    batch.map((row: any) => ({
      ...row,
      userID: row.userID || 'auto-uuid-' + Math.random().toString(36).substr(2, 9),
    }))
  ),
}));

describe('Multi-File, Resume & Recovery Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let db: DatabaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npa-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = new DatabaseManager(dbPath);
    db.connect();
  });

  afterEach(async () => {
    try {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Multi-file same-UUID merge into one entity', () => {
    it('should merge records from multiple files with same UUID into single merged output', async () => {
      // Simulate two files ingested with same UUID
      const uuid = 'user-123@example.com';

      // File 1: ingest 2 rows with same UUID
      const fileId1 = db.files.insertFile({
        file_path: '/data/file1.csv',
        file_hash: 'hash1',
        row_count: 2,
        status: 'completed',
      });

      db.rows.insertRowsBatch([
        {
          file_id: fileId1,
          file_row_index: 0,
          global_row_index: 0,
          uuid,
          raw_data: JSON.stringify({ name: 'John', email: uuid }),
        },
        {
          file_id: fileId1,
          file_row_index: 1,
          global_row_index: 1,
          uuid,
          raw_data: JSON.stringify({ age: 30, email: uuid }),
        },
      ]);

      // File 2: ingest 1 row with same UUID
      const fileId2 = db.files.insertFile({
        file_path: '/data/file2.csv',
        file_hash: 'hash2',
        row_count: 1,
        status: 'completed',
      });

      db.rows.insertRowsBatch([
        {
          file_id: fileId2,
          file_row_index: 0,
          global_row_index: 2,
          uuid,
          raw_data: JSON.stringify({ location: 'NYC', email: uuid }),
        },
      ]);

      // Record UUID with expected count from ingestion
      db.uuids.upsertUuid({ uuid, source_value: uuid, record_count: 3 });

      // Simulate LLM processing: add 3 results for same UUID
      db.results.insertProcessedResultsBatch([
        {
          row_id: 1,
          uuid,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid, present: true }, name: { value: 'John' } },
          }),
        },
        {
          row_id: 2,
          uuid,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid, present: true }, age: { value: 30 } },
          }),
        },
        {
          row_id: 3,
          uuid,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid, present: true }, location: { value: 'NYC' } },
          }),
        },
      ]);

      // Update processed counts
      db.uuids.incrementProcessedCount(uuid, 3);

      // Verify UUID is now complete (all 3 records processed)
      const isComplete = db.uuids.isUuidComplete(uuid);
      expect(isComplete).toBe(true);

      // Verify we can retrieve all results for merging
      const processedResults = db.results.getProcessedResultsByUuid(uuid);
      expect(processedResults).toHaveLength(3);

      // Store merged output
      db.results.upsertMergedOutput({
        uuid,
        merged_result: JSON.stringify({
          person: {
            userID: { value: uuid, present: true },
            name: { value: 'John', present: true },
            age: { value: 30, present: true },
            location: { value: 'NYC', present: true },
          },
        }),
      });

      // Verify merged output exists and is not written
      const unwritten = db.results.getUnwrittenMergedOutputs();
      const merged = unwritten.find((m) => m.uuid === uuid);
      expect(merged).toBeDefined();
      expect(merged?.written_to_file).toBe(0);

      // Mark as written
      db.results.markAsWritten(uuid);

      // Verify marked as written
      const written = db.results.getUnwrittenMergedOutputs();
      const stillUnwritten = written.find((m) => m.uuid === uuid);
      expect(stillUnwritten).toBeUndefined();
    });

    it('should handle multiple UUIDs across files without cross-contamination', async () => {
      const uuid1 = 'user-1@example.com';
      const uuid2 = 'user-2@example.com';

      // File 1: 2 rows with uuid1
      const fileId1 = db.files.insertFile({
        file_path: '/data/file1.csv',
        file_hash: 'hash1',
        row_count: 2,
        status: 'completed',
      });

      db.rows.insertRowsBatch([
        {
          file_id: fileId1,
          file_row_index: 0,
          global_row_index: 0,
          uuid: uuid1,
          raw_data: JSON.stringify({ data: 'user1-data1' }),
        },
        {
          file_id: fileId1,
          file_row_index: 1,
          global_row_index: 1,
          uuid: uuid1,
          raw_data: JSON.stringify({ data: 'user1-data2' }),
        },
      ]);

      // File 2: 1 row with uuid1, 2 rows with uuid2
      const fileId2 = db.files.insertFile({
        file_path: '/data/file2.csv',
        file_hash: 'hash2',
        row_count: 3,
        status: 'completed',
      });

      db.rows.insertRowsBatch([
        {
          file_id: fileId2,
          file_row_index: 0,
          global_row_index: 2,
          uuid: uuid1,
          raw_data: JSON.stringify({ data: 'user1-data3' }),
        },
        {
          file_id: fileId2,
          file_row_index: 1,
          global_row_index: 3,
          uuid: uuid2,
          raw_data: JSON.stringify({ data: 'user2-data1' }),
        },
        {
          file_id: fileId2,
          file_row_index: 2,
          global_row_index: 4,
          uuid: uuid2,
          raw_data: JSON.stringify({ data: 'user2-data2' }),
        },
      ]);

      // Record expected counts
      db.uuids.upsertUuid({ uuid: uuid1, source_value: uuid1, record_count: 3 });
      db.uuids.upsertUuid({ uuid: uuid2, source_value: uuid2, record_count: 2 });

      // Process results
      db.results.insertProcessedResultsBatch([
        {
          row_id: 1,
          uuid: uuid1,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid1, present: true } },
          }),
        },
        {
          row_id: 2,
          uuid: uuid1,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid1, present: true } },
          }),
        },
        {
          row_id: 3,
          uuid: uuid1,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid1, present: true } },
          }),
        },
        {
          row_id: 4,
          uuid: uuid2,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid2, present: true } },
          }),
        },
        {
          row_id: 5,
          uuid: uuid2,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid2, present: true } },
          }),
        },
      ]);

      // Update counts
      db.uuids.incrementProcessedCount(uuid1, 3);
      db.uuids.incrementProcessedCount(uuid2, 2);

      // Verify both are complete but distinct
      expect(db.uuids.isUuidComplete(uuid1)).toBe(true);
      expect(db.uuids.isUuidComplete(uuid2)).toBe(true);

      const results1 = db.results.getProcessedResultsByUuid(uuid1);
      const results2 = db.results.getProcessedResultsByUuid(uuid2);

      expect(results1).toHaveLength(3);
      expect(results2).toHaveLength(2);
    });
  });

  describe('Resume after interruption/failure without reprocessing', () => {
    it('should skip already processed rows on resume', async () => {
      // Create a small CSV file with 5 userIDs
      const csvPath = path.join(tempDir, 'resume_rows.csv');
      const csv = ['userID', 'u1', 'u2', 'u3', 'u4', 'u5'].join('\n');
      await fs.writeFile(csvPath, csv, 'utf-8');

      const ingestion = new FileIngestionManager(db, 1000);
      const result = await ingestion.ingestFile(csvPath, true);

      // Ensure rows were ingested
      const ingestedRows = db.rows.getRowsByFileId(result.fileId);
      expect(ingestedRows).toHaveLength(5);

      // Prepare a simple writer and processor
      const writes: unknown[] = [];
      const writer = {
        write: vi.fn(async (d: unknown) => writes.push(d)),
        finalize: vi.fn(async () => {}),
      };
      const processor = new DbStreamingProcessor(writer as any, {} as any, {} as any, db as any);

      // Simulate processing first 3 rows via the processor
      const firstThree = ingestedRows.slice(0, 3);
      const batchResults = firstThree.map((r) => ({
        person: { userID: { value: r.uuid, present: true } },
      }));
      const rowIds = firstThree.map((r) => r.row_id);

      await processor.addBatchResults(batchResults, rowIds);

      // Now unprocessed rows should be 2
      const unprocessedRows = db.rows.getUnprocessedRows();
      expect(unprocessedRows).toHaveLength(2);
      expect(unprocessedRows.map((r) => r.global_row_index)).toEqual([3, 4]);
    });

    it('should restore unwritten merged outputs on resume', () => {
      const uuid = 'resume-test-uuid';

      // Setup: UUID with completed results but unwritten merged output
      db.uuids.upsertUuid({ uuid, source_value: uuid, record_count: 1 });

      // Create raw row to satisfy FK constraint
      const fileId = db.files.insertFile({
        file_path: '/data/test.csv',
        file_hash: 'hash1',
        row_count: 1,
        status: 'completed',
      });
      db.rows.insertRowsBatch([
        {
          file_id: fileId,
          file_row_index: 0,
          global_row_index: 0,
          uuid,
          raw_data: '{}',
        },
      ]);

      db.results.insertProcessedResultsBatch([
        {
          row_id: 1,
          uuid,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid, present: true } },
          }),
        },
      ]);

      db.uuids.incrementProcessedCount(uuid, 1);

      // Store merged output but don't mark as written
      db.results.upsertMergedOutput({
        uuid,
        merged_result: JSON.stringify({
          person: { userID: { value: uuid, present: true }, name: { value: 'Test' } },
        }),
      });

      // Simulate resume: get unwritten outputs
      const unwritten = db.results.getUnwrittenMergedOutputs();
      expect(unwritten).toHaveLength(1);
      expect(unwritten[0].uuid).toBe(uuid);

      // Mark as written
      db.results.markAsWritten(uuid);

      // Verify now written
      const stillUnwritten = db.results.getUnwrittenMergedOutputs();
      expect(stillUnwritten).toHaveLength(0);
    });

    it('should not reprocess rows that were interrupted at processing stage', () => {
      const fileId = db.files.insertFile({
        file_path: '/data/test.csv',
        file_hash: 'hash1',
        row_count: 3,
        status: 'completed',
      });

      db.rows.insertRowsBatch([
        { file_id: fileId, file_row_index: 0, global_row_index: 0, uuid: 'u1', raw_data: '{}' },
        { file_id: fileId, file_row_index: 1, global_row_index: 1, uuid: 'u2', raw_data: '{}' },
        { file_id: fileId, file_row_index: 2, global_row_index: 2, uuid: 'u3', raw_data: '{}' },
      ]);

      // Create UUIDs to satisfy FK constraints
      db.uuids.upsertUuid({ uuid: 'u1', source_value: 'u1', record_count: 1 });
      db.uuids.upsertUuid({ uuid: 'u2', source_value: 'u2', record_count: 1 });

      // Partial processing: 2 results stored
      db.results.insertProcessedResultsBatch([
        { row_id: 1, uuid: 'u1', llm_result: '{}' },
        { row_id: 2, uuid: 'u2', llm_result: '{}' },
      ]);

      // On resume, only row 3 should need processing
      const unprocessedRows = db.rows.getUnprocessedRows();
      expect(unprocessedRows).toHaveLength(1);
      expect(unprocessedRows[0].global_row_index).toBe(2);

      // Verify rows 1 and 2 are in results
      const totalProcessed = db.results.getTotalProcessedCount();
      expect(totalProcessed).toBe(2);
    });
  });

  describe('Failed ingestion recovery path', () => {
    it('should allow re-ingestion after failed file with same hash', async () => {
      const filePath = path.join(tempDir, 'reingest.csv');
      const csv = ['userID', 'u1', 'u2'].join('\n');
      await fs.writeFile(filePath, csv, 'utf-8');

      // Compute the file hash and insert a prior failed record with that hash
      const fileHash = await calculateFileHash(filePath);

      const existingId = db.files.insertFile({
        file_path: '/data/test.csv',
        file_hash: fileHash,
        row_count: 0,
        status: 'processing',
      });

      db.files.markFileAsFailed(existingId, 'simulated error');
      const failed = db.files.getFileById(existingId);
      expect(failed?.status).toBe('failed');

      // Simulate prior upsert of UUID counts that may have occurred before crash
      db.uuids.upsertUuid({ uuid: 'u1', source_value: 'u1', record_count: 2 });
      db.uuids.upsertUuid({ uuid: 'u2', source_value: 'u2', record_count: 2 });

      // Now call the FileIngestionManager to re-ingest the real file
      const ingestion = new FileIngestionManager(db, 1000);
      const result = await ingestion.ingestFile(filePath, true);

      expect(result.skipped).toBe(false);
      expect(result.rowCount).toBe(2);

      const recovered = db.files.getFileByHash(fileHash);
      expect(recovered?.status).toBe('completed');

      // Ensure UUID record counts reflect the re-ingested rows (no double-count)
      const counts1 = db.uuids.getUuidCounts('u1');
      const counts2 = db.uuids.getUuidCounts('u2');
      expect(counts1?.recordCount).toBe(1);
      expect(counts2?.recordCount).toBe(1);
    });

    it('should cleanup orphaned placeholder UUIDs from failed processing', () => {
      const uuid = 'orphan-uuid';

      // Simulate: result stored before ingest (placeholder UUID)
      db.uuids.upsertUuid({ uuid, source_value: '', record_count: 0 });

      // Create raw row to satisfy FK constraint
      const fileId = db.files.insertFile({
        file_path: '/data/test.csv',
        file_hash: 'hash1',
        row_count: 1,
        status: 'completed',
      });
      db.rows.insertRowsBatch([
        {
          file_id: fileId,
          file_row_index: 0,
          global_row_index: 0,
          uuid,
          raw_data: '{}',
        },
      ]);

      // One result processed
      db.results.insertProcessedResultsBatch([
        {
          row_id: 1,
          uuid,
          llm_result: JSON.stringify({
            person: { userID: { value: uuid, present: true } },
          }),
        },
      ]);

      db.uuids.incrementProcessedCount(uuid, 1);

      // At this point: record_count=0, processed_count=1 (orphaned)
      const counts = db.uuids.getUuidCounts(uuid);
      expect(counts).toBeDefined();
      expect(counts?.recordCount).toBe(0);
      expect(counts?.processedCount).toBe(1);

      // Reconciliation step
      const reconciled = db.uuids.reconcileOrphanedUuids();
      expect(reconciled).toContain(uuid);

      // After reconciliation: record_count should equal processed_count
      const updatedCounts = db.uuids.getUuidCounts(uuid);
      expect(updatedCounts?.recordCount).toBe(1);
      expect(updatedCounts?.processedCount).toBe(1);

      // Now the UUID should be complete
      const isComplete = db.uuids.isUuidComplete(uuid);
      expect(isComplete).toBe(true);
    });

    it('should handle recovery when file status is stuck in processing', () => {
      const fileHash = 'stuck-hash';
      const filePath = '/data/stuck.csv';

      // File stuck in processing state
      const fileId = db.files.insertFile({
        file_path: filePath,
        file_hash: fileHash,
        row_count: 0,
        status: 'processing',
      });

      // Insert some rows
      db.rows.insertRowsBatch([
        { file_id: fileId, file_row_index: 0, global_row_index: 0, uuid: 'u1', raw_data: '{}' },
        { file_id: fileId, file_row_index: 1, global_row_index: 1, uuid: 'u2', raw_data: '{}' },
      ]);

      // Recovery: check status and clean if processing
      const file = db.files.getFileByHash(fileHash);
      expect(file?.status).toBe('processing');

      // If status is not completed, delete and re-ingest per FileIngestionManager logic
      if (file?.status !== 'completed') {
        db.files.deleteFile(file!.file_id);
      }

      // Verify cleaned up
      const afterCleanup = db.files.getFileByHash(fileHash);
      expect(afterCleanup).toBeUndefined();

      // New ingestion can proceed
      const newFileId = db.files.insertFile({
        file_path: filePath,
        file_hash: fileHash,
        row_count: 2,
        status: 'completed',
      });

      expect(newFileId).toBeGreaterThan(0);
    });
  });
});
