import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validateSubmission, validateBatchSubmission, sanitizeCompilerOptions, sanitizeCommandLineArgs } from '../middleware/validation.js';
import { addSubmission, getSubmission, deleteSubmission } from '../../queue/producer.js';
import { getLanguageById, getStatusById } from '../../languages/index.js';
import { decodeIfNeeded, encodeIfNeeded } from '../../utils/base64.js';
import logger from '../../utils/logger.js';
import config from '../../utils/config.js';

const router = Router();

/**
 * Parse fields query parameter
 * @param {string} fields - Comma-separated list of fields
 * @returns {string[]|null} Array of field names or null for all fields
 */
function parseFields(fields) {
  if (!fields) return null;
  return fields.split(',').map(f => f.trim()).filter(Boolean);
}

/**
 * Filter response to only include specified fields
 */
function filterFields(result, fields) {
  if (!fields) return result;
  const filtered = {};
  for (const field of fields) {
    if (field in result) {
      filtered[field] = result[field];
    }
  }
  return filtered;
}

/**
 * Format submission for response
 */
function formatSubmission(submission, options = {}) {
  const { base64Encoded = false, fields = null } = options;

  const result = {
    token: submission.token,
    source_code: encodeIfNeeded(submission.source_code, base64Encoded),
    language_id: submission.language_id,
    stdin: encodeIfNeeded(submission.stdin, base64Encoded),
    expected_output: encodeIfNeeded(submission.expected_output, base64Encoded),
    stdout: encodeIfNeeded(submission.stdout, base64Encoded),
    stderr: encodeIfNeeded(submission.stderr, base64Encoded),
    compile_output: encodeIfNeeded(submission.compile_output, base64Encoded),
    message: submission.message,
    status: submission.status,
    created_at: submission.created_at,
    finished_at: submission.finished_at,
    time: submission.time,
    wall_time: submission.wall_time,
    memory: submission.memory,
    exit_code: submission.exit_code,
    exit_signal: submission.exit_signal,
  };

  return filterFields(result, fields);
}

/**
 * Wait for submission result with polling
 */
