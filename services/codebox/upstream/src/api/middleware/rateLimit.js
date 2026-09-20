import config from '../../utils/config.js';

// Simple in-memory rate limiter
const clients = new Map();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of clients) {
    if (now - value.windowStart > config.rateLimit.windowMs) {
      clients.delete(key);
    }
  }
}, 60000);

/**
 * Rate limiting middleware
 * Limits requests per IP within a time window
 */
export function rateLimitMiddleware(req, res, next) {
  const clientKey = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  let client = clients.get(clientKey);

  if (!client || now - client.windowStart > config.rateLimit.windowMs) {
    client = { windowStart: now, count: 0 };
    clients.set(clientKey, client);
  }

  client.count++;

  // Set rate limit headers
  res.set('X-RateLimit-Limit', config.rateLimit.maxRequests);
  res.set('X-RateLimit-Remaining', Math.max(0, config.rateLimit.maxRequests - client.count));
  res.set('X-RateLimit-Reset', Math.ceil((client.windowStart + config.rateLimit.windowMs) / 1000));

  if (client.count > config.rateLimit.maxRequests) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((client.windowStart + config.rateLimit.windowMs - now) / 1000),
    });
  }

  next();
}

export default rateLimitMiddleware;
