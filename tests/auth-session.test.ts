import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  AUTH_CONFIG_STORAGE_KEY,
  cacheAuthConfig,
  createSessionCoordinator,
  readCachedAuthConfig,
  retry,
} from "../src/auth-session";

function session(accessToken: string, expiresAt: number) {
  return {
    access_token: accessToken,
    refresh_token: "refresh",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: { id: "user" },
  } as Session;
}

describe("persistent auth sessions", () => {
  it("serializes concurrent recovery so one refresh token is used once", async () => {
    let resolve!: (value: {
      data: { session: Session | null };
      error: null;
    }) => void;
    const getSession = vi.fn(
      () =>
        new Promise<{ data: { session: Session | null }; error: null }>(
          (done) => {
            resolve = done;
          },
        ),
    );
    const coordinator = createSessionCoordinator(
      { auth: { getSession } } as never,
      { sleep: async () => {} },
    );

    const first = coordinator.accessToken();
    const second = coordinator.accessToken();
    expect(getSession).toHaveBeenCalledTimes(1);
    resolve({ data: { session: session("fresh", 2_000) }, error: null });
    await expect(Promise.all([first, second])).resolves.toEqual([
      "fresh",
      "fresh",
    ]);
  });

  it("uses a healthy in-memory token without repeatedly reading the session", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: session("current", 2_000) },
      error: null,
    });
    const coordinator = createSessionCoordinator(
      { auth: { getSession } } as never,
      { now: () => 1_000_000, sleep: async () => {} },
    );

    await coordinator.restore();
    await expect(coordinator.accessToken()).resolves.toBe("current");
    await expect(coordinator.accessToken()).resolves.toBe("current");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("retries a temporary startup failure", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("ready");
    await expect(retry(operation, [0, 1], async () => {})).resolves.toBe(
      "ready",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("caches only the public auth configuration needed after a reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    cacheAuthConfig(storage, {
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_public",
      googleClientId: "google-client.apps.googleusercontent.com",
      admissionMode: "public",
      playEnabled: true,
      reason: "",
      attemptLimits: { runs: 3, submits: 5 },
      executionCapacity: { activeMatches: 1, concurrentExecutions: 1 },
      dailyCapacity: null,
    });

    expect(JSON.parse(values.get(AUTH_CONFIG_STORAGE_KEY)!)).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_public",
      googleClientId: "google-client.apps.googleusercontent.com",
    });
    expect(readCachedAuthConfig(storage)).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_public",
      googleClientId: "google-client.apps.googleusercontent.com",
    });
  });
});
