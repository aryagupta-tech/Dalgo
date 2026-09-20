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
  getFriendIdentity: vi.fn(async (_env: any, id: string) => ({
    id,
    username:
      id === A
        ? "alice"
        : id === B
          ? "bob"
          : "carol",
    usernameConfigured: true,
    name: id,
  })),
  findFriendByUsername: vi.fn(async (_env: any, username: string) => {
    const id =
      username === "alice"
        ? A
        : username === "bob"
          ? B
          : username === "carol"
            ? C
            : null;
    return id
      ? { id, username, usernameConfigured: true, name: id }
      : null;
  }),
  persistFriendChallenge: vi.fn(async () => null),
  recentProblems: vi.fn(async () => ({})),
}));
vi.mock("../worker/judge.ts", () => ({
  execute: vi.fn(),
  creditSpent: vi.fn(async () => 0),
}));

vi.mock("../worker/codebox.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/codebox.ts")>()),
  createExecution: vi.fn(),
  pollExecution: vi.fn(),
  codeboxHealthy: vi.fn(async () => true),
}));
import {
  createExecution,
  pollExecution,
  codeboxHealthy,
} from "../worker/codebox.ts";

import { MatchRoom } from "../worker/match.ts";
import { Coordinator } from "../worker/coordinator.ts";
import { execute, creditSpent } from "../worker/judge.ts";
import { settle, getPlayer, persistFriendChallenge } from "../worker/db.ts";
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
    JUDGE_PROVIDER: "jdoodle",
    JDOODLE_CLIENT_ID: "offline",
    JDOODLE_CLIENT_SECRET: "offline",
    LIVE_MATCHES_ENABLED: "true",
    ADMISSION_MODE: "public",
    WEBSOCKET_SIGNING_SECRET: "offline-test-websocket-signing-secret",
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
  vi.mocked(creditSpent).mockClear();
  vi.mocked(getPlayer).mockClear();
  vi.mocked(persistFriendChallenge).mockClear();
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

