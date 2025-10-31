/**
 * Context to track retry attempt information per batch
 */
const batchAttemptNumbers = new Map<number, number>();

/**
 * Set the current attempt number for a specific batch
 */
export function setCurrentAttemptNumber(batchIndex: number, attemptNumber: number): void {
  batchAttemptNumbers.set(batchIndex, attemptNumber);
}

/**
 * Get the current attempt number for a specific batch
 */
export function getCurrentAttemptNumber(batchIndex?: number): number | undefined {
  if (batchIndex === undefined) {
    // If no batch index provided, we can't determine the attempt number
    return undefined;
  }
  return batchAttemptNumbers.get(batchIndex);
}

/**
 * Clear the attempt number for a specific batch
 */
export function clearCurrentAttemptNumber(batchIndex: number): void {
  batchAttemptNumbers.delete(batchIndex);
}

/**
 * Clear all attempt numbers (for cleanup)
 */
export function clearAllAttemptNumbers(): void {
  batchAttemptNumbers.clear();
}
