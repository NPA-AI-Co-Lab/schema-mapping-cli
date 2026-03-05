import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/database/index.js';
import { FileIngestionManager } from '../src/analysis/file-ingestion.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('forceReingestion behavior', () => {
  let tempDir: string;
  let dbPath: string;
  let testFilePath: string;
  let db: DatabaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npa-force-reingest-test-'));
    dbPath = path.join(tempDir, 'test.db');
    testFilePath = path.join(tempDir, 'test.csv');
    
    db = new DatabaseManager(dbPath);
    db.connect();
  });

  afterEach(async () => {
    try {
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should signal reingestion and allow pipeline to invalidate all merged outputs', async () => {
    // Create initial CSV file
    const initialContent = `email,name,age
test@example.com,Alice,30
test@example.com,Alice,31`;
    await fs.writeFile(testFilePath, initialContent);

    // Initial ingestion
    const ingestionManager1 = new FileIngestionManager(db, 100, 'email', undefined, false);
    const result1 = await ingestionManager1.ingestFile(testFilePath);
    
    expect(result1.skipped).toBe(false);
    expect(result1.reingested).toBe(false);
    expect(result1.rowCount).toBe(2);
    expect(result1.uuidCount).toBe(1); // Both rows have same email

    // Simulate processing: insert processed results
    const rows = db.rows.getRowsByFileId(result1.fileId);
    const uuid = rows[0].uuid;
    
    for (const row of rows) {
      db.results.insertProcessedResult({
        row_id: row.row_id,
        uuid: row.uuid,
        llm_result: JSON.stringify({ person: { userID: row.uuid, name: 'Alice' } }),
      });
    }

    // Manually sync counts and create merged output (simulating what the processor does)
    db.uuids.syncUuidCounts([uuid]);
    db.results.upsertMergedOutput({
      uuid: uuid,
      merged_result: JSON.stringify({ person: { userID: uuid, name: 'Alice', age: [30, 31] } }),
    });
    db.results.markAsWritten(uuid);

    // Verify merged_output exists and is written
    const mergedBefore = db.results.getMergedOutput(uuid);
    expect(mergedBefore).not.toBeNull();
    expect(mergedBefore?.written_to_file).toBe(1);

    // Modify file content (same UUID, different data)
    const updatedContent = `email,name,age
test@example.com,Alice,32
test@example.com,Alice,33
test@example.com,Alice,34`;
    await fs.writeFile(testFilePath, updatedContent);

    // Re-ingest with forceReingestion=true
    const ingestionManager2 = new FileIngestionManager(db, 100, 'email', undefined, true);
    const result2 = await ingestionManager2.ingestFile(testFilePath);

    expect(result2.skipped).toBe(false);
    expect(result2.reingested).toBe(true); // Should signal that reingestion happened
    expect(result2.rowCount).toBe(3); // New file has 3 rows
    expect(result2.uuidCount).toBe(1); // Still same UUID

    // Simulate processing the new rows
    const newRows = db.rows.getRowsByFileId(result2.fileId);
    for (const row of newRows) {
      db.results.insertProcessedResult({
        row_id: row.row_id,
        uuid: row.uuid,
        llm_result: JSON.stringify({ person: { userID: row.uuid, name: 'Alice' } }),
      });
    }

    // Sync counts
    db.uuids.syncUuidCounts([uuid]);

    // The merged_output was deleted during file deletion
    // This is correct - pipeline should detect reingestion=true and invalidate all merged outputs
    const mergedAfter = db.results.getMergedOutput(uuid);
    expect(mergedAfter).toBeFalsy(); // Correctly deleted (null or undefined)
    
    // Simulate what the pipeline does when it detects reingestion
    // It would call resetAllToUnwritten() and use fresh writer
    // Let's verify that works:
    
    // Create new merged output as if processing completed
    db.results.upsertMergedOutput({
      uuid: uuid,
      merged_result: JSON.stringify({ person: { userID: uuid, name: 'Alice', age: [32, 33, 34] } }),
    });
    db.results.markAsWritten(uuid);
    
    const mergedAfterProcessing = db.results.getMergedOutput(uuid);
    expect(mergedAfterProcessing).not.toBeNull();
    expect(mergedAfterProcessing?.written_to_file).toBe(1);
    
    // Pipeline would reset all to unwritten when reingestion is detected
    db.results.resetAllToUnwritten();
    
    const mergedAfterReset = db.results.getMergedOutput(uuid);
    expect(mergedAfterReset).not.toBeNull();
    expect(mergedAfterReset?.written_to_file).toBe(0); // Reset to unwritten
    expect(mergedAfterReset?.written_at).toBeNull();
  });

  it('should delete all related data when deleting a file', async () => {
    // Create two CSV files with overlapping UUIDs
    const file1Content = `email,name,score
shared@example.com,Alice,100
unique1@example.com,Bob,200`;
    const file1Path = path.join(tempDir, 'file1.csv');
    await fs.writeFile(file1Path, file1Content);

    const file2Content = `email,name,score
shared@example.com,Alice,150
unique2@example.com,Charlie,300`;
    const file2Path = path.join(tempDir, 'file2.csv');
    await fs.writeFile(file2Path, file2Content);

    // Ingest both files
    const ingestionManager = new FileIngestionManager(db, 100, 'email', undefined, false);
    const result1 = await ingestionManager.ingestFile(file1Path);
    const result2 = await ingestionManager.ingestFile(file2Path);

    expect(result1.rowCount).toBe(2);
    expect(result2.rowCount).toBe(2);

    // Process all rows for 'shared@example.com'
    const sharedUuid = db.rows.getRowsByFileId(result1.fileId)[0].uuid;
    const allRows = db.rows.getRowsByUuid(sharedUuid);
    expect(allRows.length).toBe(2); // One from each file

    for (const row of allRows) {
      db.results.insertProcessedResult({
        row_id: row.row_id,
        uuid: row.uuid,
        llm_result: JSON.stringify({ person: { userID: row.uuid, name: 'Alice' } }),
      });
    }

    // Sync and mark as written
    db.uuids.syncUuidCounts([sharedUuid]);
    db.results.upsertMergedOutput({
      uuid: sharedUuid,
      merged_result: JSON.stringify({ person: { userID: sharedUuid, name: 'Alice', scores: [100, 150] } }),
    });
    db.results.markAsWritten(sharedUuid);

    // Verify written status before deletion
    const mergedBefore = db.results.getMergedOutput(sharedUuid);
    expect(mergedBefore?.written_to_file).toBe(1);

    // Delete file1 (which contains one row for shared UUID)
    db.files.deleteFile(result1.fileId);

    // Merged_output for shared UUID should be deleted (it's now stale/incomplete)
    const mergedAfterDelete = db.results.getMergedOutput(sharedUuid);
    expect(mergedAfterDelete).toBeFalsy(); // Deleted (null or undefined)
    
    // UUID record still exists (has data from file2)
    const uuidAfterDelete = db.uuids.getUuid(sharedUuid);
    expect(uuidAfterDelete).not.toBeNull();
    expect(uuidAfterDelete?.record_count).toBe(1); // Only 1 remaining row (from file2)
    
    // When file is re-ingested, pipeline will detect reingestion and invalidate all outputs
    // ensuring fresh output generation
  });
});