describe("direct friend challenges", () => {
  const challengeRequest = (
    path: string,
    body: Record<string, unknown>,
    userId: string,
  ) => request(path, { userId, ...body }, userId);

  it("creates an idempotent private invite and blocks queueing while it is open", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    const challengeId = crypto.randomUUID();
    const created = await coordinator.fetch(
      challengeRequest(
        "/challenge-create",
        {
          requestId: challengeId,
          friendUsername: "bob",
          arena: "medium",
        },
        A,
      ),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      id: challengeId,
      arena: "medium",
      status: "open",
      challenger: { id: A },
      challenged: { id: B },
    });
    const retry = await coordinator.fetch(
      challengeRequest(
        "/challenge-create",
        {
          requestId: challengeId,
          friendUsername: "bob",
          arena: "hard",
        },
        A,
      ),
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      id: challengeId,
      arena: "medium",
    });
    expect(
      (
        await coordinator.fetch(
          request(
            "/join",
            { userId: A, requestId: crypto.randomUUID(), arena: "easy" },
            A,
          ),
        )
      ).status,
    ).toBe(409);
    expect(persistFriendChallenge).toHaveBeenCalledOnce();
  });

  it("rejects self, unknown, duplicate, and unauthorized challenge actions", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-create",
            {
              requestId: crypto.randomUUID(),
              friendUsername: "alice",
              arena: "easy",
            },
            A,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-create",
            {
              requestId: crypto.randomUUID(),
              friendUsername: "nobody",
              arena: "easy",
            },
            A,
          ),
        )
      ).status,
    ).toBe(404);
    const id = crypto.randomUUID();
    await coordinator.fetch(
      challengeRequest(
        "/challenge-create",
        {
          requestId: id,
          friendUsername: "bob",
          arena: "easy",
        },
        A,
      ),
    );
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-create",
            {
              requestId: crypto.randomUUID(),
              friendUsername: "bob",
              arena: "hard",
            },
            C,
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-respond",
            { challengeId: id, action: "accept" },
            C,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-respond",
            { challengeId: id, action: "cancel" },
            B,
          ),
        )
      ).status,
    ).toBe(403);
  });

  it("lets only the invited player accept and creates the normal authoritative human match", async () => {
    const initialized: MatchRecord[] = [];
    const ctx = new MemoryContext();
    const runtime = env({
      MATCHES: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async (_url: string, init: RequestInit) => {
            initialized.push(JSON.parse(String(init.body)));
            return Response.json({ ok: true });
          }),
        }),
      },
    });
    const coordinator = new Coordinator(ctx as any, runtime);
    await ctx.ready;
    const challengeId = crypto.randomUUID();
    await coordinator.fetch(
      challengeRequest(
        "/challenge-create",
        {
          requestId: challengeId,
          friendUsername: "bob",
          arena: "hard",
        },
        A,
      ),
    );
    const accepted = await coordinator.fetch(
      challengeRequest(
        "/challenge-respond",
        { challengeId, action: "accept" },
        B,
      ),
    );
    expect(accepted.status).toBe(200);
    const challenge = (await accepted.json()) as any;
    expect(challenge).toMatchObject({
      id: challengeId,
      status: "accepted",
      matchId: expect.any(String),
    });
    expect(initialized).toHaveLength(1);
    expect(initialized[0]).toMatchObject({
      id: challenge.matchId,
      arena: "hard",
      mode: "human",
      players: [{ id: A }, { id: B }],
      bot: null,
    });
    expect(initialized[0].startsAt).toBe(T0 + 5000);
    const state = await ctx.storage.get("state");
    expect(state.entries[A]).toMatchObject({
      status: "matched",
      matchId: challenge.matchId,
    });
    expect(state.entries[B]).toMatchObject({
      status: "matched",
      matchId: challenge.matchId,
    });
    expect(state.reservations[challenge.matchId].userIds).toEqual([A, B]);
    const retry = await coordinator.fetch(
      challengeRequest(
        "/challenge-respond",
        { challengeId, action: "accept" },
        B,
      ),
    );
    expect(await retry.json()).toMatchObject({ matchId: challenge.matchId });
    expect(initialized).toHaveLength(1);
  });

  it("retries a failed Supabase challenge audit after a durable restart", async () => {
    vi.mocked(persistFriendChallenge).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const ctx = new MemoryContext();
    const runtime = env();
    const coordinator = new Coordinator(ctx as any, runtime);
    await ctx.ready;
    const challengeId = crypto.randomUUID();
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-create",
            {
              requestId: challengeId,
              friendUsername: "bob",
              arena: "easy",
            },
            A,
          ),
        )
      ).status,
    ).toBe(201);
    expect((await ctx.storage.get("state")).challengeAuditPending).toEqual({
      [challengeId]: true,
    });
    const restartedContext = new MemoryContext(ctx.storage);
    const restarted = new Coordinator(restartedContext as any, runtime);
    await restartedContext.ready;
    await restarted.alarm();
    expect((await ctx.storage.get("state")).challengeAuditPending).toEqual({});
    expect(persistFriendChallenge).toHaveBeenCalledTimes(2);
  });

  it("expires unanswered challenges durably and allows a new invite", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    const challengeId = crypto.randomUUID();
    await coordinator.fetch(
      challengeRequest(
        "/challenge-create",
        {
          requestId: challengeId,
          friendUsername: "bob",
          arena: "easy",
        },
        A,
      ),
    );
    now += 10 * 60_000 + 1;
    const view = (await (
      await coordinator.fetch(request(`/challenge-status?userId=${A}`))
    ).json()) as any;
    expect(view.outgoing).toEqual([]);
    expect(view.recent[0]).toMatchObject({
      id: challengeId,
      status: "expired",
    });
    expect(
      (
        await coordinator.fetch(
          challengeRequest(
            "/challenge-create",
            {
              requestId: crypto.randomUUID(),
              friendUsername: "bob",
              arena: "medium",
            },
            A,
          ),
        )
      ).status,
    ).toBe(201);
  });
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

