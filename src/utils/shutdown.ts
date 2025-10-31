import ora, { Ora } from 'ora';
import { bold } from './ui.js';

type OutputWriter = {
  write: (results: Record<string, unknown>[]) => Promise<void>;
  finalize?: () => Promise<void>;
};

/**
 * Handle CLI shutdown (Ctrl+C without cleanup)
 */
export function handleCliShutdown() {
  console.log('\n' + bold(`⚠️  Process interrupted by user` + '\n'));
  process.exit(0);
}

/**
 * Handle analysis shutdown with cleanup
 */
export async function analysisShutDown(
  spinner: Ora,
  stopSpinnerUpdate: () => void,
  resultsWriter: OutputWriter,
  enableLogging: boolean = false,
  flushLogs?: () => Promise<void>,
  newResultsWritten?: boolean
) {
  spinner.stop();
  stopSpinnerUpdate();

  console.log(bold('\n\n⚠️  Analysis interrupted - finalizing...'));

  const finalizeSpinner = ora('Finalizing...').start();

  if (resultsWriter.finalize) {
    try {
      await resultsWriter.finalize();
    } catch {
      finalizeSpinner.fail('Failed to finalize output file');
    }
  }

  if (enableLogging && flushLogs) {
    try {
      await flushLogs();
    } catch {
      finalizeSpinner.fail('Failed to flush logs');
    }
  }

  if (newResultsWritten === false) {
    finalizeSpinner.succeed('Analysis stopped successfully (no new results to save)');
  } else {
    finalizeSpinner.succeed('Partial results saved');
  }
}

export function createShutdownHandlerWithCleanup(
  spinner: Ora,
  stopSpinnerUpdate: () => void,
  resultsWriter: OutputWriter,
  enableLogging: boolean = false,
  flushLogs?: () => Promise<void>,
  setErrorFlag?: () => void,
  saveCheckpoint?: () => Promise<void>,
  newResultsWritten?: boolean
) {
  let shuttingDown = false;

  const handleAnalysisShutdownWithCleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (setErrorFlag) {
      setErrorFlag();
    }

    // Save checkpoint on interruption to allow resuming from this point
    if (saveCheckpoint) {
      try {
        await saveCheckpoint();
      } catch (error) {
        console.warn(`Failed to save checkpoint during shutdown: ${error}`);
      }
    }

    await analysisShutDown(
      spinner,
      stopSpinnerUpdate,
      resultsWriter,
      enableLogging,
      flushLogs,
      newResultsWritten
    );

    process.exit(0);
  };

  return handleAnalysisShutdownWithCleanup;
}

/**
 * Add SIGINT handler with cleanup removal
 */
export function withSigintHandler(handler: () => void | Promise<void>) {
  process.prependListener('SIGINT', handler);

  return () => {
    process.removeListener('SIGINT', handler);
  };
}
