import { writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { assignUuidsToBatch } from '../emailUuid.js';

export interface CheckpointDataInput {
  lastProcessedBatchIndex: number;
  totalBatches: number;
  processedRows: number;
  startTime: string;
  dataPath: string;
  outputPath: string;
  configHash: string;
  uuidCache: Record<string, string>; // value -> uuid mapping
  pendingUuids: Set<string>; // UUIDs that still have unprocessed records
  completedUuids: Set<string>; // UUIDs that are fully processed and written
}

export interface CheckpointData {
  lastProcessedBatchIndex: number;
  totalBatches: number;
  processedRows: number;
  startTime: string;
  dataPath: string;
  outputPath: string;
  configHash: string;
  // UUID tracking for proper merging
  uuidCache: Record<string, string>; // value -> uuid mapping
  pendingUuids: string[]; // UUIDs that still have unprocessed records (serialized as array)
  completedUuids: string[]; // UUIDs that are fully processed and written (serialized as array)
}

export interface UuidIndex {
  uuidToRowIndices: Map<string, number[]>; // uuid -> array of row indices that will have this UUID
  totalRows: number;
}

export class CheckpointManager {
  private readonly checkpointPath: string;

  constructor(outputPath: string) {
    // Create checkpoint file next to output file
    const outputDir = path.dirname(outputPath);
    const outputName = path.basename(outputPath, path.extname(outputPath));
    this.checkpointPath = path.join(outputDir, `${outputName}.checkpoint.json`);
  }

  /**
   * Save checkpoint data
   */
  async saveCheckpoint(inputData: CheckpointDataInput): Promise<void> {
    try {
      // Convert Sets to arrays for JSON serialization
      const data: CheckpointData = {
        ...inputData,
        pendingUuids: Array.from(inputData.pendingUuids),
        completedUuids: Array.from(inputData.completedUuids),
      };
      await writeFile(this.checkpointPath, JSON.stringify(data, null, 2));
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        console.warn(
          `Checkpoint save failed: Directory does not exist for path '${this.checkpointPath}'. Please ensure the output directory exists.`
        );
      } else if (fsError.code === 'EACCES') {
        console.warn(
          `Checkpoint save failed: Permission denied for path '${this.checkpointPath}'. Check file permissions.`
        );
      } else if (fsError.code === 'ENOSPC') {
        console.warn(
          `Checkpoint save failed: No space left on device for path '${this.checkpointPath}'. Free up disk space.`
        );
      } else if (fsError.message) {
        console.warn(
          `Checkpoint save failed: ${fsError.message} ${fsError.code ? `(Code: ${fsError.code})` : ''} at path '${this.checkpointPath}'`
        );
      } else {
        console.warn(
          `Checkpoint save failed with unexpected error: ${String(error)} at path '${this.checkpointPath}'`
        );
      }
    }
  }

  /**
   * Load checkpoint data if it exists
   */
  async loadCheckpoint(): Promise<CheckpointData | null> {
    try {
      await access(this.checkpointPath, constants.F_OK);
      const data = await readFile(this.checkpointPath, 'utf-8');
      return JSON.parse(data) as CheckpointData;
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        // No checkpoint file exists - this is normal
        return null;
      } else if (fsError.code === 'EACCES') {
        console.warn(
          `Cannot read checkpoint file '${this.checkpointPath}': Permission denied. Check file permissions.`
        );
        return null;
      } else if (fsError.name === 'SyntaxError') {
        console.warn(
          `Checkpoint file '${this.checkpointPath}' contains invalid JSON. The file may be corrupted. Starting fresh.`
        );
        return null;
      } else if (fsError.message?.includes('JSON')) {
        console.warn(
          `Failed to parse checkpoint file '${this.checkpointPath}': ${fsError.message}. Starting fresh.`
        );
        return null;
      } else {
        console.warn(
          `Failed to load checkpoint file '${this.checkpointPath}': ${fsError.message || String(error)}. Starting fresh.`
        );
        return null;
      }
    }
  }

  /**
   * Check if a checkpoint is valid for the current configuration
   */
  isCheckpointValid(
    checkpoint: CheckpointData,
    currentDataPath: string,
    currentConfigHash: string
  ): boolean {
    return checkpoint.dataPath === currentDataPath && checkpoint.configHash === currentConfigHash;
  }

  /**
   * Remove checkpoint file
   */
  async clearCheckpoint(): Promise<void> {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(this.checkpointPath);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') {
        // File doesn't exist - this is fine, nothing to remove
        return;
      } else if (fsError.code === 'EACCES') {
        console.warn(
          `Cannot remove checkpoint file '${this.checkpointPath}': Permission denied. Please remove manually.`
        );
      } else {
        console.warn(
          `Failed to remove checkpoint file '${this.checkpointPath}': ${fsError.message || String(error)}`
        );
      }
    }
  }

  /**
   * Create a hash of configuration to detect changes
   */
  static createConfigHash(config: Record<string, unknown>): string {
    // Create a stable hash of the configuration
    const configString = JSON.stringify(config, Object.keys(config).sort());
    return createHash('md5').update(configString).digest('hex');
  }

  /**
   * Pre-process entire dataset to create UUID index for proper merging
   */
  static async createUuidIndex(
    dataPath: string,
    batchSize: number,
    uuidColumn?: string
  ): Promise<UuidIndex> {
    try {
      const { loadData } = await import('../utils/data-loader.js');
      const uuidToRowIndices = new Map<string, number[]>();
      let rowIndex = 0;
      let batchCount = 0;

      // Validate input parameters
      if (!dataPath) {
        throw new Error('Data path is required for UUID indexing');
      }
      if (batchSize <= 0) {
        throw new Error(`Invalid batch size: ${batchSize}. Batch size must be positive.`);
      }

      // Process entire dataset to build UUID mapping
      for await (const batch of loadData(dataPath, batchSize)) {
        batchCount++;

        if (!Array.isArray(batch) || batch.length === 0) {
          console.warn(`UUID indexing: Batch ${batchCount} is empty or invalid, skipping.`);
          continue;
        }

        try {
          const batchWithUuids = assignUuidsToBatch(batch, uuidColumn);

          for (const record of batchWithUuids) {
            const uuid = record.userID as string;

            if (!uuid) {
              console.warn(
                `UUID indexing: Row ${rowIndex} missing UUID, this may cause issues during processing.`
              );
              rowIndex++;
              continue;
            }

            if (!uuidToRowIndices.has(uuid)) {
              uuidToRowIndices.set(uuid, []);
            }
            uuidToRowIndices.get(uuid)!.push(rowIndex);
            rowIndex++;
          }
        } catch (error) {
          const batchError = error as Error;
          throw new Error(
            `UUID indexing failed at batch ${batchCount} (rows ${rowIndex}-${rowIndex + batch.length - 1}): ${batchError.message}`
          );
        }
      }

      if (rowIndex === 0) {
        throw new Error(
          `No data found in file '${dataPath}'. Please check the file exists and contains valid data.`
        );
      }

      return {
        uuidToRowIndices,
        totalRows: rowIndex,
      };
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw our own detailed errors
        if (error.message.includes('UUID indexing')) {
          throw error;
        }
        // Handle file system and data loading errors
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === 'ENOENT') {
          throw new Error(`UUID indexing failed: Data file '${dataPath}' does not exist.`);
        } else if (fsError.code === 'EACCES') {
          throw new Error(
            `UUID indexing failed: Permission denied reading '${dataPath}'. Check file permissions.`
          );
        } else if (fsError.code === 'EISDIR') {
          throw new Error(`UUID indexing failed: '${dataPath}' is a directory, not a file.`);
        } else {
          throw new Error(
            `UUID indexing failed: ${fsError.message} (Code: ${fsError.code || 'Unknown'})`
          );
        }
      } else {
        throw new Error(`UUID indexing failed with unexpected error: ${String(error)}`);
      }
    }
  }
}
