import Joi from 'joi';
import config from '../../utils/config.js';
import { isValidLanguageId } from '../../languages/index.js';
import logger from '../../utils/logger.js';

// Multi-file program language ID
const MULTI_FILE_LANGUAGE_ID = 89;

// Submission validation schema
const submissionSchema = Joi.object({
  source_code: Joi.string().max(config.execution.maxSourceSize).allow('', null).default(null),
  language_id: Joi.number().integer().required().custom((value, helpers) => {
    if (!isValidLanguageId(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }),
  stdin: Joi.string().allow('', null).default(''),
  expected_output: Joi.string().allow('', null).default(null),
  cpu_time_limit: Joi.number().min(0).max(config.execution.maxCpuTimeLimit)
    .default(config.execution.defaultCpuTimeLimit),
  cpu_extra_time: Joi.number().min(0).max(5).default(1),
  wall_time_limit: Joi.number().min(0).max(config.execution.maxWallTimeLimit)
    .default(config.execution.defaultWallTimeLimit),
  memory_limit: Joi.number().min(0).max(config.execution.maxMemoryLimit)
    .default(config.execution.defaultMemoryLimit),
  stack_limit: Joi.number().min(0).max(config.execution.defaultStackLimit)
    .default(config.execution.defaultStackLimit),
  max_processes_and_or_threads: Joi.number().min(1).max(config.execution.maxProcesses)
    .default(config.execution.maxProcesses),
  max_file_size: Joi.number().min(0).max(4096).default(1024),
  compiler_options: Joi.string().allow('', null).default(null),
  command_line_arguments: Joi.string().allow('', null).default(null),
  redirect_stderr_to_stdout: Joi.boolean().default(false),
  enable_network: Joi.any().strip().default(false),
  callback_url: Joi.string().uri().allow('', null).default(null).custom((value, helpers) => {
    if (!value) return value;
    try {
      const url = new URL(value);
      // Block internal/private networks (SSRF protection)
      const hostname = url.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.') ||
        hostname.startsWith('192.168.') ||
        hostname === '169.254.169.254' ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local')
      ) {
        return helpers.error('any.invalid');
      }
      // Only allow http/https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return helpers.error('any.invalid');
      }
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }),
  additional_files: Joi.string().max(config.execution.maxAdditionalFilesSize)
    .when('language_id', {
      is: MULTI_FILE_LANGUAGE_ID,
      then: Joi.string().required(),
      otherwise: Joi.string().allow('', null).default(null),
    }),
});

// Batch submission validation
const batchSubmissionSchema = Joi.object({
  submissions: Joi.array().items(submissionSchema).min(1).max(20).required(),
});

/**
 * Validate submission request
 */
export function validateSubmission(req, res, next) {
  const { error, value } = submissionSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(422).json({
      error: 'Validation Error',
      message: error.details.map(d => d.message).join(', '),
      details: error.details,
    });
  }

  req.validatedBody = value;
  next();
}

/**
 * Validate batch submission request
 */
export function validateBatchSubmission(req, res, next) {
  const { error, value } = batchSubmissionSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    logger.warn({
      event: 'batch_validation_error',
      message: error.details.map(d => d.message).join(', '),
      details: error.details,
      submissionCount: req.body?.submissions?.length,
      languageIds: req.body?.submissions?.map(s => s.language_id),
    });
    return res.status(422).json({
      error: 'Validation Error',
      message: error.details.map(d => d.message).join(', '),
      details: error.details,
    });
  }

  req.validatedBody = value;
  next();
}

/**
 * Sanitize compiler options to prevent command injection.
 * Whitelist approach: only allow alphanumeric, hyphens, dots, equals, slashes,
 * plus, underscores, and spaces. Reject everything else including newlines.
 */
export function sanitizeCompilerOptions(options) {
  if (!options) return null;
  // Strip any character not in the safe set
  const sanitized = options.replace(/[^a-zA-Z0-9\s\-_.=+/]/g, '');
  // Collapse multiple spaces and trim
  return sanitized.replace(/\s+/g, ' ').trim() || null;
}

/**
 * Sanitize command line arguments to prevent command injection.
 * Same whitelist approach as compiler options.
 */
export function sanitizeCommandLineArgs(args) {
  if (!args) return null;
  const sanitized = args.replace(/[^a-zA-Z0-9\s\-_.=+/]/g, '');
  return sanitized.replace(/\s+/g, ' ').trim() || null;
}

export default {
  validateSubmission,
  validateBatchSubmission,
  sanitizeCompilerOptions,
  sanitizeCommandLineArgs,
};
