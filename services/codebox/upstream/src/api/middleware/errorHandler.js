import logger from '../../utils/logger.js';

/**
 * Global error handling middleware
 */
export function errorHandler(err, req, res, next) {
  // Log the error
  logger.error({
    err,
    method: req.method,
    url: req.url,
    body: req.body,
    ip: req.ip,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      error: 'Validation Error',
      message: err.message,
    });
  }

  if (err.name === 'SyntaxError' && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body',
    });
  }

  // Default server error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.name || 'Internal Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
}

/**
 * Not found handler for undefined routes
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`,
  });
}

export default {
  errorHandler,
  notFoundHandler,
};
