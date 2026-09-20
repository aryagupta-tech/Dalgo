import express from "express";
import Redis from "ioredis";
import { Queue } from "bullmq";
import {
  authorized,
  submission,
  QUEUE,
  RETENTION_MS,
  infrastructureError,
} from "./protocol.mjs";
const secret = process.env.AUTH_TOKEN;
if (!secret || secret.length < 32)
  throw new Error("AUTH_TOKEN must contain at least 32 characters");
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
connection.on("error", () => console.error("redis_unavailable"));
const queue = new Queue(QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 86400 },
  },
});
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!authorized(req.get("X-Auth-Token"), secret)) return res.sendStatus(401);
  next();
});
app.use(express.json({ limit: "1mb", strict: true }));
app.get("/health", async (_req, res) => {
  try {
    const pulse = await connection.get("dalgo:sandbox:ready");
    const ready = Boolean(pulse) && Date.now() - Number(pulse) < 15000;
    res
      .status(ready ? 200 : 503)
      .json({ ready, executor: "isolate", concurrency: 1 });
  } catch {
    res.status(503).json({ ready: false });
  }
});
app.post("/submissions", async (req, res) => {
  let data;
  try {
    data = submission(req.body, req.get("Idempotency-Key"));
  } catch {
    return res.status(400).json({ error: "Invalid execution request" });
  }
  try {
    let job = await queue.getJob(data.token);
    if (!job) {
      if (!(await connection.get("dalgo:sandbox:ready")))
        return res.sendStatus(503);
      // Coordinator admits at most two humans, each with one pending attempt.
      const counts = await queue.getJobCounts("wait", "active");
      if (counts.wait + counts.active >= 2) return res.sendStatus(503);
      // BullMQ's Lua add uses jobId atomically, including simultaneous POSTs.
      await queue.add("execute", data, { jobId: data.token });
      job = await queue.getJob(data.token);
    }
    if (!job) return res.sendStatus(503);
    if (job.data.digest !== data.digest)
      return res.status(409).json({ error: "Idempotency key conflict" });
    res.status(202).json({ token: data.token });
  } catch {
    res.sendStatus(503);
  }
});
app.get("/submissions/:token", async (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) return res.sendStatus(400);
  try {
    const job = await queue.getJob(req.params.token);
    if (!job) return res.sendStatus(404);
    const state = await job.getState();
    if (state === "completed") {
      // State may change after getJob; reload the atomically stored final result.
      const completed = await queue.getJob(req.params.token);
      return res.json(completed?.returnvalue ?? infrastructureError());
    }
    if (state === "failed" || Date.now() >= job.data.deadline)
      return res.json(infrastructureError());
    res.json({ status: { id: state === "active" ? 2 : 1 } });
  } catch {
    res.sendStatus(503);
  }
});
app.use((_req, res) => res.sendStatus(404));
app.use((_err, _req, res, _next) =>
  res.status(400).json({ error: "Invalid request" }),
);
// BullMQ's age cleanup is normally lazy. Sweep even on an idle server.
async function sweep() {
  let removed = 0;
  for (const state of ["completed", "failed", "wait", "delayed", "paused"])
    removed += (await queue.clean(RETENTION_MS - 60000, 10000, state)).length;
  if (removed) await connection.bgrewriteaof();
}
const cleanup = setInterval(
  () => sweep().catch(() => console.error("retention_cleanup_failed")),
  30000,
);
cleanup.unref();
await sweep();
app.listen(3000, "0.0.0.0", () => console.log("codebox_api_ready"));
