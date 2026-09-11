import { afterEach, expect, it, vi } from "vitest";
import { settle } from "../worker/db";
import type { Env } from "../worker/env";
import type { MatchRecord } from "../worker/core";

afterEach(() => vi.unstubAllGlobals());
it("records resignation when received, even if the winning bot was scheduled much later", async () => {
  const fetcher = vi.fn(async () => Response.json({ rating_changes: [] }));
  vi.stubGlobal("fetch", fetcher);
  const m = {
    id: "match",
    arena: "easy",
    mode: "bot",
    problemId: "problem",
    problemVersion: 1,
    startsAt: 1000,
    endsAt: 601000,
    terminalAt: 4000,
    bot: { completesAt: 500000 },
    players: [
      { id: "user", rating: 1200 },
      { id: "bot", rating: 1200, isBot: true },
    ],
    submissions: [],
    result: { winnerId: "bot", reason: "resigned", deltas: {}, settled: false },
  } as unknown as MatchRecord;
  await settle(
    {
      SUPABASE_URL: "https://offline.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "test",
    } as Env,
    m,
  );
  const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init[1].body as string).p_match.ended_at).toBe(
    new Date(4000).toISOString(),
  );
});
