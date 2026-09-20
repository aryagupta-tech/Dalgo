import type { Language, Problem, Submission } from "../shared/types";
import type { Env } from "./env";
import { buildHarness, compareOutputs } from "./harness";
import type { JudgeResult } from "./judge";
import { MAX_JUDGE_MS } from "./core";

export const CODEBOX_LANGUAGES: Record<Language, number> = {
  python: 71,
  cpp: 54,
  java: 62,
  javascript: 63,
};
export const usesCodebox = (env: Env) => env.JUDGE_PROVIDER !== "jdoodle";
export const CODEBOX_POLL_MS = 2000;

/** All traffic uses a private binding, except an explicitly configured local endpoint. */
async function request(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Auth-Token", env.CODEBOX_AUTH_TOKEN ?? "");
  headers.set("Content-Type", "application/json");
  const options = { ...init, headers, signal: AbortSignal.timeout(5000) };
  let response: Response;
  if (env.CODEBOX) {
    response = await env.CODEBOX.fetch(
      new Request("http://codebox:3000" + path, options),
    );
  } else {
    const base = new URL(env.CODEBOX_LOCAL_URL || "http://invalid");
    if (
      env.ADMISSION_MODE === "public" ||
      base.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.username ||
      base.password
    )
      throw new Error("Private Codebox binding is required");
    response = await fetch(new URL(path, base), options);
  }
  if (!response.ok) throw new Error(`Codebox unavailable (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Codebox response");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512000) {
      await reader.cancel();
      throw new Error("Invalid Codebox response size");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export async function codeboxHealthy(env: Env) {
  const data = await request(env, "/health");
  if (
    data.ready !== true ||
    data.executor !== "isolate" ||
    data.concurrency !== 1
  )
    throw new Error("Codebox sandbox is not ready");
  return true;
}

export async function createExecution(
  env: Env,
  problem: Problem,
  s: Submission,
  jobId: string,
) {
  const data = await request(env, "/submissions", {
    method: "POST",
    headers: { "Idempotency-Key": jobId },
    body: JSON.stringify({
      source_code: buildHarness(problem, s.language, s.source, s.kind),
      language_id: CODEBOX_LANGUAGES[s.language],
      deadline: s.receivedAt + MAX_JUDGE_MS,
    }),
  });
  if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token))
    throw new Error("Invalid execution token");
  return data.token;
}

export function interpretCodebox(
  data: Record<string, unknown>,
  problem: Problem,
  kind: "run" | "submit",
): JudgeResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      verdict: "judge_error",
      message: "Code execution did not return a reliable result.",
    };
  const status = (data.status as { id?: unknown } | undefined)?.id;
  if (status === 1 || status === 2) return null;
  if (status === 13 || typeof status !== "number" || status < 3 || status > 13)
    return {
      verdict: "judge_error",
      message: "Code execution did not return a reliable result.",
    };
  if (status === 8 || data.output_limit === true)
    return {
      verdict: "output_limit",
      message: "Your program produced too much output.",
    };
  if (status === 5)
    return {
      verdict: "time_limit",
      message: "Your program exceeded the execution limit.",
    };
  if (status === 6)
    return {
      verdict: "compile_error",
      message:
        "Your code did not compile. Check the function signature and syntax.",
    };
  if (status !== 3 || data.exit_code !== 0)
    return {
      verdict: "runtime_error",
      message: "Your program did not finish successfully.",
    };
  const output = typeof data.stdout === "string" ? data.stdout : "";
  if (new TextEncoder().encode(output).byteLength > 65536)
    return {
      verdict: "output_limit",
      message: "Your program produced too much output.",
    };
  const cases = kind === "run" ? problem.examples : problem.tests;
  const parsed = compareOutputs(
    output,
    cases.map((c) => c.expected),
  );
  if (!parsed.valid)
    return {
      verdict: "runtime_error",
      message: "The function did not return valid results for every test.",
    };
  return {
    verdict: parsed.passed ? "accepted" : "wrong_answer",
    message: parsed.passed
      ? kind === "run"
        ? "All sample cases passed. Submit to check the hidden tests."
        : "All hidden tests passed."
      : "Some test cases did not pass. Check edge cases and try again.",
    ...(kind === "run"
      ? {
          sampleResults: cases.map((c, i) => ({
            passed:
              JSON.stringify(parsed.actual[i]) === JSON.stringify(c.expected),
            actual: parsed.actual[i],
            expected: c.expected,
          })),
        }
      : {}),
  };
}

export async function pollExecution(
  env: Env,
  token: string,
  problem: Problem,
  kind: "run" | "submit",
) {
  return interpretCodebox(
    await request(env, "/submissions/" + encodeURIComponent(token)),
    problem,
    kind,
  );
}
