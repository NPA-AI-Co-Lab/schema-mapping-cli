/**
 * Repository for pipeline state and configuration operations
 */

import { BaseRepository } from './base.repository.js';
import type { ProcessingProgress } from '../types.js';
import type Database from 'better-sqlite3';

export class StateRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  // ========== Pipeline Configuration ==========

  /**
   * Set a configuration value
   */
  setConfig(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_config (config_key, config_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = excluded.updated_at
    `);

    stmt.run(key, value, this.now());
  }

  /**
   * Get a configuration value
   */
  getConfig(key: string): string | null {
    const stmt = this.db.prepare('SELECT config_value FROM pipeline_config WHERE config_key = ?');
    const result = stmt.get(key) as { config_value: string } | undefined;
    return result ? result.config_value : null;
  }

  /**
   * Get all configuration
   */
  getAllConfig(): Map<string, string> {
    const stmt = this.db.prepare('SELECT config_key, config_value FROM pipeline_config');
    const rows = stmt.all() as Array<{ config_key: string; config_value: string }>;

    const config = new Map<string, string>();
    for (const row of rows) {
      config.set(row.config_key, row.config_value);
    }
    return config;
  }

  /**
   * Set multiple configuration values
   */
  setConfigBatch(configs: Record<string, string>): void {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_config (config_key, config_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = excluded.updated_at
    `);

    const insertMany = this.db.transaction(() => {
      const now = this.now();
      for (const [key, value] of Object.entries(configs)) {
        stmt.run(key, value, now);
      }
    });

    insertMany();
  }

  /**
   * Delete a configuration value
   */
  deleteConfig(key: string): void {
    this.db.prepare('DELETE FROM pipeline_config WHERE config_key = ?').run(key);
  }

  /**
   * Clear all configuration
   */
  clearConfig(): void {
    this.db.prepare('DELETE FROM pipeline_config').run();
  }

  // ========== Pipeline State ==========

  /**
   * Set a state value
   */
  setState(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_state (state_key, state_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = excluded.updated_at
    `);

    stmt.run(key, value, this.now());
  }

  /**
   * Get a state value
   */
  getState(key: string): string | null {
    const stmt = this.db.prepare('SELECT state_value FROM pipeline_state WHERE state_key = ?');
    const result = stmt.get(key) as { state_value: string } | undefined;
    return result ? result.state_value : null;
  }

  /**
   * Get all state
   */
  getAllState(): Map<string, string> {
    const stmt = this.db.prepare('SELECT state_key, state_value FROM pipeline_state');
    const rows = stmt.all() as Array<{ state_key: string; state_value: string }>;

    const state = new Map<string, string>();
    for (const row of rows) {
      state.set(row.state_key, row.state_value);
    }
    return state;
  }

  /**
   * Set multiple state values
   */
  setStateBatch(states: Record<string, string>): void {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_state (state_key, state_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = excluded.updated_at
    `);

    const insertMany = this.db.transaction(() => {
      const now = this.now();
      for (const [key, value] of Object.entries(states)) {
        stmt.run(key, value, now);
      }
    });

    insertMany();
  }

  /**
   * Delete a state value
   */
  deleteState(key: string): void {
    this.db.prepare('DELETE FROM pipeline_state WHERE state_key = ?').run(key);
  }

  /**
   * Clear all state
   */
  clearState(): void {
    this.db.prepare('DELETE FROM pipeline_state').run();
  }

  // ========== Processing Progress ==========

  /**
   * Get comprehensive processing progress
   */
  getProcessingProgress(): ProcessingProgress {
    const stmt = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM files) as total_files,
        (SELECT COUNT(*) FROM files WHERE status = 'completed') as completed_files,
        (SELECT COUNT(*) FROM files WHERE status = 'failed') as failed_files,
        (SELECT COUNT(*) FROM raw_rows) as total_rows,
        (SELECT COUNT(*) FROM processed_results) as processed_rows,
        (SELECT COUNT(*) FROM uuids) as total_uuids,
        (SELECT COUNT(*) FROM uuids WHERE status = 'completed') as completed_uuids,
        (SELECT COUNT(*) FROM uuids WHERE status IN ('pending', 'processing')) as pending_uuids
    `);

    return stmt.get() as ProcessingProgress;
  }

  /**
   * Mark processing as started
   */
  markProcessingStarted(): void {
    const now = this.now();
    this.setStateBatch({
      processing: 'true',
      started_at: now,
      updated_at: now,
    });
  }

  /**
   * Mark processing as completed
   */
  markProcessingCompleted(): void {
    const now = this.now();
    this.setStateBatch({
      processing: 'false',
      completed_at: now,
      updated_at: now,
    });
  }

  /**
   * Check if processing is in progress
   */
  isProcessing(): boolean {
    const processing = this.getState('processing');
    return processing === 'true';
  }

  /**
   * Update last activity timestamp
   */
  updateLastActivity(): void {
    this.setState('last_activity', this.now());
  }

  /**
   * Get last activity timestamp
   */
  getLastActivity(): string | null {
    return this.getState('last_activity');
  }

  /**
   * Save configuration hash for validation
   */
  saveConfigHash(hash: string): void {
    this.setConfig('config_hash', hash);
  }

  /**
   * Get saved configuration hash
   */
  getConfigHash(): string | null {
    return this.getConfig('config_hash');
  }

  /**
   * Validate configuration hasn't changed
   */
  validateConfigHash(currentHash: string): boolean {
    const savedHash = this.getConfigHash();
    return savedHash === null || savedHash === currentHash;
  }
}
