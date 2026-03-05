/**
 * Database types for multi-file CSV ingestion with SQLite persistence
 */

export type FileStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type UuidStatus = 'pending' | 'processing' | 'completed';

export interface DbFile {
  file_id: number;
  file_path: string;
  file_hash: string;
  row_count: number;
  started_at: string;
  completed_at: string | null;
  status: FileStatus;
  error_message: string | null;
}

export interface DbRawRow {
  row_id: number;
  file_id: number;
  file_row_index: number;
  global_row_index: number;
  uuid: string;
  raw_data: string; // JSON-encoded CSV row
  row_hash?: string | null;
  created_at: string;
}

export interface DbUuid {
  uuid: string;
  source_value: string;
  first_seen_at: string;
  status: UuidStatus;
  record_count: number;
  processed_count: number;
  completed_at: string | null;
}

export interface DbProcessedResult {
  result_id: number;
  row_id: number;
  uuid: string;
  llm_result: string; // JSON-encoded LLM output
  processed_at: string;
}

export interface DbMergedOutput {
  uuid: string;
  merged_result: string; // Final merged JSON-LD
  written_to_file: number; // Boolean: 0 or 1
  written_at: string | null;
}

export interface PipelineState {
  processing: boolean;
  current_file_id: number | null;
  total_rows: number;
  processed_rows: number;
  completed_uuids: number;
  started_at: string;
  updated_at: string;
}

export interface PipelineConfig {
  config_hash: string;
  schema_path: string;
  output_path: string;
  batch_size: number;
  uuid_column: string | null;
  created_at: string;
}

// Generic count result from SQL COUNT(*) queries
export interface CountRow {
  count: number;
}

// Summary types for repository status queries
export interface FileStatusSummary {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface UuidStatusSummary {
  total: number;
  pending: number;
  processing: number;
  completed: number;
}

export interface MergedOutputCounts {
  total: number;
  written: number;
  unwritten: number;
}

export interface MergedOutputWithStatus {
  uuid: string;
  merged_result: string;
  written_to_file: number;
  written_at: string | null;
  record_count: number;
  processed_count: number;
  status: UuidStatus;
}

// Input types for insert operations
export interface InsertFile {
  file_path: string;
  file_hash: string;
  row_count: number;
  status: FileStatus;
}

export interface InsertRawRow {
  file_id: number;
  file_row_index: number;
  global_row_index: number;
  uuid: string;
  raw_data: string;
  row_hash?: string | null;
}

export interface InsertUuid {
  uuid: string;
  source_value: string;
  record_count: number;
}

export interface InsertProcessedResult {
  row_id: number;
  uuid: string;
  llm_result: string;
}

export interface InsertMergedOutput {
  uuid: string;
  merged_result: string;
}

// Progress tracking
export interface ProcessingProgress {
  total_files: number;
  completed_files: number;
  failed_files: number;
  total_rows: number;
  processed_rows: number;
  total_uuids: number;
  completed_uuids: number;
  pending_uuids: number;
}
