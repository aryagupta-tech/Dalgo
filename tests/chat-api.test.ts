import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("jose", async (original) => ({
  ...(await original<typeof import("jose")>()),
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));
vi.mock("../worker/db", () => ({
  db: vi.fn(),
  getFriendChat: vi.fn(),
  sendFriendMessage: vi.fn(),
  removeFriendship: vi.fn(),
}));
import { jwtVerify } from "jose";
import {
  getFriendChat,
  sendFriendMessage,
  removeFriendship,
} from "../worker/db";
import worker from "../worker/index";
import type { Env } from "../worker/env";
const A = "11111111-1111-4111-8111-111111111111";
const friendId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const matchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function runtime() {
  const matchFetch = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      user: new Headers(init?.headers).get("X-Dalgo-User"),
      body: JSON.parse(String(init?.body)),
    }),
  );
  return {
    env: {
      SUPABASE_URL: "https://offline.invalid",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      WEBSOCKET_SIGNING_SECRET: "a-long-independent-websocket-signing-secret",
      MATCHES: {
        idFromName: () => "match",
        get: () => ({ fetch: matchFetch }),
      },
    } as unknown as Env,
    matchFetch,
  };
}
function request(path: string, init: RequestInit = {}) {
  return new Request("https://dalgo.invalid/api" + path, {
    ...init,
    headers: { Authorization: "Bearer test", ...init.headers },
  });
}
beforeEach(() => {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: A },
    protectedHeader: { alg: "ES256" },
  });
  vi.mocked(getFriendChat).mockReset();
  vi.mocked(sendFriendMessage).mockReset();
  vi.mocked(removeFriendship).mockReset();
  vi.mocked(getFriendChat).mockResolvedValue({
    friendshipId: friendId,
    messages: [],
  });
  vi.mocked(sendFriendMessage).mockResolvedValue({
    id: messageId,
    senderId: A,
    text: "Hello",
    sentAt: 1,
  });
  vi.mocked(removeFriendship).mockResolvedValue();
});
describe("chat API authentication boundary", () => {
  it("requires sign-in for friend messages", async () => {
    const { env } = runtime();
    const response = await worker.fetch(
      new Request(`https://dalgo.invalid/api/friends/${friendId}/messages`),
      env,
    );
    expect(response.status).toBe(401);
    expect(getFriendChat).not.toHaveBeenCalled();
  });
  it("uses the verified user for friend reads and sends", async () => {
    const { env } = runtime();
    expect(
      (await worker.fetch(request(`/friends/${friendId}/messages`), env))
        .status,
    ).toBe(200);
    expect(getFriendChat).toHaveBeenCalledWith(env, A, friendId);
    const sent = await worker.fetch(
      request(`/friends/${friendId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          userId: "forged",
          requestId: messageId,
          text: "Hello",
        }),
      }),
      env,
    );
    expect(sent.status).toBe(201);
    expect(sendFriendMessage).toHaveBeenCalledWith(
      env,
      A,
      friendId,
      messageId,
      "Hello",
    );
  });
  it("rejects malformed messages before storage", async () => {
    const { env } = runtime();
    for (const text of ["", "bad\nline", "x".repeat(501)]) {
      const response = await worker.fetch(
        request(`/friends/${friendId}/messages`, {
          method: "POST",
          body: JSON.stringify({ requestId: crypto.randomUUID(), text }),
        }),
        env,
      );
      expect(response.status).toBe(400);
    }
    expect(sendFriendMessage).not.toHaveBeenCalled();
  });
  it("derives match chat sender from the verified session", async () => {
    const { env, matchFetch } = runtime();
    const response = await worker.fetch(
      request(`/matches/${matchId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          userId: "forged",
          requestId: messageId,
          text: "Hello",
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(matchFetch).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ user: A });
  });
  it("removes only the authenticated user's friendship", async () => {
    const { env } = runtime();
    expect(
      (
        await worker.fetch(
          request(`/friends/${friendId}`, { method: "DELETE" }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(removeFriendship).toHaveBeenCalledWith(env, A, friendId);
  });
});