async function waitForResult(token, maxWait = 30000) {
  const start = Date.now();
  const pollInterval = 100;

  while (Date.now() - start < maxWait) {
    const result = await getSubmission(token);
    if (result && result.status && result.status.id > 2) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Return current state if timeout
  return await getSubmission(token);
}

/**
 * POST /submissions/batch
 * Create multiple submissions
 * NOTE: Must be defined BEFORE /:token routes
 */
router.post('/batch', validateBatchSubmission, async (req, res, next) => {
  try {
    const { submissions } = req.validatedBody;
    const base64Encoded = req.query.base64_encoded === 'true';

    const results = [];

    for (const data of submissions) {
      const sourceCode = decodeIfNeeded(data.source_code, base64Encoded);
      const stdin = decodeIfNeeded(data.stdin, base64Encoded);
      const expectedOutput = decodeIfNeeded(data.expected_output, base64Encoded);
      const language = getLanguageById(data.language_id);

      const submission = {
        token: uuidv4(),
        source_code: sourceCode,
        language_id: data.language_id,
        language,
        stdin: stdin || '',
        expected_output: expectedOutput,
        cpu_time_limit: data.cpu_time_limit,
        cpu_extra_time: data.cpu_extra_time,
        wall_time_limit: data.wall_time_limit,
        memory_limit: data.memory_limit,
        stack_limit: data.stack_limit,
        max_processes_and_or_threads: data.max_processes_and_or_threads,
        max_file_size: data.max_file_size,
        compiler_options: sanitizeCompilerOptions(data.compiler_options),
        command_line_arguments: sanitizeCommandLineArgs(data.command_line_arguments),
        redirect_stderr_to_stdout: data.redirect_stderr_to_stdout,
        enable_network: data.enable_network,
        callback_url: data.callback_url,
        additional_files: data.additional_files,
        status: getStatusById(1),
        created_at: new Date().toISOString(),
        finished_at: null,
        time: null,
        wall_time: null,
        memory: null,
        stdout: null,
        stderr: null,
        compile_output: null,
        message: null,
        exit_code: null,
        exit_signal: null,
      };

      await addSubmission(submission);
      results.push({ token: submission.token });
    }

    logger.info({
      event: 'batch_submission_created',
      count: results.length,
    });

    res.status(201).json(results);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /submissions/batch
 * Get multiple submissions by tokens
 * NOTE: Must be defined BEFORE /:token routes
 */
router.get('/batch', async (req, res, next) => {
  try {
    const tokens = req.query.tokens;
    const base64Encoded = req.query.base64_encoded === 'true';
    const fields = parseFields(req.query.fields);

    if (!tokens) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing tokens query parameter',
      });
    }

    const tokenList = tokens.split(',').map(t => t.trim()).filter(Boolean);

    if (tokenList.length > 20) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Maximum 20 tokens allowed',
      });
    }

    const results = await Promise.all(
      tokenList.map(async (token) => {
        const submission = await getSubmission(token);
        if (submission) {
          return formatSubmission(submission, { base64Encoded, fields });
        }
        return { token, error: 'Not found' };
      })
    );

    res.json({ submissions: results });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /submissions
 * Create a new submission
 */
router.post('/', validateSubmission, async (req, res, next) => {
  try {
    const data = req.validatedBody;
    const base64Encoded = req.query.base64_encoded === 'true';
    const wait = req.query.wait === 'true';
    const fields = parseFields(req.query.fields);

    // Decode base64 if needed
    const sourceCode = decodeIfNeeded(data.source_code, base64Encoded);
    const stdin = decodeIfNeeded(data.stdin, base64Encoded);
    const expectedOutput = decodeIfNeeded(data.expected_output, base64Encoded);

    // Get language config
    const language = getLanguageById(data.language_id);

    // Create submission object
    const submission = {
      token: uuidv4(),
      source_code: sourceCode,
      language_id: data.language_id,
      language,
      stdin: stdin || '',
      expected_output: expectedOutput,
      cpu_time_limit: data.cpu_time_limit,
      cpu_extra_time: data.cpu_extra_time,
      wall_time_limit: data.wall_time_limit,
      memory_limit: data.memory_limit,
      stack_limit: data.stack_limit,
      max_processes_and_or_threads: data.max_processes_and_or_threads,
      max_file_size: data.max_file_size,
      compiler_options: sanitizeCompilerOptions(data.compiler_options),
      command_line_arguments: sanitizeCommandLineArgs(data.command_line_arguments),
      redirect_stderr_to_stdout: data.redirect_stderr_to_stdout,
      enable_network: data.enable_network,
      callback_url: data.callback_url,
      additional_files: data.additional_files,
      status: getStatusById(1), // In Queue
      created_at: new Date().toISOString(),
      finished_at: null,
      time: null,
      wall_time: null,
      memory: null,
      stdout: null,
      stderr: null,
      compile_output: null,
      message: null,
      exit_code: null,
      exit_signal: null,
    };

    // Add to queue
    await addSubmission(submission);

    logger.info({
      event: 'submission_created',
      token: submission.token,
      language_id: submission.language_id,
    });

    if (wait) {
      // Wait for result
      const result = await waitForResult(submission.token);
      res.status(201).json(formatSubmission(result, { base64Encoded, fields }));
    } else {
      // Return immediately with token
      res.status(201).json({ token: submission.token });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /submissions/:token
 * Get submission by token
 */
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const base64Encoded = req.query.base64_encoded === 'true';
    const fields = parseFields(req.query.fields);

    const submission = await getSubmission(token);

    if (!submission) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Submission with token ${token} not found`,
      });
    }

    res.json(formatSubmission(submission, { base64Encoded, fields }));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /submissions/:token
 * Delete submission
 */
router.delete('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const deleted = await deleteSubmission(token);

    if (!deleted) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Submission with token ${token} not found`,
      });
    }

    res.status(200).json({ message: 'Submission deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
