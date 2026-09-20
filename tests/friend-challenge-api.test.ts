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
  findFriendByUsername: vi.fn(),
  claimUsername: vi.fn(),
  createFriendRequest: vi.fn(),
  getFriendsView: vi.fn(),
  respondFriendRequest: vi.fn(),
  persistFriendChallenge: vi.fn(),
}));

import { jwtVerify } from "jose";
import {
  claimUsername,
  createFriendRequest,
  db,
  getFriendsView,
  respondFriendRequest,
} from "../worker/db";
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
  vi.mocked(claimUsername).mockReset();
  vi.mocked(createFriendRequest).mockReset();
  vi.mocked(getFriendsView).mockReset();
  vi.mocked(respondFriendRequest).mockReset();
  vi.mocked(db).mockReset();
  vi.mocked(claimUsername).mockResolvedValue({
    id: A,
    username: "chosen_name",
    usernameConfigured: true,
    name: "Chosen name",
  });
  vi.mocked(getFriendsView).mockResolvedValue({
    friends: [],
    incoming: [],
    outgoing: [],
  });
  vi.mocked(createFriendRequest).mockResolvedValue({
    id: challengeId,
    status: "pending",
    sender: { id: A, username: "me", usernameConfigured: true, name: "Me" },
    receiver: {
      id: "22222222-2222-4222-8222-222222222222",
      username: "friend_name",
      usernameConfigured: true,
      name: "Friend",
    },
    createdAt: Date.now(),
  });
  vi.mocked(respondFriendRequest).mockResolvedValue({
    id: challengeId,
    status: "accepted",
    sender: { id: A, username: "me", usernameConfigured: true, name: "Me" },
    receiver: {
      id: "22222222-2222-4222-8222-222222222222",
      username: "friend_name",
      usernameConfigured: true,
      name: "Friend",
    },
    createdAt: Date.now(),
    respondedAt: Date.now(),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("friend challenge API boundary", () => {
  it("claims a normalized username only for the authenticated account", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/profile/username", {
        method: "PUT",
        body: JSON.stringify({
          userId: "attacker-selected-id",
          username: "  Chosen_Name  ",
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(claimUsername).toHaveBeenCalledWith(env, A, "chosen_name");
    expect(await response.json()).toMatchObject({
      id: A,
      username: "chosen_name",
      usernameConfigured: true,
    });
  });

  it("rejects malformed usernames before the database claim", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/profile/username", {
        method: "PUT",
        body: JSON.stringify({ username: "_bad name" }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(claimUsername).not.toHaveBeenCalled();
  });

  it("requires authentication before challenge state is read", async () => {
    const env = runtime();
    const response = await worker.fetch(
      new Request("https://dalgo.invalid/api/challenges"),
      env,
    );
    expect(response.status).toBe(401);
    expect(coordinatorFetch).not.toHaveBeenCalled();
  });

  it("normalizes the username and forwards only the authenticated user ID", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/challenges", {
        method: "POST",
        body: JSON.stringify({
          userId: "attacker-selected-id",
          username: "  Friend_Name  ",
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
      friendUsername: "friend_name",
      arena: "easy",
      requestId: challengeId,
    });
  });

  it("rejects malformed usernames before reaching durable state", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/challenges", {
        method: "POST",
        body: JSON.stringify({
          username: "not a username!",
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
  it("keeps the friend graph behind authenticated server routes", async () => {
    const env = runtime();
    const unauthenticated = await worker.fetch(
      new Request("https://dalgo.invalid/api/friends"),
      env,
    );
    expect(unauthenticated.status).toBe(401);
    expect(getFriendsView).not.toHaveBeenCalled();

    const response = await worker.fetch(request("/friends"), env);
    expect(response.status).toBe(200);
    expect(getFriendsView).toHaveBeenCalledWith(env, A);
  });

  it("creates friend requests for the authenticated user and normalized target", async () => {
    const env = runtime();
    const response = await worker.fetch(
      request("/friends/requests", {
        method: "POST",
        body: JSON.stringify({
          userId: "attacker-selected-id",
          username: "  Friend_Name  ",
          requestId: challengeId,
        }),
      }),
      env,
    );
    expect(response.status).toBe(201);
    expect(createFriendRequest).toHaveBeenCalledWith(
      env,
      A,
      "friend_name",
      challengeId,
    );
  });

  it("binds friend-request responses to the authenticated user", async () => {
    const env = runtime();
    for (const [suffix, method, action] of [
      ["/accept", "POST", "accept"],
      ["/decline", "POST", "decline"],
      ["", "DELETE", "cancel"],
    ] as const) {
      vi.mocked(respondFriendRequest).mockClear();
      const response = await worker.fetch(
        request(`/friends/requests/${challengeId}${suffix}`, { method }),
        env,
      );
      expect(response.status).toBe(200);
      expect(respondFriendRequest).toHaveBeenCalledWith(
        env,
        A,
        challengeId,
        action,
      );
    }
  });

  it("returns only the prior human opponent needed for a rematch", async () => {
    const env = runtime();
    const matchId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const opponentId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(db)
      .mockResolvedValueOnce([
        {
          id: matchId,
          arena: "medium",
          mode: "human",
          started_at: "2026-09-20T00:00:00Z",
          ended_at: "2026-09-20T00:10:00Z",
          result: { winner_id: A, reason: "solved" },
          rating_ledger: [
            { user_id: A, delta: 16 },
            { user_id: opponentId, delta: -16 },
          ],
        },
      ])
      .mockResolvedValueOnce([
        { match_id: matchId, user_id: A },
        { match_id: matchId, user_id: opponentId },
      ])
      .mockResolvedValueOnce([
        {
          id: opponentId,
          username: "friend_name",
          username_configured_at: "2026-09-20T00:00:00Z",
          display_name: "Friend",
          avatar_url: null,
        },
      ]);
    const response = await worker.fetch(request("/history"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: matchId,
        opponent: expect.objectContaining({
          id: opponentId,
          username: "friend_name",
        }),
      }),
    ]);
  });
});

function validAvatarWebp() {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8 "), 12);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  new DataView(bytes.buffer).setUint16(26, 512, true);
  new DataView(bytes.buffer).setUint16(28, 512, true);
  return bytes;
}

describe("profile avatar API boundary", () => {
  it("requires authentication and a canonical WebP upload", async () => {
    const env = runtime();
    const unauthenticated = await worker.fetch(
      new Request("https://dalgo.invalid/api/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: validAvatarWebp(),
      }),
      env,
    );
    expect(unauthenticated.status).toBe(401);

    const invalid = await worker.fetch(
      request("/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: validAvatarWebp(),
      }),
      env,
    );
    expect(invalid.status).toBe(415);
    expect(db).not.toHaveBeenCalled();
  });

  it("derives the avatar owner only from the verified session", async () => {
    const env = runtime();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.mocked(db).mockResolvedValueOnce([
      {
        previous_storage_path: null,
        profile_id: A,
        display_name: "Chosen name",
        username: "chosen_name",
        username_configured_at: "2026-09-20T00:00:00Z",
        avatar_url: "https://offline.invalid/storage/avatar.webp",
      },
    ]);

    const response = await worker.fetch(
      request("/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: validAvatarWebp(),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const rpcBody = JSON.parse(String(vi.mocked(db).mock.calls[0][2]?.body));
    expect(rpcBody.p_user_id).toBe(A);
    expect(rpcBody.p_storage_path).toMatch(new RegExp("^" + A + "/"));
  });

  it("advertises PUT for cross-origin profile updates", async () => {
    const response = await worker.fetch(
      new Request("https://dalgo.invalid/api/profile/avatar", {
        method: "OPTIONS",
        headers: { Origin: "https://dalgo.invalid" },
      }),
      runtime(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    );
  });
});