describe("durable staged admission", () => {
  async function createCoordinator(
    runtimeEnv = env(),
    ctx = new MemoryContext(),
  ) {
    const coordinator = new Coordinator(ctx as any, runtimeEnv);
    await ctx.ready;
    return { coordinator, ctx, runtimeEnv };
  }
  const joinRequest = (
    userId: string,
    requestId = crypto.randomUUID(),
    arena = "easy",
  ) => request("/join", { userId, requestId, arena }, userId);
  async function cancel(
    coordinator: Coordinator,
    userId: string,
    requestId: string,
  ) {
    const response = await coordinator.fetch(
      request("/cancel", { userId, requestId }, userId),
    );
    expect(response.status).toBe(200);
  }

  it("rejects an unlisted tester before spending credits or reading their profile", async () => {
    const { coordinator, ctx } = await createCoordinator(
      env({ ADMISSION_MODE: "staging", TESTER_USER_IDS: A }),
    );
    expect((await coordinator.fetch(joinRequest(B))).status).toBe(403);
    expect(creditSpent).not.toHaveBeenCalled();
    expect(getPlayer).not.toHaveBeenCalled();
    expect(await ctx.storage.get("state")).toBeUndefined();
    expect((await coordinator.fetch(joinRequest(A))).status).toBe(200);
    expect(getPlayer).toHaveBeenCalledOnce();
  });

  it("limits cancellation churn, exempts canonical retries, and survives restart", async () => {
    const { coordinator, ctx, runtimeEnv } = await createCoordinator();
    const originalId = crypto.randomUUID();
    await coordinator.fetch(joinRequest(A, originalId));
    for (let i = 0; i < 10; i++) {
      const duplicate = await coordinator.fetch(
        joinRequest(A, crypto.randomUUID(), "hard"),
      );
      expect(await duplicate.json()).toMatchObject({
        status: "waiting",
        requestId: originalId,
        arena: "easy",
      });
    }
    expect((await ctx.storage.get("state")).admissions[A]).toHaveLength(1);
    await cancel(coordinator, A, originalId);
    for (let i = 1; i < 6; i++) {
      const id = crypto.randomUUID();
      expect((await coordinator.fetch(joinRequest(A, id))).status).toBe(200);
      await cancel(coordinator, A, id);
    }
    const rebuilt = new Coordinator(
      new MemoryContext(ctx.storage) as any,
      runtimeEnv,
    );
    // Constructors load the same durable state; wait for their blockConcurrencyWhile callback.
    await eventually(() => Boolean((rebuilt as any).data));
    const denied = await rebuilt.fetch(joinRequest(A));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect((await ctx.storage.get("state")).admissions[A]).toHaveLength(6);
    expect((await ctx.storage.get("state")).reservations).toEqual({});
    now += 60_000;
    expect((await rebuilt.fetch(joinRequest(A))).status).toBe(200);
    expect((await ctx.storage.get("state")).admissions[A]).toHaveLength(7);
  });

  it("enforces thirty new searches per hour after individual minute windows recover", async () => {
    const { coordinator, ctx } = await createCoordinator();
    for (let group = 0; group < 5; group++) {
      now = T0 + group * 60_000;
      for (let i = 0; i < 6; i++) {
        const id = crypto.randomUUID();
        expect((await coordinator.fetch(joinRequest(A, id))).status).toBe(200);
        await cancel(coordinator, A, id);
      }
    }
    now = T0 + 5 * 60_000;
    const denied = await coordinator.fetch(joinRequest(A));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("3300");
    now = T0 + 3_600_000;
    expect((await coordinator.fetch(joinRequest(A))).status).toBe(200);
    expect((await ctx.storage.get("state")).admissions[A]).toHaveLength(25);
  });

  it("persists admission budget even when free capacity prevents a reservation", async () => {
    const { coordinator, ctx } = await createCoordinator(
      env({ JUDGE_DAILY_QUOTA: "1" }),
    );
    for (let i = 0; i < 6; i++)
      expect(
        await (await coordinator.fetch(joinRequest(A))).json(),
      ).toMatchObject({ status: "capacity" });
    expect((await coordinator.fetch(joinRequest(A))).status).toBe(429);
    expect(getPlayer).not.toHaveBeenCalled();
    expect((await ctx.storage.get("state")).reservations).toEqual({});
    expect((await ctx.storage.get("state")).admissions[A]).toHaveLength(6);
  });

  it("releases paused waiting searches but preserves matched reservations and recovery", async () => {
    const { coordinator, ctx, runtimeEnv } = await createCoordinator();
    const originalId = crypto.randomUUID();
    await coordinator.fetch(joinRequest(A, originalId));
    const matched = (await (
      await coordinator.fetch(joinRequest(B))
    ).json()) as any;
    await coordinator.fetch(joinRequest(C, crypto.randomUUID(), "hard"));
    runtimeEnv.ADMISSION_MODE = "disabled";
    expect(
      await (await coordinator.fetch(joinRequest(A))).json(),
    ).toMatchObject({ requestId: originalId, matchId: matched.matchId });
    await coordinator.alarm();
    const saved = await ctx.storage.get("state");
    expect(saved.entries[C]).toBeUndefined();
    expect(saved.reservations[C]).toBeUndefined();
    expect(saved.entries[A].matchId).toBe(matched.matchId);
    expect(saved.entries[B].matchId).toBe(matched.matchId);
    expect(saved.reservations[matched.matchId].remaining).toBe(20);
    const waiting = (await (
      await coordinator.fetch(request("/status?userId=" + C))
    ).json()) as any;
    expect(waiting).toMatchObject({ status: "idle" });
    expect(waiting.message).toContain("paused");
    expect(
      await (
        await coordinator.fetch(
          request("/lease", {
            matchId: matched.matchId,
            userId: A,
            jobId: "reserved-after-pause",
            retry: false,
          }),
        )
      ).json(),
    ).toEqual({ ok: true });
    expect(
      (
        await coordinator.fetch(
          request("/settled", { matchId: matched.matchId }),
        )
      ).status,
    ).toBe(200);
    expect((await ctx.storage.get("state")).reservations).toEqual({});
    expect((await coordinator.fetch(joinRequest(A))).status).toBe(503);
  });

  it("removes waiting users whose tester access was withdrawn", async () => {
    const { coordinator, ctx, runtimeEnv } = await createCoordinator(
      env({ ADMISSION_MODE: "staging", TESTER_USER_IDS: `${A},${B}` }),
    );
    await coordinator.fetch(joinRequest(A));
    runtimeEnv.TESTER_USER_IDS = B;
    await coordinator.alarm();
    expect((await ctx.storage.get("state")).entries[A]).toBeUndefined();
    expect((await ctx.storage.get("state")).reservations[A]).toBeUndefined();
    const status = (await (
      await coordinator.fetch(request("/status?userId=" + A))
    ).json()) as any;
    expect(status.message).toContain("invited testers");
    expect((await coordinator.fetch(joinRequest(A))).status).toBe(403);
    expect((await coordinator.fetch(joinRequest(B))).status).toBe(200);
  });

  it("does not pair a newly admitted tester with a withdrawn waiting tester before the next alarm", async () => {
    const { coordinator, ctx, runtimeEnv } = await createCoordinator(
      env({ ADMISSION_MODE: "staging", TESTER_USER_IDS: `${A},${B}` }),
    );
    await coordinator.fetch(joinRequest(A));
    runtimeEnv.TESTER_USER_IDS = B;
    const joined = (await (
      await coordinator.fetch(joinRequest(B))
    ).json()) as any;
    expect(joined.status).toBe("waiting");
    const saved = await ctx.storage.get("state");
    expect(saved.entries[A]).toBeUndefined();
    expect(saved.reservations[A]).toBeUndefined();
    expect(saved.entries[B].status).toBe("waiting");
    expect(Object.keys(saved.reservations)).toEqual([B]);
  });

  it("retries a persisted assignment after closing admissions", async () => {
    const init = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "transient" }, { status: 503 }),
      )
      .mockResolvedValue(Response.json({ ok: true }));
    const { coordinator, ctx, runtimeEnv } = await createCoordinator(
      env({
        MATCHES: {
          idFromName: (name: string) => name,
          get: () => ({ fetch: init }),
        },
      }),
    );
    await coordinator.fetch(joinRequest(A));
    expect((await coordinator.fetch(joinRequest(B))).status).toBe(500);
    const assigned = await ctx.storage.get("state");
    const id = assigned.entries[A].matchId;
    expect(assigned.entries[A].status).toBe("assigning");
    runtimeEnv.ADMISSION_MODE = "disabled";
    await coordinator.alarm();
    const saved = await ctx.storage.get("state");
    expect(saved.entries[A]).toMatchObject({ status: "matched", matchId: id });
    expect(saved.entries[B]).toMatchObject({ status: "matched", matchId: id });
    expect(saved.reservations[id].remaining).toBe(20);
    expect(saved.assignments).toEqual({});
  });
});

