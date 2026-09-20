import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() };
});
vi.mock("../worker/db", () => ({
  db: vi.fn(),
  getFriendIdentity: vi.fn(),
  getPlayer: vi.fn(),
  recentProblems: vi.fn(),
  settle: vi.fn(),
  findFriendByPublicId: vi.fn(),
  persistFriendChallenge: vi.fn(),
}));

import { jwtVerify } from "jose";
import worker from "../worker/index";
import type { Env } from "../worker/env";

const A = "11111111-1111-4111-8111-111111111111";
const challengeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let coordinatorFetch: ReturnType<typeof vi.fn>;

function runtime() {
  coordinatorFetch = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      forwarded: init?.body ? JSON.parse(String(init.body)) : true,
    }),
  );
  return {
    SUPABASE_URL: "https://offline.invalid",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
    SUPABASE_SECRET_KEY: "sb_secret_backend_private",
    WEBSOCKET_SIGNING_SECRET: "independent-offline-socket-signing-secret",
    LIVE_MATCHES_ENABLED: "true",
    ADMISSION_MODE: "public",
    JUDGE_PROVIDER: "jdoodle",
    JDOODLE_CLIENT_ID: "judge-id",
    JDOODLE_CLIENT_SECRET: "judge-secret",
    JUDGE_DAILY_QUOTA: "200",
    JUDGE_CREDIT_COST: "1",
    JUDGE_CONCURRENCY: "1",
    JUDGE_RESET_HOUR_UTC: "0",
    JUDGE_VERIFIED_AT: "2026-09-20T00:00:00Z",
    ALLOWED_ORIGINS: "",
    COORDINATOR: {
      idFromName: () => "global",
      get: () => ({ fetch: coordinatorFetch }),
    },
  } as unknown as Env;
}
function request(path: string, init: RequestInit = {}) {
  return new Request("https://dalgo.invalid/api" + path, {
    ...init,
    headers: { Authorization: "Bearer user-jwt", ...init.headers },
  });
}

beforeEach(() => {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: A },
    protectedHeader: { alg: "ES256" },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("friend challenge API boundary", () => {
  it("requires authentication before challenge state is read", async () => {
    const env = runtime();
    const response = await worker.fetch(
      new Request("https://dalgo.invalid/api/challenges"),
      env,
    );
    expect(response.status).toBe(401);
    expect(coordinatorFetch).not.toHaveBeenCalled();
  });

  it("normalizes the public ID and forwards only the authenticated user ID", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/challenges", {
        method: "POST",
        body: JSON.stringify({
          userId: "attacker-selected-id",
          friendId: "  dlg-abcd-1234-ef56-7890  ",
          arena: "easy",
          requestId: challengeId,
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const [, init] = coordinatorFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      userId: A,
      friendPublicId: "DLG-ABCD-1234-EF56-7890",
      arena: "easy",
      requestId: challengeId,
    });
  });

  it("rejects malformed player IDs before reaching durable state", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/challenges", {
        method: "POST",
        body: JSON.stringify({
          friendId: "not-a-player-id",
          arena: "easy",
          requestId: challengeId,
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(coordinatorFetch).not.toHaveBeenCalled();
  });

  it("maps accept, decline, and cancel to server-controlled actions", async () => {
    const env = runtime();
    for (const [suffix, method, action] of [
      ["/accept", "POST", "accept"],
      ["/decline", "POST", "decline"],
      ["", "DELETE", "cancel"],
    ] as const) {
      coordinatorFetch.mockClear();
      const response = await worker.fetch(
        request(`/challenges/${challengeId}${suffix}`, { method }),
        env,
      );
      expect(response.status).toBe(200);
      const [, init] = coordinatorFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        userId: A,
        challengeId,
        action,
      });
    }
  });
});
