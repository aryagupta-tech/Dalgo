import { Router } from 'express';
import client from 'prom-client';

const router = Router();

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const submissionsTotal = new client.Counter({
  name: 'codebox_submissions_total',
  help: 'Total number of submissions',
  labelNames: ['language_id', 'status'],
  registers: [register],
});

const executionDuration = new client.Histogram({
  name: 'codebox_execution_duration_seconds',
  help: 'Code execution duration in seconds',
  labelNames: ['language_id'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const queueSize = new client.Gauge({
  name: 'codebox_queue_size',
  help: 'Current queue size',
  registers: [register],
});

const activeWorkers = new client.Gauge({
  name: 'codebox_workers_active',
  help: 'Number of active workers',
  registers: [register],
});

const apiRequestDuration = new client.Histogram({
  name: 'codebox_api_request_duration_seconds',
  help: 'API request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

// Export metrics for use in other parts of the app
export const metrics = {
  submissionsTotal,
  executionDuration,
  queueSize,
  activeWorkers,
  apiRequestDuration,
};

export default router;
