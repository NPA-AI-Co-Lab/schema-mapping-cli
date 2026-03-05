/**
 * Repository for file tracking operations
 */

import { BaseRepository } from './base.repository.js';
import type { DbFile, InsertFile, FileStatus, FileStatusSummary } from '../types.js';
import type Database from 'better-sqlite3';

export class FilesRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  /**
   * Insert a new file record
   */
  insertFile(file: InsertFile): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (file_path, file_hash, row_count, status, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      file.file_path,
      file.file_hash,
      file.row_count,
      file.status,
      this.now()
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get file by ID
   */
  getFileById(fileId: number): DbFile | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE file_id = ?');
    return stmt.get(fileId) as DbFile | null;
  }

  /**
   * Get file by path
   */
  getFileByPath(filePath: string): DbFile | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE file_path = ?');
    return stmt.get(filePath) as DbFile | null;
  }

  /**
   * Get file by hash (to detect if same content already processed)
   */
  getFileByHash(fileHash: string): DbFile | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE file_hash = ?');
    return stmt.get(fileHash) as DbFile | null;
  }

  /**
   * Get all files
   */
  getAllFiles(): DbFile[] {
    const stmt = this.db.prepare('SELECT * FROM files ORDER BY file_id');
    return stmt.all() as DbFile[];
  }

  /**
   * Get files by status
   */
  getFilesByStatus(status: FileStatus): DbFile[] {
    const stmt = this.db.prepare('SELECT * FROM files WHERE status = ? ORDER BY file_id');
    return stmt.all(status) as DbFile[];
  }

  /**
   * Update file status
   */
  updateFileStatus(fileId: number, status: FileStatus, errorMessage?: string): void {
    const completedAt = status === 'completed' ? this.now() : null;

    const stmt = this.db.prepare(`
      UPDATE files 
      SET status = ?, completed_at = ?, error_message = ?
      WHERE file_id = ?
    `);

    stmt.run(status, completedAt, errorMessage || null, fileId);
  }

  /**
   * Mark file as processing
   */
  markFileAsProcessing(fileId: number): void {
    this.updateFileStatus(fileId, 'processing');
  }

  /**
   * Mark file as completed
   */
  markFileAsCompleted(fileId: number): void {
    this.updateFileStatus(fileId, 'completed');
  }

  /**
   * Mark file as failed with error
   */
  markFileAsFailed(fileId: number, errorMessage: string): void {
    this.updateFileStatus(fileId, 'failed', errorMessage);
  }

  /**
   * Check if file already exists (by path or hash)
   */
  fileExists(filePath: string, fileHash: string): { exists: boolean; file?: DbFile } {
    // Check by path first
    let file = this.getFileByPath(filePath);
    if (file) {
      return { exists: true, file };
    }

    // Check by hash (same content, different path)
    file = this.getFileByHash(fileHash);
    if (file) {
      return { exists: true, file };
    }

    return { exists: false };
  }

  /**
   * Get file processing status summary
   */
  getFileStatusSummary(): FileStatusSummary {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM files
    `);

    return stmt.get() as FileStatusSummary;
  }

  /**
   * Delete file and all related data (cascades manually)
   */
  deleteFile(fileId: number): void {
    this.transaction(() => {
      const affectedUuids = this.getAffectedUuids(fileId);

      this.db
        .prepare(
          'DELETE FROM processed_results WHERE row_id IN (SELECT row_id FROM raw_rows WHERE file_id = ?)'
        )
        .run(fileId);
      this.db.prepare('DELETE FROM raw_rows WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM files WHERE file_id = ?').run(fileId);

      if (affectedUuids.length === 0) {
        return;
      }

      this.deleteMergedOutputForUuids(affectedUuids);
      this.recomputeUuidAggregates(affectedUuids);
      this.pruneEmptyAffectedUuids(affectedUuids);
    });
  }

  private getAffectedUuids(fileId: number): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT uuid FROM raw_rows WHERE file_id = ?')
      .all(fileId) as Array<{ uuid: string }>;
    return rows.map((row) => row.uuid);
  }

  private deleteMergedOutputForUuids(uuids: string[]): void {
    const placeholders = uuids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM merged_output WHERE uuid IN (${placeholders})`).run(...uuids);
  }

  private recomputeUuidAggregates(uuids: string[]): void {
    const updateUuids = this.db.prepare(`
      UPDATE uuids
      SET record_count = ?,
          processed_count = ?,
          status = ?,
          completed_at = ?
      WHERE uuid = ?
    `);
    const countByUuid = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM raw_rows r WHERE r.uuid = ?) as record_count,
        (
          SELECT COUNT(*)
          FROM raw_rows r
          INNER JOIN processed_results pr ON pr.row_id = r.row_id
          WHERE r.uuid = ?
        ) as processed_count
    `);

    const now = this.now();
    for (const uuid of uuids) {
      const counts = countByUuid.get(uuid, uuid) as
        | { record_count: number; processed_count: number }
        | undefined;
      const recordCount = counts?.record_count ?? 0;
      const processedCount = counts?.processed_count ?? 0;
      const isComplete = recordCount > 0 && processedCount === recordCount;
      updateUuids.run(
        recordCount,
        processedCount,
        isComplete ? 'completed' : 'pending',
        isComplete ? now : null,
        uuid
      );
    }
  }

  private pruneEmptyAffectedUuids(uuids: string[]): void {
    if (uuids.length === 0) return;
    const placeholders = uuids.map(() => '?').join(',');

    this.db.prepare(`
      DELETE FROM merged_output
      WHERE uuid IN (
        SELECT uuid
        FROM uuids
        WHERE uuid IN (${placeholders})
          AND record_count = 0
          AND processed_count = 0
      )
    `).run(...uuids);

    this.db.prepare(`
      DELETE FROM uuids
      WHERE uuid IN (${placeholders})
        AND record_count = 0
        AND processed_count = 0
    `).run(...uuids);
  }
}
