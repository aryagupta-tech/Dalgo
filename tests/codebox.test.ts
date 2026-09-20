import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExecution,
  interpretCodebox,
  pollExecution,
  codeboxHealthy,
} from "../worker/codebox";
import { launchReady, type Env } from "../worker/env";
import type { Problem, Submission } from "../shared/types";
import bank from "../worker/problems.json";
const problem = bank[0] as Problem;
const output =
  "\n__DALGO_RESULT__" + JSON.stringify(problem.tests.map((c) => c.expected));
const configured = {
  JUDGE_PROVIDER: "codebox",
  CODEBOX_AUTH_TOKEN: "a".repeat(64),
  CODEBOX: { fetch: vi.fn() },
  MAX_ACTIVE_MATCHES: "1",
  JUDGE_CONCURRENCY: "1",
  LIVE_MATCHES_ENABLED: "true",
  ADMISSION_MODE: "public",
  WEBSOCKET_SIGNING_SECRET: "b".repeat(64),
  SUPABASE_URL: "https://offline.invalid",
  SUPABASE_ANON_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "private",
  JUDGE_VERIFIED_AT: "2026-09-11T00:00:00Z",
} as unknown as Env;
afterEach(() => vi.restoreAllMocks());
describe("Codebox adapter", () => {
  it("checks answers in Dalgo rather than trusting the execution status", () => {
    expect(
      interpretCodebox(
        { status: { id: 3 }, exit_code: 0, stdout: output },
        problem,
        "submit",
      ),
    ).toMatchObject({ verdict: "accepted" });
    const wrong =
      "\n__DALGO_RESULT__" + JSON.stringify(problem.tests.map(() => null));
    expect(
      interpretCodebox(
        { status: { id: 3 }, exit_code: 0, stdout: wrong },
        problem,
        "submit",
      ),
    ).toMatchObject({ verdict: "wrong_answer" });
    expect(
      interpretCodebox(
        { status: { id: 3 }, exit_code: 0, stdout: output },
        problem,
        "submit",
      ),
    ).not.toHaveProperty("sampleResults");
    expect(
      interpretCodebox(
        { status: { id: 3 }, stdout: output },
        problem,
        "submit",
      ),
    ).toMatchObject({ verdict: "runtime_error" });
  });
  it.each([
    [1, null],
    [2, null],
    [5, "time_limit"],
    [6, "compile_error"],
    [8, "output_limit"],
    [11, "runtime_error"],
    [13, "judge_error"],
    [0, "judge_error"],
  ])("maps status %s", (id, verdict) => {
    const result = interpretCodebox({ status: { id } }, problem, "submit");
    expect(result?.verdict ?? null).toBe(verdict);
  });
  it("sends only source, language and deadline through the authenticated private binding", async () => {
    const fetcher = vi.fn(async () => Response.json({ token: "c".repeat(64) }));
    const env = { ...configured, CODEBOX: { fetch: fetcher } };
    const s = {
      id: "attempt",
      source: problem.references.python,
      language: "python",
      kind: "submit",
      receivedAt: 1000,
    } as Submission;
    expect(await createExecution(env, problem, s, "stable-key")).toBe(
      "c".repeat(64),
    );
    const request = (fetcher.mock.calls[0] as unknown as [Request])[0];
    expect(request.headers.get("Idempotency-Key")).toBe("stable-key");
    const body = (await request.json()) as any;
    expect(Object.keys(body).sort()).toEqual([
      "deadline",
      "language_id",
      "source_code",
    ]);
    expect(body.deadline).toBe(151000);
    expect(body.language_id).toBe(71);
  });
  it("rejects an unready sandbox and oversized responses as infrastructure failures", async () => {
    await expect(
      codeboxHealthy({
        ...configured,
        CODEBOX: {
          fetch: async () =>
            Response.json({ ready: true, executor: "docker", concurrency: 1 }),
        },
      }),
    ).rejects.toThrow("not ready");
    await expect(
      pollExecution(
        {
          ...configured,
          CODEBOX: { fetch: async () => new Response("x".repeat(512001)) },
        },
        "token",
        problem,
        "submit",
      ),
    ).rejects.toThrow("size");
  });
  it("requires the private binding for public play, verification, and conservative capacity", () => {
    expect(launchReady(configured)).toBe(true);
    for (const overrides of [
      { CODEBOX: undefined },
      { CODEBOX_AUTH_TOKEN: "" },
      { JUDGE_VERIFIED_AT: "" },
      { JUDGE_CONCURRENCY: "2" },
      { MAX_ACTIVE_MATCHES: "2" },
      { LIVE_MATCHES_ENABLED: "false" },
    ])
      expect(launchReady({ ...configured, ...overrides })).toBe(false);
    expect(
      launchReady({
        ...configured,
        JUDGE_DAILY_QUOTA: "0",
        JUDGE_CREDIT_COST: "0",
      }),
    ).toBe(true);
  });
});

const protocolUrl = new URL(
  "../services/codebox/dalgo/protocol.mjs",
  import.meta.url,
).href;
const { submission, authorized } = await import(protocolUrl);
describe("private execution protocol", () => {
  const body = { source_code: "print(1)", language_id: 71, deadline: 2000 };
  it("uses stable job IDs and detects changes independently of retry time", () => {
    expect(submission(body, "key", 1000)).toMatchObject({
      token: submission(body, "key", 1100).token,
      digest: submission(body, "key", 1100).digest,
    });
    expect(
      submission({ ...body, source_code: "print(2)" }, "key", 1100).digest,
    ).not.toBe(submission(body, "key", 1000).digest);
  });
  it.each([
    { language_id: 89 },
    { deadline: 1000 },
    { deadline: 152000 },
    { callback_url: "https://example.com" },
    { additional_files: "zip" },
    { compiler_options: "-anything" },
    { source_code: "\0" },
  ])("rejects unsafe or expired inputs %s", (change) => {
    expect(() => submission({ ...body, ...change }, "key", 1000)).toThrow();
  });
  it("fails closed when API authentication is absent or incorrect", () => {
    expect(authorized("", "")).toBe(false);
    expect(authorized("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(authorized("a".repeat(64), "a".repeat(64))).toBe(true);
  });
});
