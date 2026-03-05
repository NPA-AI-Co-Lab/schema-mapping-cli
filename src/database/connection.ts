/**
 * SQLite database connection manager
 */

import Database from 'better-sqlite3';
import { initializeSchema, validateSchema } from './schema.js';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

export class DatabaseConnection {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private isInitialized: boolean = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Open database connection and initialize schema
   */
  connect(): void {
    if (this.db) {
      return; // Already connected
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Open database
      this.db = new Database(this.dbPath);
      this.db.pragma('foreign_keys = ON');

      // Initialize schema if needed
      if (!this.isInitialized) {
        initializeSchema(this.db);

        // Validate schema
        if (!validateSchema(this.db)) {
          throw new Error('Database schema validation failed');
        }

        this.isInitialized = true;
      }
    } catch (error) {
      const dbError = error as Error;
      throw new Error(`Failed to connect to database at '${this.dbPath}': ${dbError.message}`);
    }
  }

  /**
   * Get the active database instance
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      try {
        // Run checkpoint to flush WAL
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        this.db.close();
        this.db = null;
        this.isInitialized = false;
      } catch (error) {
        console.warn('Error closing database:', error);
      }
    }
  }

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    const transaction = db.transaction(fn);
    return transaction();
  }

  /**
   * Check if database exists and is valid
   */
  static exists(dbPath: string): boolean {
    if (!existsSync(dbPath)) {
      return false;
    }

    try {
      const db = new Database(dbPath, { readonly: true });
      const isValid = validateSchema(db);
      db.close();
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.db !== null;
  }

  /**
   * Clear all data (for testing/reset)
   */
  clearAllData(): void {
    const db = this.getDb();

    db.prepare('DELETE FROM merged_output').run();
    db.prepare('DELETE FROM processed_results').run();
    db.prepare('DELETE FROM raw_rows').run();
    db.prepare('DELETE FROM uuids').run();
    db.prepare('DELETE FROM files').run();
    db.prepare('DELETE FROM pipeline_state').run();
    db.prepare('DELETE FROM pipeline_config').run();
  }

  /**
   * Get database statistics
   */
  getStats(): {
    files: number;
    rawRows: number;
    uuids: number;
    processedResults: number;
    mergedOutputs: number;
  } {
    const db = this.getDb();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const rawRowsRow = db.prepare('SELECT COUNT(*) as count FROM raw_rows').get() as {
      count: number;
    };
    const uuidsRow = db.prepare('SELECT COUNT(*) as count FROM uuids').get() as { count: number };
    const processedRow = db.prepare('SELECT COUNT(*) as count FROM processed_results').get() as {
      count: number;
    };
    const mergedRow = db.prepare('SELECT COUNT(*) as count FROM merged_output').get() as {
      count: number;
    };

    return {
      files: countRow.count,
      rawRows: rawRowsRow.count,
      uuids: uuidsRow.count,
      processedResults: processedRow.count,
      mergedOutputs: mergedRow.count,
    };
  }
}

/**
 * Derive database path from output path
 */
export function deriveDatabasePath(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const basename = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `${basename}.db`);
}
