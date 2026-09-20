#!/usr/bin/env node
import { build } from "esbuild";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { probeSource } from "./verify-judge.mjs";
const args = process.argv.slice(2);
if (args.some((arg) => !["--smoke", "--probes-only", "--help"].includes(arg)))
  throw new Error("Use --help for supported verification options");
if (args.includes("--help")) {
  console.log(
    "verify:codebox [--smoke | --probes-only]: execute local/private Codebox checks; never enables play. Default checks all 30 problems in all four languages and sandbox probes.",
  );
  process.exit(0);
}
if (args.includes("--smoke") && args.includes("--probes-only"))
  throw new Error("Choose one verification subset");
const base = new URL(process.env.CODEBOX_LOCAL_URL || "http://127.0.0.1:3000");
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
)
  throw new Error("Use a local endpoint or SSH port forward for verification");
if (!process.env.CODEBOX_AUTH_TOKEN)
  throw new Error("Run npm run setup:codebox first");
const directory = await mkdtemp(join(tmpdir(), "dalgo-codebox-"));
const startedAt = new Date().toISOString();
const results = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, body, key) {
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": process.env.CODEBOX_AUTH_TOKEN,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Codebox HTTP ${response.status}`);
  return response.json();
}
try {
  await build({
    stdin: {
      contents:
        'export {buildHarness} from "./worker/harness.ts"; export {CODEBOX_LANGUAGES,interpretCodebox} from "./worker/codebox.ts";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(directory, "adapter.mjs"),
  });
  const { buildHarness, CODEBOX_LANGUAGES, interpretCodebox } = await import(
    pathToFileURL(join(directory, "adapter.mjs")).href
  );
  let healthy;
  for (let tries = 0; tries < 30; tries++) {
    try {
      healthy = await request("/health");
      break;
    } catch {
      if (tries === 29)
        throw new Error("Sandbox did not become ready within 30 seconds");
      await wait(1000);
    }
  }
  if (!healthy.ready || healthy.executor !== "isolate")
    throw new Error("Sandbox not ready");
  const raw = await readFile(
    new URL("../worker/problems.json", import.meta.url),
    "utf8",
  );
  const bank = JSON.parse(raw);
  const probe = {
    id: "probe",
    examples: [{ args: [], expected: 17 }],
    tests: [{ args: [], expected: 17 }],
    parameters: [],
  };
  const checks = [];
  for (const [language, language_id] of Object.entries(CODEBOX_LANGUAGES)) {
    for (const problem of bank)
      checks.push({
        id: `${language}:${problem.id}`,
        language,
        language_id,
        problem,
        source: problem.references[language],
        expected: ["accepted"],
      });
    for (const category of [
      "wrong_answer",
      "syntax",
      "runtime",
      "timeout",
      "memory",
      "output",
    ]) {
      checks.push({
        id: `${language}:${category}`,
        language,
        language_id,
        problem: probe,
        source: probeSource(language, category),
        expected: {
          wrong_answer: ["wrong_answer"],
          syntax: ["compile_error", "runtime_error"],
          runtime: ["runtime_error"],
          timeout: ["time_limit"],
          memory: ["runtime_error", "time_limit"],
          output: ["output_limit"],
        }[category],
      });
    }
  }
  // Run twice to prove jobs cannot see files left by a prior execution.
  for (let round = 0; round < 2; round++)
    checks.push({
      id: `isolation:${round}`,
      language: "python",
      language_id: 71,
      problem: probe,
      expected: ["accepted"],
      source: `import os, socket\ndef solve():\n    assert not os.path.exists('/tmp/dalgo-cross-job')\n    open('/tmp/dalgo-cross-job','w').write('private')\n    assert not os.path.exists('/app')\n    assert not os.path.exists('/sys/fs/cgroup')\n    assert os.getuid() >= 60000\n    assert {line.split(':')[0].strip() for line in open('/proc/net/dev') if ':' in line} <= {'lo'}\n    assert 'AUTH_TOKEN' not in os.environ and 'REDIS_URL' not in os.environ\n    for host,port in [('1.1.1.1',53),('169.254.169.254',80),('127.0.0.1',3000)]:\n        s=socket.socket(); s.settimeout(0.2)\n        assert s.connect_ex((host,port)) != 0\n        s.close()\n    return 17`,
    });
  for (const fileType of ["symlink", "fifo"])
    checks.push({
      id: `output-file:${fileType}`,
      language: "python",
      language_id: 71,
      problem: probe,
      expected: ["runtime_error"],
      source: `import os\ndef solve():\n    os.unlink('/box/_stdout.txt')\n    ${fileType === "symlink" ? "os.symlink('/app/package.json', '/box/_stdout.txt')" : "os.mkfifo('/box/_stdout.txt')"}\n    return 17`,
    });
  if (args.includes("--probes-only")) {
    const ids = new Set(bank.map((p) => p.id));
    checks.splice(
      0,
      checks.length,
      ...checks.filter((c) => !ids.has(c.id.split(":")[1])),
    );
  }
  if (process.argv.includes("--smoke"))
    checks.splice(
      0,
      checks.length,
      ...checks.filter(
        (c) =>
          c.id.endsWith("wrong_answer") ||
          c.id.startsWith("isolation:") ||
          c.id.endsWith(`:${bank[0].id}`),
      ),
    );
  for (const check of checks) {
    const key = randomUUID(),
      deadline = Date.now() + 150000;
    const body = {
      source_code: buildHarness(
        check.problem,
        check.language,
        check.source,
        "submit",
      ),
      language_id: check.language_id,
      deadline,
    };
    const created = await request("/submissions", body, key);
    const duplicate = await request("/submissions", body, key);
    if (duplicate.token !== created.token)
      throw new Error("Duplicate request created another execution");
    let result;
    while (Date.now() < deadline) {
      const data = await request("/submissions/" + created.token);
      result = interpretCodebox(data, check.problem, "submit");
      if (result) break;
      await wait(500);
    }
    const passed = !!result && check.expected.includes(result.verdict);
    results.push({
      id: check.id,
      passed,
      verdict: result?.verdict ?? "judge_error",
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${check.id}: ${result?.verdict ?? "deadline"}`,
    );
  }
  await mkdir("artifacts", { recursive: true });
  const passed = results.every((r) => r.passed);
  await writeFile(
    args.includes("--smoke")
      ? "artifacts/codebox-smoke.json"
      : args.includes("--probes-only")
        ? "artifacts/codebox-probes.json"
        : "artifacts/codebox-verification.json",
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        passed,
        fullSuite: !args.includes("--smoke") && !args.includes("--probes-only"),
        bankSha256: createHash("sha256").update(raw).digest("hex"),
        results,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
