#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
const file = new URL("../services/codebox/.env", import.meta.url);
try {
  await writeFile(
    file,
    `CODEBOX_AUTH_TOKEN=${randomBytes(32).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
await chmod(file, 0o600);
const text = await readFile(file, "utf8");
const token = /^CODEBOX_AUTH_TOKEN=([a-f0-9]{64})$/m.exec(text)?.[1];
if (!token)
  throw new Error(
    "Existing Codebox .env must contain a 64-character hex CODEBOX_AUTH_TOKEN",
  );
const workerFile = new URL("../.dev.vars.staging", import.meta.url);
let worker = await readFile(workerFile, "utf8").catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return "ADMISSION_MODE=staging\nLIVE_MATCHES_ENABLED=false\n";
});
const values = {
  JUDGE_PROVIDER: "codebox",
  CODEBOX_AUTH_TOKEN: token,
  CODEBOX_LOCAL_URL: "http://127.0.0.1:3000",
  JUDGE_CONCURRENCY: "1",
  MAX_ACTIVE_MATCHES: "1",
  LIVE_MATCHES_ENABLED: "false",
  JUDGE_VERIFIED_AT: "",
};
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  worker = pattern.test(worker)
    ? worker.replace(pattern, `${key}=${value}`)
    : worker + `\n${key}=${value}\n`;
}
await writeFile(workerFile, worker, { mode: 0o600 });
await chmod(workerFile, 0o600);
console.log(
  "Private Codebox credentials configured. Existing Supabase values preserved; live play disabled.",
);
