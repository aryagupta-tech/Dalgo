/**
 * Offline Durable Object lifecycle regression tests.
 * Run with a Vitest Node environment and the cloudflare:workers virtual module
 * provided in vitest.config.ts. All database and
 * judge requests are mocked; this suite never contacts a remote service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: any,
      public env: any,
    ) {}
  },
}));
vi.mock("../worker/db.ts", () => ({
  db: vi.fn(async () => null),
  settle: vi.fn(async () => ({ rating_changes: [] })),
  getPlayer: vi.fn(async (_env: any, id: string) => ({
    id,
    name: id,
    rating: 1200,
  })),
  recentProblems: vi.fn(async () => ({})),
}));
vi.mock("../worker/judge.ts", () => ({
  execute: vi.fn(),
  creditSpent: vi.fn(async () => 0),
}));

import { MatchRoom } from "../worker/match.ts";
import { Coordinator } from "../worker/coordinator.ts";
import { execute } from "../worker/judge.ts";
import { settle } from "../worker/db.ts";
import { MAX_JUDGE_MS, type MatchRecord } from "../worker/core.ts";
import bank from "../worker/problems.json";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const MATCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0);
let now: number;

class MemoryStorage {
  data = new Map<string, any>();
  alarm: number | null = null;
  async get(key: string) {
    return structuredClone(this.data.get(key));
  }
  async put(key: string, value: any) {
    this.data.set(key, structuredClone(value));
  }
  async setAlarm(value: number | Date) {
    this.alarm = Number(value);
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  async getAlarm() {
    return this.alarm;
  }
}

class MemoryContext {
  ready: Promise<unknown> = Promise.resolve();
  tasks = new Set<Promise<unknown>>();
  errors: unknown[] = [];
  constructor(public storage = new MemoryStorage()) {}
  blockConcurrencyWhile<T>(fn: () => Promise<T>) {
    this.ready = fn();
    return this.ready;
  }
  waitUntil(task: Promise<unknown>) {
    const tracked = Promise.resolve(task).catch((error) => {
      this.errors.push(error);
    });
    this.tasks.add(tracked);
    void tracked.finally(() => this.tasks.delete(tracked));
  }
  getWebSockets() {
    return [];
  }
  acceptWebSocket() {
    throw new Error("WebSocket handshakes require a workerd integration test");
  }
}

async function eventually(
  check: () => boolean,
  message = "asynchronous work did not finish",
) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

async function idle(ctx: MemoryContext) {
  await eventually(() => ctx.tasks.size === 0);
  expect(ctx.errors).toEqual([]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const accepted = { verdict: "accepted", message: "All tests passed." };
const unavailable = { verdict: "judge_error", message: "Unavailable." };

function env(overrides: Record<string, any> = {}) {
  const coordinatorFetch = vi.fn(async () => Response.json({ ok: true }));
  return {
    SUPABASE_URL: "https://offline.invalid",
    SUPABASE_ANON_KEY: "not-a-key",
    SUPABASE_SERVICE_ROLE_KEY: "not-a-secret",
    JDOODLE_CLIENT_ID: "offline",
    JDOODLE_CLIENT_SECRET: "offline",
    LIVE_MATCHES_ENABLED: "true",
    JUDGE_VERIFIED_AT: new Date(T0).toISOString(),
    JUDGE_DAILY_QUOTA: "200",
    JUDGE_CREDIT_COST: "1",
    JUDGE_CONCURRENCY: "10",
    JUDGE_RESET_HOUR_UTC: "0",
    ALLOWED_ORIGINS: "https://offline.invalid",
    COORDINATOR: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: coordinatorFetch }),
    },
    MATCHES: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: vi.fn(async () => Response.json({ id: MATCH_ID })),
      }),
    },
    ASSETS: { fetch: vi.fn() },
    ...overrides,
  } as any;
}

function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  const problem = bank.find((problem) => problem.arena === "easy")!;
  return {
    id: MATCH_ID,
    arena: "easy",
    mode: "human",
    players: [
      { id: A, name: "Ada", rating: 1200 },
      { id: B, name: "Ben", rating: 1200 },
    ],
    problemId: problem.id,
    problemVersion: problem.version,
    startsAt: T0 - 1000,
    endsAt: T0 + 600_000,
    submissions: [],
    bot: null,
    result: null,
    settlementComplete: false,
    archived: false,
    createdAt: T0 - 6000,
    ...overrides,
  };
}

function request(path: string, body?: unknown, userId = A) {
  return new Request("https://internal" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Dalgo-User": userId, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newRoom(initial = record(), runtimeEnv = env()) {
  const ctx = new MemoryContext();
  const room = new MatchRoom(ctx as any, runtimeEnv);
  await ctx.ready;
  expect((await room.fetch(request("/init", initial))).status).toBe(200);
  return { room, ctx, runtimeEnv };
}

async function submit(
  room: MatchRoom,
  userId: string,
  id: string,
  kind = "submit",
  source = "function solve() { return 0; }",
) {
  return room.fetch(
    request(
      "/" + kind,
      { language: "javascript", source, requestId: id },
      userId,
    ),
  );
}

beforeEach(() => {
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.mocked(execute).mockReset();
  vi.mocked(settle).mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected remote request");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authoritative match lifecycle", () => {
  it("waits for a hidden submission received before the bot, then awards that earlier human solution", async () => {
    const result = deferred<any>();
    vi.mocked(execute).mockReturnValue(result.promise);
    const { room, ctx } = await newRoom(
      record({
        mode: "bot",
        players: [
          { id: A, name: "Ada", rating: 1200 },
          { id: "bot", name: "Vector", rating: 1200, isBot: true },
        ],
        bot: { rating: 1200, solves: true, completesAt: T0 + 1000 },
      }),
    );
    expect((await submit(room, A, "human-before-bot")).status).toBe(202);
    await eventually(() => vi.mocked(execute).mock.calls.length === 1);
    now += 1001;
    await room.alarm();
    const pending = (await (await room.fetch(request("/view"))).json()) as any;
    expect(pending.result).toBeNull();
    expect(pending.submissions[0].verdict).toBe("pending");
    result.resolve(accepted);
    await idle(ctx);
    expect((await ctx.storage.get("match")).result).toMatchObject({
      winnerId: A,
      reason: "solved",
    });
  });

  it("uses receipt order when the later human submission finishes judging first", async () => {
    const results: Record<string, ReturnType<typeof deferred<any>>> = {
      [A]: deferred<any>(),
      [B]: deferred<any>(),
    };
    vi.mocked(execute).mockImplementation(
      async (_env, _problem, submission) => results[submission.userId].promise,
    );
    const { room, ctx } = await newRoom();
    await submit(room, A, "earlier");
    await eventually(() => vi.mocked(execute).mock.calls.length === 1);
    now += 1;
    await submit(room, B, "later");
    await eventually(() => vi.mocked(execute).mock.calls.length === 2);
    results[B].resolve(accepted);
    await eventually(
      () =>
        ctx.storage.data.get("match")?.submissions[1]?.verdict === "accepted",
    );
    expect((await ctx.storage.get("match")).result).toBeNull();
    results[A].resolve(accepted);
    await idle(ctx);
    expect((await ctx.storage.get("match")).result).toMatchObject({
      winnerId: A,
      reason: "solved",
    });
  });

  it("voids an overdue result even if no alarm ran before the judge promise resolved", async () => {
    const result = deferred<any>();
    vi.mocked(execute).mockReturnValue(result.promise);
    const { room, ctx } = await newRoom();
    await submit(room, A, "deadline-race");
    await eventually(() => vi.mocked(execute).mock.calls.length === 1);
    now += MAX_JUDGE_MS + 1;
    result.resolve(accepted);
    await idle(ctx);
    const saved = await ctx.storage.get("match");
    expect(saved.submissions[0].verdict).toBe("judge_error");
    expect(saved.result).toMatchObject({
      winnerId: null,
      reason: "void",
      deltas: { [A]: 0, [B]: 0 },
    });
  });

  it("allows at most two operational retries per human across three sample attempts", async () => {
    vi.mocked(execute)
      .mockResolvedValueOnce(unavailable as any)
      .mockResolvedValueOnce(accepted as any)
      .mockResolvedValueOnce(unavailable as any)
      .mockResolvedValueOnce(accepted as any)
      .mockResolvedValueOnce(unavailable as any);
    const { room, ctx, runtimeEnv } = await newRoom();
    for (let i = 0; i < 3; i++) {
      expect((await submit(room, A, "sample-" + i, "run")).status).toBe(202);
      await idle(ctx);
    }
    expect(execute).toHaveBeenCalledTimes(5);
    const saved = await ctx.storage.get("match");
    expect(
      saved.submissions.map((submission: any) => submission.attempt),
    ).toEqual([2, 2, 1]);
    expect(saved.result).toBeNull();
    const calls = runtimeEnv.COORDINATOR.get().fetch.mock.calls;
    const retries = calls.filter(
      ([url, init]: any[]) =>
        new URL(url).pathname === "/lease" && JSON.parse(init.body).retry,
    );
    expect(retries).toHaveLength(2);
  });

  it("accepts a submission received before expiry even when earlier storage work delays handling", async () => {
    const judge = deferred<any>();
    vi.mocked(execute).mockReturnValue(judge.promise);
    const endsAt = T0 + 10;
    const { room, ctx } = await newRoom(record({ endsAt }));
    const writing = deferred<void>();
    const unblock = deferred<void>();
    const originalPut = ctx.storage.put.bind(ctx.storage);
    vi.spyOn(ctx.storage, "put").mockImplementationOnce(
      async (key: string, value: any) => {
        writing.resolve();
        await unblock.promise;
        await originalPut(key, value);
      },
    );

    now = endsAt - 1;
    const precedingView = room.fetch(request("/view"));
    await writing.promise;
    // fetch captures this request's receipt time immediately, before Serial runs it.
    const onTimeSubmission = submit(room, A, "queued-before-expiry");
    now = endsAt + 1;
    unblock.resolve();
    await precedingView;

    expect((await onTimeSubmission).status).toBe(202);
    await eventually(() => vi.mocked(execute).mock.calls.length === 1);
    const pending = await ctx.storage.get("match");
    expect(pending.result).toBeNull();
    expect(pending.submissions[0].receivedAt).toBe(endsAt - 1);
    judge.resolve(accepted);
    await idle(ctx);
    expect((await ctx.storage.get("match")).result).toMatchObject({
      winnerId: A,
      reason: "solved",
    });
  });

  it("preserves absolute cleanup retry deadlines across restart and continuous view polling", async () => {
    let releaseFails = true;
    const coordinatorFetch = vi.fn(async (url: string) =>
      new URL(url).pathname === "/settled" && releaseFails
        ? new Response("unavailable", { status: 503 })
        : Response.json({ ok: true }),
    );
    const runtimeEnv = env({
      COORDINATOR: {
        idFromName: (id: string) => id,
        get: () => ({ fetch: coordinatorFetch }),
      },
    });
    const { room, ctx } = await newRoom(record(), runtimeEnv);
    expect((await room.fetch(request("/resign", {}))).status).toBe(200);
    await idle(ctx);
    expect((await ctx.storage.get("match")).settlementComplete).toBe(true);
    expect((await ctx.storage.get("match")).coordinatorReleased).not.toBe(true);
    const firstRetryAt = ctx.storage.alarm!;
    expect(firstRetryAt).toBe(T0 + 5000);
    expect(settle).toHaveBeenCalledTimes(1);

    const restartedCtx = new MemoryContext(ctx.storage);
    const restarted = new MatchRoom(restartedCtx as any, runtimeEnv);
    await restartedCtx.ready;
    for (const offset of [1000, 2500, 4999]) {
      now = T0 + offset;
      expect((await restarted.fetch(request("/view"))).status).toBe(200);
      await idle(restartedCtx);
      expect(restartedCtx.storage.alarm).toBe(firstRetryAt);
    }

    // A real retry failure may advance the deadline; polling may not.
    now = firstRetryAt;
    await restarted.alarm();
    await idle(restartedCtx);
    const secondRetryAt = restartedCtx.storage.alarm!;
    expect(secondRetryAt).toBe(firstRetryAt + 5000);
    for (const offset of [1000, 3000, 4999]) {
      now = firstRetryAt + offset;
      await restarted.fetch(request("/view"));
      await idle(restartedCtx);
      expect(restartedCtx.storage.alarm).toBe(secondRetryAt);
    }

    releaseFails = false;
    now = secondRetryAt;
    await restarted.alarm();
    await idle(restartedCtx);
    const released = await restartedCtx.storage.get("match");
    expect(released.coordinatorReleased).toBe(true);
    expect(released.result.settled).toBe(true);
    expect(restartedCtx.storage.alarm).toBeNull();
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("rejects another user before exposing a match or dispatching the judge", async () => {
    const { room, ctx } = await newRoom();
    const response = await room.fetch(request("/view", undefined, C));
    expect(response.status).toBe(403);
    const body = (await response.json()) as any;
    expect(body.problem).toBeUndefined();
    expect(body.submissions).toBeUndefined();
    expect((await ctx.storage.get("match")).submissions).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["a lone UTF-16 surrogate", 'function solve() { return "\ud800"; }'],
    ["a NUL byte", 'function solve() { return "\u0000"; }'],
    ["a multibyte source over the UTF-8 byte cap", "é".repeat(32769)],
  ])(
    "rejects %s without dispatch or attempt consumption",
    async (_label, source) => {
      const { room, ctx } = await newRoom();
      const response = await submit(room, A, "bad-source", "submit", source);
      expect(response.status).toBe(400);
      expect((await ctx.storage.get("match")).submissions).toEqual([]);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});

describe("global admission and execution reservations", () => {
  it("returns the existing queue request ID, ignores stale cancellation, and refunds valid cancellation", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    const join = async (requestId: string, arena = "easy") =>
      (
        await coordinator.fetch(
          request("/join", { userId: A, requestId, arena }),
        )
      ).json() as Promise<any>;
    const first = await join("original-request");
    const duplicate = await join("new-tab-request", "hard");
    expect(first.status).toBe("waiting");
    expect(duplicate).toMatchObject({
      status: "waiting",
      requestId: "original-request",
      arena: "easy",
    });
    expect(Object.keys((await ctx.storage.get("state")).reservations)).toEqual([
      A,
    ]);
    const stale = (await (
      await coordinator.fetch(
        request("/cancel", { userId: A, requestId: "new-tab-request" }),
      )
    ).json()) as any;
    expect(stale.status).toBe("waiting");
    const cancelled = (await (
      await coordinator.fetch(
        request("/cancel", { userId: A, requestId: duplicate.requestId }),
      )
    ).json()) as any;
    expect(cancelled.status).toBe("idle");
    expect((await ctx.storage.get("state")).reservations).toEqual({});
    const health = (await (
      await coordinator.fetch(request("/health"))
    ).json()) as any;
    expect(health.remaining).toBe(160);
  });

  it("isolates each human’s eight base and two retry executions and never double-charges a job", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    await coordinator.fetch(
      request("/join", { userId: A, requestId: "a", arena: "easy" }),
    );
    const matched = (await (
      await coordinator.fetch(
        request("/join", { userId: B, requestId: "b", arena: "easy" }),
      )
    ).json()) as any;
    expect(matched.status).toBe("matched");
    const matchId = matched.matchId;
    async function lease(userId: string, jobId: string, retry: boolean) {
      return (
        await coordinator.fetch(
          request("/lease", { matchId, userId, jobId, retry }),
        )
      ).json() as Promise<any>;
    }
    async function release(jobId: string) {
      await coordinator.fetch(request("/release-lease", { jobId }));
    }
    for (let i = 0; i < 8; i++) {
      expect(await lease(A, "a-base-" + i, false)).toEqual({ ok: true });
      await release("a-base-" + i);
    }
    for (let i = 0; i < 2; i++) {
      expect(await lease(A, "a-retry-" + i, true)).toEqual({ ok: true });
      await release("a-retry-" + i);
    }
    expect(await lease(A, "a-extra-base", false)).toMatchObject({
      ok: false,
      reason: "quota",
    });
    expect(await lease(A, "a-extra-retry", true)).toMatchObject({
      ok: false,
      reason: "quota",
    });
    expect(await lease(A, "a-base-0", false)).toMatchObject({
      ok: false,
      reason: "already_spent",
    });
    let saved = await ctx.storage.get("state");
    expect(saved.spent).toBe(10);
    expect(saved.reservations[matchId].budgets[B]).toEqual({
      base: 8,
      retries: 2,
    });
    for (let i = 0; i < 8; i++) {
      expect(await lease(B, "b-base-" + i, false)).toEqual({ ok: true });
      await release("b-base-" + i);
    }
    for (let i = 0; i < 2; i++) {
      expect(await lease(B, "b-retry-" + i, true)).toEqual({ ok: true });
      await release("b-retry-" + i);
    }
    saved = await ctx.storage.get("state");
    expect(saved.spent).toBe(20);
    expect(saved.reservations[matchId].remaining).toBe(0);
    expect(saved.reservations[matchId].budgets[A]).toEqual({
      base: 0,
      retries: 0,
    });
    expect(saved.reservations[matchId].budgets[B]).toEqual({
      base: 0,
      retries: 0,
    });
  });
});
