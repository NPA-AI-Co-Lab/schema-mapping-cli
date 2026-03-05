/**
 * Base repository class with common database operations
 */

import type Database from 'better-sqlite3';

export abstract class BaseRepository {
  constructor(protected db: Database.Database) {}

  /**
   * Execute query within a transaction
   */
  protected transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Get current timestamp in ISO format
   */
  protected now(): string {
    return new Date().toISOString();
  }
}
