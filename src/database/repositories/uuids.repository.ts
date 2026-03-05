/**
 * Repository for UUID tracking operations
 */

import { BaseRepository } from './base.repository.js';
import type { DbUuid, InsertUuid, UuidStatus, UuidStatusSummary } from '../types.js';
import type Database from 'better-sqlite3';

export class UuidsRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  /**
   * Insert a new UUID
   */
  insertUuid(uuid: InsertUuid): void {
    const stmt = this.db.prepare(`
      INSERT INTO uuids (uuid, source_value, first_seen_at, status, record_count)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    
    stmt.run(
      uuid.uuid,
      uuid.source_value,
      this.now(),
      uuid.record_count
    );
  }

  /**
   * Batch insert UUIDs
   */
  insertUuidsBatch(uuids: InsertUuid[]): void {
    if (uuids.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO uuids (uuid, source_value, first_seen_at, status, record_count)
      VALUES (?, ?, ?, 'pending', ?)
    `);

    const insertMany = this.db.transaction(() => {
      const now = this.now();
      for (const uuid of uuids) {
        stmt.run(uuid.uuid, uuid.source_value, now, uuid.record_count);
      }
    });

    insertMany();
  }

  /**
   * Upsert UUID (insert or update record count if exists)
   */
  upsertUuid(uuid: InsertUuid): void {
    const stmt = this.db.prepare(`
      INSERT INTO uuids (uuid, source_value, first_seen_at, status, record_count)
      VALUES (?, ?, ?, 'pending', ?)
      ON CONFLICT(uuid) DO UPDATE SET
        record_count = record_count + excluded.record_count
    `);
    
    stmt.run(uuid.uuid, uuid.source_value, this.now(), uuid.record_count);
  }

  /**
   * Get UUID by value
   */
  getUuid(uuid: string): DbUuid | null {
    const stmt = this.db.prepare('SELECT * FROM uuids WHERE uuid = ?');
    return stmt.get(uuid) as DbUuid | null;
  }

  /**
   * Get UUIDs by status
   */
  getUuidsByStatus(status: UuidStatus): DbUuid[] {
    const stmt = this.db.prepare('SELECT * FROM uuids WHERE status = ?');
    return stmt.all(status) as DbUuid[];
  }

  /**
   * Get all pending UUIDs (not yet completed)
   */
  getPendingUuids(): DbUuid[] {
    const stmt = this.db.prepare("SELECT * FROM uuids WHERE status IN ('pending', 'processing')");
    return stmt.all() as DbUuid[];
  }

  /**
   * Get completed UUIDs
   */
  getCompletedUuids(): DbUuid[] {
    return this.getUuidsByStatus('completed');
  }

  /**
   * Update UUID status
   */
  updateUuidStatus(uuid: string, status: UuidStatus): void {
    const completedAt = status === 'completed' ? this.now() : null;
    
    const stmt = this.db.prepare(`
      UPDATE uuids 
      SET status = ?, completed_at = ?
      WHERE uuid = ?
    `);
    
    stmt.run(status, completedAt, uuid);
  }

  /**
   * Increment processed count for a UUID
   */
  incrementProcessedCount(uuid: string, increment: number = 1): void {
    const stmt = this.db.prepare(`
      UPDATE uuids 
      SET processed_count = processed_count + ?
      WHERE uuid = ?
    `);
    
    stmt.run(increment, uuid);
  }

  /**
   * Recompute UUID counters from source tables for the provided UUIDs.
   * This avoids drift between denormalized counters and actual row/result data.
   */
  syncUuidCounts(uuids: string[]): void {
    if (uuids.length === 0) return;

    const selectCounts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM raw_rows r WHERE r.uuid = ?) as record_count,
        (
          SELECT COUNT(*)
          FROM raw_rows r
          INNER JOIN processed_results pr ON pr.row_id = r.row_id
          WHERE r.uuid = ?
        ) as processed_count
    `);
    const updateUuid = this.db.prepare(`
      UPDATE uuids
      SET record_count = ?,
          processed_count = ?,
          status = ?,
          completed_at = ?
      WHERE uuid = ?
    `);

    const now = this.now();
    this.transaction(() => {
      for (const uuid of uuids) {
        const counts = selectCounts.get(uuid, uuid) as
          | { record_count: number; processed_count: number }
          | undefined;

        const recordCount = counts?.record_count ?? 0;
        const processedCount = counts?.processed_count ?? 0;
        const isComplete = recordCount > 0 && recordCount === processedCount;
        updateUuid.run(recordCount, processedCount, isComplete ? 'completed' : 'pending', isComplete ? now : null, uuid);
      }
    });
  }

  /**
   * Check if UUID is complete (all records processed)
   */
  isUuidComplete(uuid: string): boolean {
    const stmt = this.db.prepare(`
      SELECT record_count, processed_count 
      FROM uuids 
      WHERE uuid = ?
    `);
    
    const result = stmt.get(uuid) as { record_count: number; processed_count: number } | undefined;
    
    if (!result) return false;
    
    return result.record_count > 0 && result.record_count === result.processed_count;
  }

  /**
   * Mark UUID as completed if all records are processed
   */
  markAsCompletedIfReady(uuid: string): boolean {
    if (this.isUuidComplete(uuid)) {
      this.updateUuidStatus(uuid, 'completed');
      return true;
    }
    return false;
  }

  /**
   * Get UUID status summary
   */
  getUuidStatusSummary(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
  } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM uuids
    `);
    
    return stmt.get() as UuidStatusSummary;
  }

  /**
   * Get UUIDs ready for merging (all records processed but not yet merged)
   */
  getUuidsReadyForMerging(): string[] {
    const stmt = this.db.prepare(`
      SELECT u.uuid
      FROM uuids u
      WHERE u.record_count = u.processed_count
        AND u.record_count > 0
        AND u.uuid NOT IN (SELECT uuid FROM merged_output WHERE written_to_file = 1)
    `);
    
    return (stmt.all() as Array<{ uuid: string }>).map(r => r.uuid);
  }

  /**
   * Check if UUID exists
   */
  uuidExists(uuid: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM uuids WHERE uuid = ? LIMIT 1');
    return stmt.get(uuid) !== undefined;
  }

  /**
   * Get total and processed counts for a UUID
   */
  getUuidCounts(uuid: string): { recordCount: number; processedCount: number } | null {
    const stmt = this.db.prepare(`
      SELECT record_count as recordCount, processed_count as processedCount
      FROM uuids
      WHERE uuid = ?
    `);

    const result = stmt.get(uuid) as { recordCount: number; processedCount: number } | undefined;
    return result ?? null;
  }

  /**
   * Delete UUID and related data
   */
  deleteUuid(uuid: string): void {
    this.transaction(() => {
      // Note: Rows and results should be deleted first via their repositories
      this.db.prepare('DELETE FROM merged_output WHERE uuid = ?').run(uuid);
      this.db.prepare('DELETE FROM uuids WHERE uuid = ?').run(uuid);
    });
  }

  /**
   * Reconcile orphaned placeholder UUIDs where record_count is 0 but processed_count > 0.
   * Sets record_count = processed_count so these UUIDs become eligible for merging.
   * Returns list of UUIDs that were reconciled.
   */
  reconcileOrphanedUuids(): string[] {
    const selectStmt = this.db.prepare(`
      SELECT uuid, processed_count FROM uuids WHERE record_count = 0 AND processed_count > 0
    `);

    const rows = selectStmt.all() as Array<{ uuid: string; processed_count: number }>;
    if (rows.length === 0) return [];

    const updateStmt = this.db.prepare(`
      UPDATE uuids SET record_count = ? WHERE uuid = ?
    `);

    this.transaction(() => {
      for (const r of rows) {
        updateStmt.run(r.processed_count, r.uuid);
      }
    });

    return rows.map(r => r.uuid);
  }
}
