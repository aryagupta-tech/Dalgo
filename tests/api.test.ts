import { afterEach, describe, expect, it, vi } from "vitest";
import { api, publicApi, setTokenGetter } from "../src/api";

afterEach(() => {
  setTokenGetter(async () => null);
  vi.unstubAllGlobals();
});

describe("public API reads", () => {
  it("loads public rankings without waiting for an unavailable auth session", async () => {
    const token = vi.fn(async () => {
      throw new Error("Session refresh unavailable");
    });
    setTokenGetter(token);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([{ rating: 850 }]),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await publicApi("/leaderboard?arena=easy&mode=human")).toEqual([
      { rating: 850 },
    ]);
    expect(token).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("keeps protected requests authenticated", async () => {
    setTokenGetter(async () => "session-token");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ canJoin: true }),
    );
    vi.stubGlobal("fetch", fetch);
    await api("/admission");
    expect(fetch.mock.calls[0][1]?.headers).toHaveProperty(
      "Authorization",
      "Bearer session-token",
    );
  });
});
