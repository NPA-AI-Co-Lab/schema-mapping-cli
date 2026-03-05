/**
 * Repository for raw row operations
 */

import { BaseRepository } from './base.repository.js';
import type { DbRawRow, InsertRawRow, CountRow } from '../types.js';
import type Database from 'better-sqlite3';

export class RowsRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  /**
   * Insert a single raw row
   */
  insertRow(row: InsertRawRow): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw_rows (file_id, file_row_index, global_row_index, uuid, raw_data, row_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      row.file_id,
      row.file_row_index,
      row.global_row_index,
      row.uuid,
      row.raw_data,
      row.row_hash,
      this.now()
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Batch insert raw rows. Returns an object with counts: inserted and ignored (duplicates).
   */
  insertRowsBatch(rows: InsertRawRow[]): { inserted: number; ignored: number; insertedMask: boolean[] } {
    if (rows.length === 0) return { inserted: 0, ignored: 0, insertedMask: [] };

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw_rows (file_id, file_row_index, global_row_index, uuid, raw_data, row_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction(() => {
      const now = this.now();
      let inserted = 0;
      let ignored = 0;
      const insertedMask: boolean[] = [];
      for (const row of rows) {
        const res = stmt.run(
          row.file_id,
          row.file_row_index,
          row.global_row_index,
          row.uuid,
          row.raw_data,
          row.row_hash,
          now
        );
        if (res.changes && res.changes > 0) {
          inserted += res.changes;
          insertedMask.push(true);
        } else {
          ignored++;
          insertedMask.push(false);
        }
      }
      return { inserted, ignored, insertedMask };
    });

    return insertMany() as { inserted: number; ignored: number; insertedMask: boolean[] };
  }

  /**
   * Get row by ID
   */
  getRowById(rowId: number): DbRawRow | null {
    const stmt = this.db.prepare('SELECT * FROM raw_rows WHERE row_id = ?');
    return stmt.get(rowId) as DbRawRow | null;
  }

  /**
   * Get all rows for a file
   */
  getRowsByFileId(fileId: number): DbRawRow[] {
    const stmt = this.db.prepare(
      'SELECT * FROM raw_rows WHERE file_id = ? ORDER BY file_row_index'
    );
    return stmt.all(fileId) as DbRawRow[];
  }

  /**
   * Get all rows for a UUID
   */
  getRowsByUuid(uuid: string): DbRawRow[] {
    const stmt = this.db.prepare('SELECT * FROM raw_rows WHERE uuid = ? ORDER BY global_row_index');
    return stmt.all(uuid) as DbRawRow[];
  }

  /**
   * Get unprocessed rows (rows without processed results)
   */
  getUnprocessedRows(limit?: number): DbRawRow[] {
    const sql = `
      SELECT r.* 
      FROM raw_rows r
      WHERE NOT EXISTS (SELECT 1 FROM processed_results pr WHERE pr.row_id = r.row_id)
      ORDER BY r.global_row_index
      ${limit ? 'LIMIT ?' : ''}
    `;

    const stmt = this.db.prepare(sql);
    return (limit ? stmt.all(limit) : stmt.all()) as DbRawRow[];
  }

  /**
   * Get count of unprocessed rows
   */
  getUnprocessedRowCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM raw_rows r
      WHERE NOT EXISTS (SELECT 1 FROM processed_results pr WHERE pr.row_id = r.row_id)
    `);

    return (stmt.get() as CountRow).count;
  }

  /**
   * Get processed rows for a UUID
   */
  getProcessedRowsByUuid(uuid: string): DbRawRow[] {
    const stmt = this.db.prepare(`
      SELECT r.* 
      FROM raw_rows r
      INNER JOIN processed_results pr ON r.row_id = pr.row_id
      WHERE r.uuid = ?
      ORDER BY r.global_row_index
    `);

    return stmt.all(uuid) as DbRawRow[];
  }

  /**
   * Check if all rows for a UUID have been processed
   */
  isUuidFullyProcessed(uuid: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(r.row_id) as total,
        COUNT(pr.result_id) as processed
      FROM raw_rows r
      LEFT JOIN processed_results pr ON r.row_id = pr.row_id
      WHERE r.uuid = ?
    `);

    const result = stmt.get(uuid) as { total: number; processed: number };
    return result.total > 0 && result.total === result.processed;
  }

  /**
   * Get next global row index (for inserting new rows)
   */
  getNextGlobalRowIndex(): number {
    const stmt = this.db.prepare('SELECT MAX(global_row_index) as max_index FROM raw_rows');
    const result = stmt.get() as { max_index: number | null };
    return (result.max_index || -1) + 1;
  }

  /**
   * Get row count by file
   */
  getRowCountByFile(fileId: number): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM raw_rows WHERE file_id = ?');
    return (stmt.get(fileId) as CountRow).count;
  }

  /**
   * Get total row count
   */
  getTotalRowCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM raw_rows');
    return (stmt.get() as CountRow).count;
  }

  /**
   * Delete rows by file ID
   */
  deleteRowsByFileId(fileId: number): void {
    this.db.prepare('DELETE FROM raw_rows WHERE file_id = ?').run(fileId);
  }

  /**
   * Get rows in a specific range (for batch processing)
   */
  getRowsInRange(startGlobalIndex: number, endGlobalIndex: number): DbRawRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM raw_rows 
      WHERE global_row_index >= ? AND global_row_index <= ?
      ORDER BY global_row_index
    `);

    return stmt.all(startGlobalIndex, endGlobalIndex) as DbRawRow[];
  }
}
