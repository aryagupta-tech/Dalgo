#!/usr/bin/env node
// Docker recovery checks. Hosted mode controls only the named Codebox VM.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const headers = {
  "Content-Type": "application/json",
  "X-Auth-Token": process.env.CODEBOX_AUTH_TOKEN,
};
if (!headers["X-Auth-Token"]) throw new Error("Codebox token required");
const base = process.env.CODEBOX_LOCAL_URL || "http://127.0.0.1:3000";
const awsHost = process.env.CODEBOX_RECOVERY_AWS_HOST;
const awsKey = process.env.CODEBOX_RECOVERY_AWS_KEY;
const gcpInstance = process.env.CODEBOX_RECOVERY_GCP_INSTANCE;
const gcpZone = process.env.CODEBOX_RECOVERY_GCP_ZONE || "asia-southeast1-b";
const gcpProject = process.env.CODEBOX_RECOVERY_GCP_PROJECT || "dalgo-508410";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(body, key) {
  return fetch(base + "/submissions", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}
async function result(token) {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(base + "/submissions/" + token, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.status.id > 2) return data;
    }
    await wait(500);
  }
  throw new Error("Recovery result deadline exceeded");
}
const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const compose = (...args) => {
  if (awsHost) {
    if (!awsKey) throw new Error("CODEBOX_RECOVERY_AWS_KEY is required");
    const command = [
      "sudo",
      "docker",
      "compose",
      "-f",
      "/opt/dalgo-codebox/compose.yaml",
      ...args,
    ]
      .map(quote)
      .join(" ");
    return execFileSync(
      "ssh",
      [
        "-i",
        awsKey,
        "-o",
        "StrictHostKeyChecking=yes",
        `ubuntu@${awsHost}`,
        command,
      ],
      { stdio: "pipe", timeout: 120000 },
    );
  }
  if (!gcpInstance)
    return execFileSync(
      "docker",
      ["compose", "-f", "services/codebox/compose.yaml", ...args],
      { stdio: "pipe", timeout: 60000 },
    );
  const command = [
    "sudo",
    "docker",
    "compose",
    "-f",
    "/opt/dalgo-codebox/compose.yaml",
    ...args,
  ]
    .map(quote)
    .join(" ");
  return execFileSync(
    "gcloud",
    [
      "compute",
      "ssh",
      gcpInstance,
      `--project=${gcpProject}`,
      `--zone=${gcpZone}`,
      "--quiet",
      `--command=${command}`,
    ],
    { stdio: "pipe", timeout: 120000 },
  );
};
async function ready() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + "/health", { headers })).ok) return;
    } catch {}
    await wait(500);
  }
  throw new Error("Sandbox not ready");
}
await ready();
const key = randomUUID();
const body = {
  source_code: 'print("recovery")',
  language_id: 71,
  deadline: Date.now() + 150000,
};
const replies = await Promise.all(
  Array.from({ length: 8 }, () =>
    post(body, key).then(async (r) => {
      assert.equal(r.status, 202);
      return r.json();
    }),
  ),
);
const token = replies[0].token;
assert(replies.every((r) => r.token === token));
assert.equal(
  (await post({ ...body, source_code: 'print("conflict")' }, key)).status,
  409,
);
assert.equal((await result(token)).status.id, 3);
compose("restart", "api");
await ready();
assert.equal((await (await post(body, key)).json()).token, token);
assert.equal((await result(token)).stdout.trim(), "recovery");
compose("restart", "redis");
await ready();
assert.equal((await result(token)).stdout.trim(), "recovery");
const inspect = `const {Queue}=require('bullmq'); const q=new Queue('dalgo-executions',{connection:{host:'redis'}}); q.getJob(${JSON.stringify(token)}).then(async j=>{console.log(j.attemptsStarted);await q.close()})`;
assert.equal(
  compose("exec", "-T", "api", "node", "-e", inspect).toString().trim(),
  "1",
);
console.log(
  "PASS parallel duplicates, conflicts, API restart, Redis restart, exactly one execution",
);
const slow = await (
  await post(
    {
      source_code: 'import time\ntime.sleep(9)\nprint("late")',
      language_id: 71,
      deadline: Date.now() + 150000,
    },
    randomUUID(),
  )
).json();
// Wait until the worker owns the job before forcibly killing its process.
for (let i = 0; i < 40; i++) {
  const r = await (
    await fetch(base + "/submissions/" + slow.token, { headers })
  ).json();
  if (r.status.id === 2) break;
  if (r.status.id > 2)
    throw new Error("Probe completed before the worker interruption");
  await wait(100);
}
compose("kill", "-s", "SIGKILL", "worker");
compose("up", "-d", "worker");
await ready();
assert.equal((await result(slow.token)).status.id, 13);
console.log(
  "PASS worker crash returns infrastructure error without rerunning the submission",
);
assert.equal((await fetch(base + "/health")).status, 401);
assert.equal(
  (await post({ ...body, deadline: Date.now() - 1 }, randomUUID())).status,
  400,
);
assert.equal(
  (
    await post(
      {
        ...body,
        deadline: Date.now() + 150000,
        callback_url: "http://127.0.0.1",
      },
      randomUUID(),
    )
  ).status,
  400,
);
console.log(
  "PASS missing authentication, expired jobs, forbidden execution options",
);
