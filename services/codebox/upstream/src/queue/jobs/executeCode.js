import { getStatusById } from '../../languages/index.js';
import { getExecutor, getExecutorType } from '../../executor/ExecutorFactory.js';
import { analyzeCode } from '../../security/codeAnalyzer.js';
import logger from '../../utils/logger.js';

/**
 * Execute code submission job
 * @param {object} submission - The submission data
 * @returns {object} Execution result
 */
export async function executeCode(submission) {
  const executor = getExecutor();
  const executorType = getExecutorType();

  // Pre-execution security scan
  const scan = analyzeCode(submission.source_code, submission.language_id);
  if (scan.rejected) {
    logger.warn({
      event: 'code_rejected',
      token: submission.token,
      language_id: submission.language_id,
      reason: scan.reason,
    });

    return {
      ...submission,
      status: getStatusById(6),
      compile_output: `Rejected: ${scan.reason}`,
      stdout: null,
      stderr: null,
      time: null,
      wall_time: null,
      memory: null,
      exit_code: null,
      exit_signal: null,
      finished_at: new Date().toISOString(),
    };
  }

  logger.info({
    event: 'execution_started',
    token: submission.token,
    language_id: submission.language_id,
    executor: executorType,
  });

  const startTime = Date.now();

  try {
    const result = await executor.execute(submission);

    const executionTime = Date.now() - startTime;

    logger.info({
      event: 'execution_completed',
      token: submission.token,
      status: result.status.id,
      time: result.time,
      memory: result.memory,
      executionTime,
      executor: executorType,
    });

    return {
      ...submission,
      ...result,
      finished_at: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({
      event: 'execution_failed',
      token: submission.token,
      error: error.message,
      executor: executorType,
    });

    return {
      ...submission,
      status: getStatusById(13), // Internal Error
      message: error.message,
      finished_at: new Date().toISOString(),
    };
  }
}

/**
 * Compare output with expected output
 */
export function compareOutput(actual, expected) {
  if (!expected) return null;

  // Normalize outputs (trim trailing whitespace/newlines)
  const normalizedActual = (actual || '').trim();
  const normalizedExpected = expected.trim();

  return normalizedActual === normalizedExpected;
}

export default executeCode;
