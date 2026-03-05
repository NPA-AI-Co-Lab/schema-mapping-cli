/**
 * Database schema for multi-file CSV ingestion
 */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
-- Files being processed
CREATE TABLE IF NOT EXISTS files (
    file_id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_hash TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT
);

-- Raw CSV rows before LLM processing
CREATE TABLE IF NOT EXISTS raw_rows (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    file_row_index INTEGER NOT NULL,
    global_row_index INTEGER NOT NULL UNIQUE,
    uuid TEXT NOT NULL,
    raw_data TEXT NOT NULL,
    row_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(file_id) REFERENCES files(file_id) ON DELETE CASCADE,
    UNIQUE(file_id, file_row_index)
);

-- UUID registry and tracking
CREATE TABLE IF NOT EXISTS uuids (
    uuid TEXT PRIMARY KEY,
    source_value TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed')),
    record_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT
);

-- Processed LLM results
CREATE TABLE IF NOT EXISTS processed_results (
    result_id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL UNIQUE,
    uuid TEXT NOT NULL,
    llm_result TEXT NOT NULL,
    processed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(row_id) REFERENCES raw_rows(row_id) ON DELETE CASCADE,
    FOREIGN KEY(uuid) REFERENCES uuids(uuid) ON DELETE CASCADE
);

-- Final merged output per UUID
CREATE TABLE IF NOT EXISTS merged_output (
    uuid TEXT PRIMARY KEY,
    merged_result TEXT NOT NULL,
    written_to_file INTEGER NOT NULL DEFAULT 0,
    written_at TEXT,
    FOREIGN KEY(uuid) REFERENCES uuids(uuid) ON DELETE CASCADE
);

-- Pipeline configuration and metadata
CREATE TABLE IF NOT EXISTS pipeline_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Processing metadata
CREATE TABLE IF NOT EXISTS pipeline_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const CREATE_INDEXES_SQL = `
-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_raw_rows_uuid ON raw_rows(uuid);
CREATE INDEX IF NOT EXISTS idx_raw_rows_file ON raw_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_raw_rows_global ON raw_rows(global_row_index);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_raw_rows_file_rowhash ON raw_rows(file_id, row_hash);
CREATE INDEX IF NOT EXISTS idx_uuids_status ON uuids(status);
CREATE INDEX IF NOT EXISTS idx_processed_results_uuid ON processed_results(uuid);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
`;

import type Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(CREATE_TABLES_SQL);

  // Create indexes
  db.exec(CREATE_INDEXES_SQL);

  // Record schema version
  const existingVersion = db
    .prepare('SELECT version FROM schema_version WHERE version = ?')
    .get(SCHEMA_VERSION) as { version: number } | undefined;
  if (!existingVersion) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
  }
}

export function validateSchema(db: Database.Database): boolean {
  try {
    // Check if all required tables exist
    const tables = [
      'files',
      'raw_rows',
      'uuids',
      'processed_results',
      'merged_output',
      'pipeline_config',
      'pipeline_state',
    ];
    const existingTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = existingTables.map((t) => t.name);

    for (const table of tables) {
      if (!tableNames.includes(table)) {
        console.warn(`Database validation failed: Missing table '${table}'`);
        return false;
      }
    }

    // Check schema version
    const versionRow = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | undefined;
    if (!versionRow || versionRow.version !== SCHEMA_VERSION) {
      console.warn(
        `Database validation failed: Schema version mismatch (expected ${SCHEMA_VERSION}, got ${versionRow?.version})`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Database validation error:', error);
    return false;
  }
}