describe("immutable match execution allowances", () => {
  it("reserves a complete two-human match within 16 admission credits when lower limits are configured", async () => {
    const initialized: MatchRecord[] = [];
    const ctx = new MemoryContext();
    const runtimeEnv = env({
      JUDGE_DAILY_QUOTA: "20",
      MATCH_RUN_LIMIT: "2",
      MATCH_SUBMISSION_LIMIT: "4",
      MATCHES: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async (_url: string, init: any) => {
            initialized.push(JSON.parse(init.body));
            return Response.json({ ok: true });
          }),
        }),
      },
    });
    const coordinator = new Coordinator(ctx as any, runtimeEnv);
    await ctx.ready;
    const first = (await (
      await coordinator.fetch(
        request("/join", { userId: A, requestId: "a", arena: "easy" }),
      )
    ).json()) as any;
    expect(first).toMatchObject({
      status: "waiting",
      attemptLimits: { runs: 2, submits: 4 },
    });
    const matched = (await (
      await coordinator.fetch(
        request("/join", { userId: B, requestId: "b", arena: "easy" }),
      )
    ).json()) as any;
    expect(matched.status).toBe("matched");
    const saved = await ctx.storage.get("state");
    expect(saved.reservations[matched.matchId]).toMatchObject({
      remaining: 16,
      creditCost: 1,
      budgets: { [A]: { base: 6, retries: 2 }, [B]: { base: 6, retries: 2 } },
    });
    expect(initialized[0].attemptLimits).toEqual({ runs: 2, submits: 4 });
    const full = (await (
      await coordinator.fetch(
        request("/join", { userId: C, requestId: "c", arena: "easy" }),
      )
    ).json()) as any;
    expect(full.status).toBe("capacity");
    expect((await ctx.storage.get("state")).entries[C]).toBeUndefined();
  });

  it("preserves active budgets and their credit cost across a deployment and restart", async () => {
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
    const restoredCtx = new MemoryContext(ctx.storage);
    const restored = new Coordinator(
      restoredCtx as any,
      env({
        MATCH_RUN_LIMIT: "2",
        MATCH_SUBMISSION_LIMIT: "4",
        JUDGE_CREDIT_COST: "3",
      }),
    );
    await restoredCtx.ready;
    for (let i = 0; i < 8; i++) {
      const jobId = `old-${i}`;
      expect(
        await (
          await restored.fetch(
            request("/lease", {
              matchId: matched.matchId,
              userId: A,
              jobId,
              retry: false,
            }),
          )
        ).json(),
      ).toEqual({ ok: true });
      await restored.fetch(request("/release-lease", { jobId }));
    }
    expect(
      await (
        await restored.fetch(
          request("/lease", {
            matchId: matched.matchId,
            userId: A,
            jobId: "old-extra",
            retry: false,
          }),
        )
      ).json(),
    ).toEqual({ ok: false, reason: "quota" });
    let saved = await ctx.storage.get("state");
    expect(saved.spent).toBe(8);
    expect(saved.reservations[matched.matchId]).toMatchObject({
      remaining: 12,
      creditCost: 1,
      budgets: { [A]: { base: 0, retries: 2 }, [B]: { base: 8, retries: 2 } },
    });
    await restored.fetch(
      request("/join", { userId: C, requestId: "new", arena: "easy" }),
    );
    saved = await ctx.storage.get("state");
    expect(saved.entries[C].attemptLimits).toEqual({ runs: 2, submits: 4 });
    expect(saved.reservations[C]).toMatchObject({
      remaining: 24,
      creditCost: 3,
      budgets: { [C]: { base: 18, retries: 6 } },
    });
  });

  it("keeps legacy waiting allowances and avoids pairing humans with unequal limits", async () => {
    const initialized: MatchRecord[] = [];
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, env());
    await ctx.ready;
    await coordinator.fetch(
      request("/join", { userId: A, requestId: "old", arena: "easy" }),
    );
    const legacy = await ctx.storage.get("state");
    delete legacy.entries[A].attemptLimits;
    delete legacy.reservations[A].creditCost;
    await ctx.storage.put("state", legacy);
    const restoredCtx = new MemoryContext(ctx.storage);
    const restored = new Coordinator(
      restoredCtx as any,
      env({
        MATCH_RUN_LIMIT: "2",
        MATCH_SUBMISSION_LIMIT: "4",
        MATCHES: {
          idFromName: (name: string) => name,
          get: () => ({
            fetch: vi.fn(async (_url: string, init: any) => {
              initialized.push(JSON.parse(init.body));
              return Response.json({ ok: true });
            }),
          }),
        },
      }),
    );
    await restoredCtx.ready;
    const second = (await (
      await restored.fetch(
        request("/join", { userId: B, requestId: "new", arena: "easy" }),
      )
    ).json()) as any;
    expect(second.status).toBe("waiting");
    expect((await ctx.storage.get("state")).entries[A].attemptLimits).toEqual({
      runs: 3,
      submits: 5,
    });
    now += 15_000;
    await restored.alarm();
    expect(initialized).toHaveLength(2);
    expect(initialized.map((m) => m.mode)).toEqual(["bot", "bot"]);
    expect(initialized.map((m) => m.attemptLimits)).toEqual([
      { runs: 3, submits: 5 },
      { runs: 2, submits: 4 },
    ]);
  });

  it.each([
    ["run", 2],
    ["submit", 4],
  ] as const)(
    "enforces snapshotted %s limits despite later larger environment settings",
    async (kind, cap) => {
      const submissions = Array.from({ length: cap - 1 }, (_, sequence) => ({
        id: `previous-${sequence}`,
        userId: A,
        kind,
        language: "javascript" as const,
        source: "function solve() {}",
        receivedAt: T0 - 900 + sequence,
        sequence,
        verdict: "wrong_answer" as const,
        completedAt: T0 - 500 + sequence,
      }));
      vi.mocked(execute).mockResolvedValue({
        verdict: "wrong_answer",
        message: "Wrong answer.",
      });
      const { room, ctx } = await newRoom(
        record({ attemptLimits: { runs: 2, submits: 4 }, submissions }),
        env({ MATCH_RUN_LIMIT: "3", MATCH_SUBMISSION_LIMIT: "5" }),
      );
      const last = await submit(room, A, "last", kind);
      expect(last.status).toBe(202);
      expect(await last.json()).toMatchObject({
        attemptLimits: { runs: 2, submits: 4 },
      });
      await idle(ctx);
      const restoredCtx = new MemoryContext(ctx.storage);
      const restored = new MatchRoom(
        restoredCtx as any,
        env({ MATCH_RUN_LIMIT: "20", MATCH_SUBMISSION_LIMIT: "20" }),
      );
      await restoredCtx.ready;
      expect((await submit(restored, A, "extra", kind)).status).toBe(429);
      expect((await submit(restored, A, "last", kind)).status).toBe(200);
      expect(execute).toHaveBeenCalledOnce();
      expect((await ctx.storage.get("match")).submissions).toHaveLength(cap);
    },
  );

  it("retains three runs for legacy matches even when deployment defaults become smaller", async () => {
    const submissions = Array.from({ length: 2 }, (_, sequence) => ({
      id: `previous-${sequence}`,
      userId: A,
      kind: "run" as const,
      language: "javascript" as const,
      source: "function solve() {}",
      receivedAt: T0 - 900 + sequence,
      sequence,
      verdict: "wrong_answer" as const,
      completedAt: T0 - 500 + sequence,
    }));
    vi.mocked(execute).mockResolvedValue({
      verdict: "wrong_answer",
      message: "Wrong answer.",
    });
    const { room, ctx } = await newRoom(
      record({ submissions }),
      env({ MATCH_RUN_LIMIT: "1", MATCH_SUBMISSION_LIMIT: "1" }),
    );
    const last = await submit(room, A, "legacy-third", "run");
    expect(last.status).toBe(202);
    expect(await last.json()).toMatchObject({
      attemptLimits: { runs: 3, submits: 5 },
    });
    await idle(ctx);
    expect((await submit(room, A, "legacy-fourth", "run")).status).toBe(429);
  });
});

