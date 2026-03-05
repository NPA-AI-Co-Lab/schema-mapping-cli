/**
 * Repository for processed results and merged output operations
 */

import { BaseRepository } from './base.repository.js';
import type {
  DbProcessedResult,
  DbMergedOutput,
  InsertProcessedResult,
  InsertMergedOutput,
  CountRow,
  MergedOutputCounts,
  MergedOutputWithStatus,
} from '../types.js';
import type Database from 'better-sqlite3';

export class ResultsRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  // ========== Processed Results ==========

  /**
   * Insert a processed result
   */
  insertProcessedResult(result: InsertProcessedResult): number {
    const stmt = this.db.prepare(`
      INSERT INTO processed_results (row_id, uuid, llm_result, processed_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertResult = stmt.run(result.row_id, result.uuid, result.llm_result, this.now());

    return insertResult.lastInsertRowid as number;
  }

  /**
   * Batch insert processed results
   */
  insertProcessedResultsBatch(results: InsertProcessedResult[]): void {
    if (results.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO processed_results (row_id, uuid, llm_result, processed_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction(() => {
      const now = this.now();
      for (const result of results) {
        stmt.run(result.row_id, result.uuid, result.llm_result, now);
      }
    });

    insertMany();
  }

  /**
   * Get processed result by ID
   */
  getProcessedResultById(resultId: number): DbProcessedResult | null {
    const stmt = this.db.prepare('SELECT * FROM processed_results WHERE result_id = ?');
    return stmt.get(resultId) as DbProcessedResult | null;
  }

  /**
   * Get processed result by row ID
   */
  getProcessedResultByRowId(rowId: number): DbProcessedResult | null {
    const stmt = this.db.prepare('SELECT * FROM processed_results WHERE row_id = ?');
    return stmt.get(rowId) as DbProcessedResult | null;
  }

  /**
   * Get all processed results for a UUID
   */
  getProcessedResultsByUuid(uuid: string): DbProcessedResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_results 
      WHERE uuid = ? 
      ORDER BY result_id
    `);

    return stmt.all(uuid) as DbProcessedResult[];
  }

  /**
   * Get processed count for a UUID
   */
  getProcessedCountByUuid(uuid: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM processed_results 
      WHERE uuid = ?
    `);

    return (stmt.get(uuid) as CountRow).count;
  }

  /**
   * Check if a row has been processed
   */
  isRowProcessed(rowId: number): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM processed_results WHERE row_id = ? LIMIT 1');
    return stmt.get(rowId) !== undefined;
  }

  /**
   * Get total processed count
   */
  getTotalProcessedCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM processed_results');
    return (stmt.get() as CountRow).count;
  }

  /**
   * Delete processed result by row ID
   */
  deleteProcessedResultByRowId(rowId: number): void {
    this.db.prepare('DELETE FROM processed_results WHERE row_id = ?').run(rowId);
  }

  // ========== Merged Output ==========

  /**
   * Insert or update merged output
   */
  upsertMergedOutput(output: InsertMergedOutput): void {
    const stmt = this.db.prepare(`
      INSERT INTO merged_output (uuid, merged_result, written_to_file)
      VALUES (?, ?, 0)
      ON CONFLICT(uuid) DO UPDATE SET
        merged_result = excluded.merged_result
    `);

    stmt.run(output.uuid, output.merged_result);
  }

  /**
   * Get merged output by UUID
   */
  getMergedOutput(uuid: string): DbMergedOutput | null {
    const stmt = this.db.prepare('SELECT * FROM merged_output WHERE uuid = ?');
    return stmt.get(uuid) as DbMergedOutput | null;
  }

  /**
   * Get all merged outputs
   */
  getAllMergedOutputs(): DbMergedOutput[] {
    const stmt = this.db.prepare('SELECT * FROM merged_output ORDER BY uuid');
    return stmt.all() as DbMergedOutput[];
  }

  /**
   * Get unwritten merged outputs (ready to write to file)
   */
  getUnwrittenMergedOutputs(): DbMergedOutput[] {
    const stmt = this.db.prepare('SELECT * FROM merged_output WHERE written_to_file = 0');
    return stmt.all() as DbMergedOutput[];
  }

  /**
   * Mark merged output as written to file
   */
  markAsWritten(uuid: string): void {
    const stmt = this.db.prepare(`
      UPDATE merged_output 
      SET written_to_file = 1, written_at = ?
      WHERE uuid = ?
    `);

    stmt.run(this.now(), uuid);
  }

  /**
   * Batch mark outputs as written
   */
  markMultipleAsWritten(uuids: string[]): void {
    if (uuids.length === 0) return;

    const stmt = this.db.prepare(`
      UPDATE merged_output 
      SET written_to_file = 1, written_at = ?
      WHERE uuid = ?
    `);

    const updateMany = this.db.transaction(() => {
      const now = this.now();
      for (const uuid of uuids) {
        stmt.run(now, uuid);
      }
    });

    updateMany();
  }

  /**
   * Reset all merged outputs to unwritten state
   * Used when forceReingestion requires regenerating the entire output file
   */
  resetAllToUnwritten(): void {
    this.db.prepare(`
      UPDATE merged_output 
      SET written_to_file = 0, written_at = NULL
    `).run();
  }

  /**
   * Reset specific merged outputs to unwritten state
   */
  resetToUnwritten(uuids: string[]): void {
    if (uuids.length === 0) return;
    const placeholders = uuids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE merged_output 
      SET written_to_file = 0, written_at = NULL
      WHERE uuid IN (${placeholders})
    `).run(...uuids);
  }

  /**
   * Check if merged output exists for UUID
   */
  hasMergedOutput(uuid: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM merged_output WHERE uuid = ? LIMIT 1');
    return stmt.get(uuid) !== undefined;
  }

  /**
   * Check if merged output has been written to file
   */
  isWritten(uuid: string): boolean {
    const stmt = this.db.prepare('SELECT written_to_file FROM merged_output WHERE uuid = ?');
    const result = stmt.get(uuid) as { written_to_file: number } | undefined;
    return result ? result.written_to_file === 1 : false;
  }

  /**
   * Get count of merged outputs
   */
  getMergedOutputCount(): { total: number; written: number; unwritten: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN written_to_file = 1 THEN 1 ELSE 0 END) as written,
        SUM(CASE WHEN written_to_file = 0 THEN 1 ELSE 0 END) as unwritten
      FROM merged_output
    `);

    return stmt.get() as MergedOutputCounts;
  }

  /**
   * Delete merged output
   */
  deleteMergedOutput(uuid: string): void {
    this.db.prepare('DELETE FROM merged_output WHERE uuid = ?').run(uuid);
  }

  /**
   * Get merged outputs with their processing status
   */
  getMergedOutputsWithStatus(): Array<{
    uuid: string;
    merged_result: string;
    written_to_file: number;
    written_at: string | null;
    record_count: number;
    processed_count: number;
    status: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT 
        mo.uuid,
        mo.merged_result,
        mo.written_to_file,
        mo.written_at,
        u.record_count,
        u.processed_count,
        u.status
      FROM merged_output mo
      INNER JOIN uuids u ON mo.uuid = u.uuid
      ORDER BY mo.uuid
    `);

    return stmt.all() as MergedOutputWithStatus[];
  }
}
