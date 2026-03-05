/**
 * Database module exports
 */

export { DatabaseConnection, deriveDatabasePath } from './connection.js';
export { initializeSchema, validateSchema, SCHEMA_VERSION } from './schema.js';
export * from './types.js';

// Repositories
export { BaseRepository } from './repositories/base.repository.js';
export { FilesRepository } from './repositories/files.repository.js';
export { RowsRepository } from './repositories/rows.repository.js';
export { UuidsRepository } from './repositories/uuids.repository.js';
export { ResultsRepository } from './repositories/results.repository.js';
export { StateRepository } from './repositories/state.repository.js';

/**
 * Main database manager class that provides unified access to all repositories
 */
import { DatabaseConnection } from './connection.js';
import { FilesRepository } from './repositories/files.repository.js';
import { RowsRepository } from './repositories/rows.repository.js';
import { UuidsRepository } from './repositories/uuids.repository.js';
import { ResultsRepository } from './repositories/results.repository.js';
import { StateRepository } from './repositories/state.repository.js';

export class DatabaseManager {
  private connection: DatabaseConnection;
  public files!: FilesRepository;
  public rows!: RowsRepository;
  public uuids!: UuidsRepository;
  public results!: ResultsRepository;
  public state!: StateRepository;

  constructor(dbPath: string) {
    this.connection = new DatabaseConnection(dbPath);
    // Repositories will be initialized in `connect()`
  }

  /**
   * Connect to database and initialize repositories
   */
  connect(): void {
    this.connection.connect();
    const db = this.connection.getDb();

    // Initialize all repositories
    this.files = new FilesRepository(db);
    this.rows = new RowsRepository(db);
    this.uuids = new UuidsRepository(db);
    this.results = new ResultsRepository(db);
    this.state = new StateRepository(db);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.connection.close();
  }

  /**
   * Get the underlying connection
   */
  getConnection(): DatabaseConnection {
    return this.connection;
  }

  /**
   * Get database statistics
   */
  getStats() {
    return this.connection.getStats();
  }

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.connection.transaction(fn);
  }

  /**
   * Check if database exists and is valid
   */
  static exists(dbPath: string): boolean {
    return DatabaseConnection.exists(dbPath);
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.connection.getPath();
  }

  /**
   * Clear all data (for testing/reset)
   */
  clearAllData(): void {
    this.connection.clearAllData();
  }

  /**
   * Get comprehensive progress information
   */
  getProgress() {
    return this.state.getProcessingProgress();
  }
}