function codeboxEnv(overrides: Record<string, any> = {}) {
  return env({
    JUDGE_PROVIDER: "codebox",
    CODEBOX_AUTH_TOKEN: "c".repeat(64),
    CODEBOX: { fetch: vi.fn() },
    MAX_ACTIVE_MATCHES: "1",
    JUDGE_CONCURRENCY: "1",
    JUDGE_DAILY_QUOTA: "0",
    JUDGE_CREDIT_COST: "0",
    ...overrides,
  });
}
describe("durable Codebox execution", () => {
  beforeEach(() => {
    vi.mocked(createExecution).mockReset().mockResolvedValue("f".repeat(64));
    vi.mocked(pollExecution).mockReset().mockResolvedValue(null);
    vi.mocked(codeboxHealthy).mockReset().mockResolvedValue(true);
  });
  it("resumes a persisted token after eviction without creating a second job", async () => {
    const runtime = codeboxEnv();
    const { room, ctx } = await newRoom(record(), runtime);
    await submit(room, A, "first");
    await idle(ctx);
    expect(createExecution).toHaveBeenCalledOnce();
    expect((await ctx.storage.get("match")).submissions[0].executionToken).toBe(
      "f".repeat(64),
    );
    const restartedCtx = new MemoryContext(ctx.storage);
    const restarted = new MatchRoom(restartedCtx as any, runtime);
    await restartedCtx.ready;
    now += 2000;
    vi.mocked(pollExecution).mockResolvedValue(accepted as any);
    await restarted.alarm();
    await idle(restartedCtx);
    expect(createExecution).toHaveBeenCalledOnce();
    expect((await ctx.storage.get("match")).result.winnerId).toBe(A);
    const view = (await (
      await restarted.fetch(request("/view"))
    ).json()) as any;
    expect(view.submissions[0]).not.toHaveProperty("executionToken");
    expect(view.submissions[0]).not.toHaveProperty("source");
  });
  it("retries a lost POST response with the same key and original receipt time", async () => {
    vi.mocked(createExecution).mockRejectedValueOnce(
      new Error("Lost response"),
    );
    const { room, ctx, runtimeEnv } = await newRoom(record(), codeboxEnv());
    await submit(room, A, "lost-response");
    await idle(ctx);
    const first = vi.mocked(createExecution).mock.calls[0];
    const rebootCtx = new MemoryContext(ctx.storage);
    const reboot = new MatchRoom(rebootCtx as any, runtimeEnv);
    await rebootCtx.ready;
    now += 2000;
    await reboot.alarm();
    await idle(rebootCtx);
    expect(createExecution).toHaveBeenCalledTimes(2);
    const second = vi.mocked(createExecution).mock.calls[1];
    expect(second[3]).toBe(first[3]);
    expect(second[2].receivedAt).toBe(first[2].receivedAt);
    expect((await ctx.storage.get("match")).submissions).toHaveLength(1);
  });
  it("voids an uncertain execution at its original deadline without rerunning", async () => {
    vi.mocked(pollExecution).mockRejectedValue(new Error("Unavailable"));
    const { room, ctx } = await newRoom(record(), codeboxEnv());
    await submit(room, A, "deadline");
    await idle(ctx);
    now += 2000;
    await room.alarm();
    await idle(ctx);
    now = T0 + MAX_JUDGE_MS;
    await room.alarm();
    await idle(ctx);
    const saved = await ctx.storage.get("match");
    expect(saved.submissions[0].verdict).toBe("judge_error");
    expect(saved.result.reason).toBe("void");
    expect(createExecution).toHaveBeenCalledOnce();
  });
  it("does not let a later correct result or a bot overtake an earlier pending submission", async () => {
    vi.mocked(createExecution).mockImplementation(
      async (_env, _problem, s) => s.id,
    );
    const { room, ctx } = await newRoom(record(), codeboxEnv());
    await submit(room, A, "early");
    await idle(ctx);
    now += 1;
    await submit(room, B, "late");
    await idle(ctx);
    const saved = await ctx.storage.get("match");
    vi.mocked(pollExecution).mockImplementation(async (_env, token) =>
      token === saved.submissions[1].id ? (accepted as any) : null,
    );
    now += 2000;
    await room.alarm();
    await idle(ctx);
    expect((await ctx.storage.get("match")).result).toBeNull();
    vi.mocked(pollExecution).mockResolvedValue(accepted as any);
    now += 2000;
    await room.alarm();
    await idle(ctx);
    expect((await ctx.storage.get("match")).result.winnerId).toBe(A);
  });
});
describe("Codebox server admission", () => {
  beforeEach(() => {
    vi.mocked(codeboxHealthy).mockReset().mockResolvedValue(true);
  });
  it("admits two humans into one match with zero daily credits and holds capacity through settlement", async () => {
    const ctx = new MemoryContext();
    const runtime = codeboxEnv();
    const coordinator = new Coordinator(ctx as any, runtime);
    await ctx.ready;
    await coordinator.fetch(
      request("/join", { userId: A, requestId: "a", arena: "easy" }),
    );
    const match = (await (
      await coordinator.fetch(
        request("/join", { userId: B, requestId: "b", arena: "easy" }),
      )
    ).json()) as any;
    expect(match.status).toBe("matched");
    expect(
      await (
        await coordinator.fetch(
          request("/join", { userId: C, requestId: "c", arena: "easy" }),
        )
      ).json(),
    ).toMatchObject({ status: "capacity" });
    const lease = {
      matchId: match.matchId,
      userId: A,
      jobId: "stable",
      retry: false,
    };
    for (let i = 0; i < 2; i++)
      expect(
        await (await coordinator.fetch(request("/lease", lease))).json(),
      ).toEqual({ ok: true });
    expect(
      (await ctx.storage.get("state")).reservations[match.matchId].budgets[A]
        .base,
    ).toBe(7);
    expect(
      await (
        await coordinator.fetch(
          request("/lease", { ...lease, jobId: "another", userId: B }),
        )
      ).json(),
    ).toMatchObject({ ok: false, reason: "busy" });
    const restartCtx = new MemoryContext(ctx.storage);
    const restart = new Coordinator(restartCtx as any, runtime);
    await restartCtx.ready;
    expect(
      await (
        await restart.fetch(
          request("/join", { userId: C, requestId: "c", arena: "easy" }),
        )
      ).json(),
    ).toMatchObject({ status: "capacity" });
    await restart.fetch(request("/settled", { matchId: match.matchId }));
    // An uncertain execution retains its lease even after a resignation settles.
    expect(
      await (
        await restart.fetch(
          request("/join", { userId: C, requestId: "c", arena: "easy" }),
        )
      ).json(),
    ).toMatchObject({ status: "capacity" });
    await restart.fetch(request("/release-lease", { jobId: "stable" }));
    expect(
      await (
        await restart.fetch(
          request("/join", { userId: C, requestId: "c", arena: "easy" }),
        )
      ).json(),
    ).toMatchObject({ status: "waiting" });
    expect(creditSpent).not.toHaveBeenCalled();
  });
  it("stops bot assignment if the sandbox fails after the user joins", async () => {
    const ctx = new MemoryContext();
    const coordinator = new Coordinator(ctx as any, codeboxEnv());
    await ctx.ready;
    await coordinator.fetch(
      request("/join", { userId: A, requestId: "a", arena: "easy" }),
    );
    vi.mocked(codeboxHealthy).mockRejectedValue(new Error("Sandbox offline"));
    now += 15000;
    await coordinator.alarm();
    expect((await ctx.storage.get("state")).entries[A].status).toBe("waiting");
    expect(
      await (await coordinator.fetch(request("/status?userId=" + A))).json(),
    ).toMatchObject({
      status: "waiting",
      message: expect.stringContaining("server is unavailable"),
    });
    expect(
      (
        await coordinator.fetch(
          request("/join", { userId: B, requestId: "b", arena: "easy" }),
        )
      ).status,
    ).toBe(503);
  });
});
