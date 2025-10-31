import { handleCliShutdown } from './shutdown.js';

/**
 * CLI SIGINT handler for basic operations
 */
let cliSigintHandler: (() => void) | null = null;

/**
 * Setup CLI SIGINT handler
 */
export function setupCliSigintHandler(): void {
  if (cliSigintHandler) {
    return;
  }

  cliSigintHandler = () => {
    handleCliShutdown();
  };

  process.on('SIGINT', cliSigintHandler);
}

/**
 * Remove CLI SIGINT handler
 */
export function removeCliSigintHandler(): void {
  if (cliSigintHandler) {
    process.removeListener('SIGINT', cliSigintHandler);
    cliSigintHandler = null;
  }
}

/**
 * Restore CLI SIGINT handler
 */
export function restoreCliSigintHandler(): void {
  setupCliSigintHandler();
}
