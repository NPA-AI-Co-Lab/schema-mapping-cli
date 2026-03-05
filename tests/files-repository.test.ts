import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/database/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FilesRepository.deleteFile()', () => {
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
      // ignore
    }
  });

  it('recomputes counts from remaining database rows/results after file deletion', () => {
    // Insert a file and one raw row for uuid 'u1'
    const fileId = db.files.insertFile({
      file_path: '/data/f.csv',
      file_hash: 'h1',
      row_count: 1,
      status: 'completed',
    });

    db.rows.insertRowsBatch([
      { file_id: fileId, file_row_index: 0, global_row_index: 0, uuid: 'u1', raw_data: '{}' },
    ]);

    // Simulate prior (inflated) upsert that would double-count
    db.uuids.upsertUuid({ uuid: 'u1', source_value: 'u1', record_count: 4 });

    // Simulate stale aggregate state before deletion
    db.uuids.incrementProcessedCount('u1', 3);

    // Delete the file (this should recompute counts for 'u1')
    db.files.deleteFile(fileId);

    const counts = db.uuids.getUuidCounts('u1');
    // Empty affected UUIDs are pruned.
    expect(counts).toBeNull();
  });
});
