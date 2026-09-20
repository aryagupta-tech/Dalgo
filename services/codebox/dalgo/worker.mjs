import Redis from "ioredis";
import { Worker } from "bullmq";
import IsolateExecutor from "../upstream/src/executor/IsolateExecutor.js";
import {
  execution,
  QUEUE,
  infrastructureError,
  publicResult,
} from "./protocol.mjs";
import { selfTest } from "./self-test.mjs";
if (process.env.EXECUTOR_TYPE !== "isolate")
  throw new Error("Only isolate is supported");
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
connection.on("error", () => console.error("redis_unavailable"));
const executor = new IsolateExecutor();
// Fatal startup failures prevent the heartbeat and therefore all new matches.
await connection.del("dalgo:sandbox:ready");
await selfTest(executor);
const pulse = () =>
  connection.set("dalgo:sandbox:ready", String(Date.now()), "EX", 15);
await pulse();
const heartbeat = setInterval(() => pulse().catch(() => {}), 3000);
const worker = new Worker(
  QUEUE,
  async (job) => {
    if (Date.now() >= job.data.deadline) return infrastructureError();
    const started = Date.now();
    let result;
    try {
      result = await executor.execute(execution(job.data));
    } catch {
      result = infrastructureError();
    }
    console.log(
      JSON.stringify({
        event: "codebox_execution",
        language: job.data.language_id,
        status: result.status.id,
        latencyMs: Date.now() - started,
      }),
    );
    if (result.status.id === 13) {
      clearInterval(heartbeat);
      await connection.del("dalgo:sandbox:ready");
      // A broken sandbox is not a compiler error. Restart and run the self-test.
      setTimeout(() => process.exit(1), 1000).unref();
    }
    return Date.now() >= job.data.deadline
      ? infrastructureError()
      : publicResult(result);
  },
  {
    connection,
    concurrency: 1,
    maxStalledCount: 0,
    lockDuration: 15000,
    stalledInterval: 1000,
  },
);
worker.on("error", () => console.error("execution_worker_error"));
process.on("SIGTERM", async () => {
  clearInterval(heartbeat);
  await connection.del("dalgo:sandbox:ready");
  await worker.close();
  await connection.quit();
  process.exit(0);
});
