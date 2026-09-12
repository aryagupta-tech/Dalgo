import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../worker/db";
import type { Env } from "../worker/env";

afterEach(() => vi.unstubAllGlobals());

describe("Supabase API key compatibility", () => {
  it("sends a modern backend key through apikey without a non-JWT Bearer token", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    await db(
      {
        SUPABASE_URL: "https://offline.invalid/",
        SUPABASE_SECRET_KEY: "sb_secret_private",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
      } as Env,
      "profiles?select=id",
    );
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://offline.invalid/rest/v1/profiles?select=id");
    const headers = new Headers(options.headers);
    expect(headers.get("apikey")).toBe("sb_secret_private");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("preserves the legacy JWT backend key path", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    await db(
      {
        SUPABASE_URL: "https://offline.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-service-jwt",
      } as Env,
      "profiles?select=id",
    );
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(options.headers);
    expect(headers.get("apikey")).toBe("legacy-service-jwt");
    expect(headers.get("Authorization")).toBe("Bearer legacy-service-jwt");
  });

  it("makes no remote request when the privileged runtime key is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      db({ SUPABASE_URL: "https://offline.invalid" } as Env, "profiles"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
