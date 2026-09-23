import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicPlayerResponse } from "../worker/public-players";
import type { Env } from "../worker/env";
import { db } from "../worker/db";
import worker from "../worker/index";

vi.mock("../worker/db", () => ({ db: vi.fn() }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const env = {
  SUPABASE_URL: "https://db.invalid",
  SUPABASE_SECRET_KEY: "sb_secret_private",
} as Env;

beforeEach(() => {
  vi.mocked(db).mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "Content-Range": "0-0/1" },
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("public player data", () => {
  it("allows signed-out public profile reads without opening private routes", async () => {
    vi.mocked(db).mockImplementation(async (_env, path) =>
      path.startsWith("profiles?")
        ? ([
            {
              id: A,
              username: "arya",
              username_configured_at: "2026-01-01",
              display_name: "Arya",
              avatar_url: null,
            },
          ] as never)
        : ([] as never),
    );
    const response = await worker.fetch(
      new Request(`https://dalgo.site/api/players/${A}`),
      env,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.player.username).toBe("arya");
    const privateResponse = await worker.fetch(
      new Request("https://dalgo.site/api/profile"),
      env,
    );
    expect(privateResponse.status).toBe(401);
  });
  it("returns six separate rankings and only whitelisted identity fields", async () => {
    vi.mocked(db).mockImplementation(async (_env, path) => {
      if (path.startsWith("profiles"))
        return [
          {
            id: A,
            username: "arya",
            username_configured_at: "2026-01-01",
            display_name: "Arya",
            avatar_url: "https://cdn.invalid/a.webp",
            email: "do-not-expose@example.invalid",
          },
        ] as never;
      return [
        {
          arena: "easy",
          mode: "human",
          rating: 800,
          matches: 1,
          wins: 1,
          losses: 0,
          draws: 0,
        },
        {
          arena: "easy",
          mode: "bot",
          rating: 800,
          matches: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        },
      ] as never;
    });
    const response = await publicPlayerResponse(
      `/players/${A}`,
      new URL(`https://dalgo.site/api/players/${A}`),
      env,
    );
    expect(response?.status).toBe(200);
    const data = (await response!.json()) as any;
    expect(data.player).toEqual({
      id: A,
      username: "arya",
      name: "Arya",
      avatar: "https://cdn.invalid/a.webp",
    });
    expect(JSON.stringify(data)).not.toContain("do-not-expose");
    expect(data.ratings[0].rank).toBe(2);
    expect(data.ratings[1].rank).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const countUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(countUrl).toContain("matches=gt.0");
  });

  it("paginates settled match summaries and omits private match data", async () => {
    const old = "2026-09-01T10:00:00+00:00";
    vi.mocked(db).mockImplementation(async (_env, path) => {
      if (path.startsWith("profiles?id=eq.")) return [{ id: A }] as never;
      if (path.startsWith("matches?"))
        return [
          {
            id: M,
            arena: "medium",
            mode: "human",
            ended_at: old,
            result: { winner_id: A, reason: "solved", hidden: "do-not-expose" },
          },
        ] as never;
      if (path.startsWith("participants?"))
        return [
          { match_id: M, user_id: A },
          { match_id: M, user_id: B },
        ] as never;
      if (path.startsWith("rating_ledger?"))
        return [{ match_id: M, user_id: A, delta: 18 }] as never;
      if (path.startsWith("profiles?id=in."))
        return [
          {
            id: B,
            username: "rival",
            username_configured_at: "2026-01-01",
            display_name: "Rival",
            avatar_url: null,
          },
        ] as never;
      return [] as never;
    });
    const url = new URL(
      `https://dalgo.site/api/players/${A}/matches?cursor=${encodeURIComponent(`${old}|${M}`)}`,
    );
    const response = await publicPlayerResponse(
      `/players/${A}/matches`,
      url,
      env,
    );
    expect(response?.status).toBe(200);
    const data = (await response!.json()) as any;
    expect(data.matches).toEqual([
      {
        id: M,
        arena: "medium",
        mode: "human",
        endedAt: old,
        outcome: "win",
        ratingDelta: 18,
        opponent: { id: B, username: "rival", name: "Rival" },
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("hidden");
    expect(
      vi
        .mocked(db)
        .mock.calls.find(([, p]) => String(p).startsWith("matches?"))?.[1],
    ).toContain("ended_at.lt.");
  });

  it("rejects malformed player ids and cursors", async () => {
    await expect(
      publicPlayerResponse(
        "/players/not-an-id",
        new URL("https://dalgo.site/api/players/not-an-id"),
        env,
      ),
    ).rejects.toMatchObject({ status: 404 });
    vi.mocked(db).mockResolvedValue([{ id: A }] as never);
    await expect(
      publicPlayerResponse(
        `/players/${A}/matches`,
        new URL(`https://dalgo.site/api/players/${A}/matches?cursor=bad`),
        env,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
