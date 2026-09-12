import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() };
});
vi.mock("../worker/db", () => ({
  db: vi.fn(),
  getPlayer: vi.fn(),
  recentProblems: vi.fn(),
  settle: vi.fn(),
}));
import { jwtVerify } from "jose";
import worker from "../worker/index";
import type { Env } from "../worker/env";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const env = {
  LIVE_MATCHES_ENABLED: "true",
  ADMISSION_MODE: "staging",
  TESTER_USER_IDS: A,
  SUPABASE_URL: "https://offline.invalid",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
  SUPABASE_SECRET_KEY: "sb_secret_backend_private",
  WEBSOCKET_SIGNING_SECRET: "independent-offline-socket-signing-secret",
  JDOODLE_CLIENT_ID: "judge-id-private",
  JDOODLE_CLIENT_SECRET: "judge-secret-private",
  JUDGE_DAILY_QUOTA: "200",
  JUDGE_CREDIT_COST: "1",
  JUDGE_CONCURRENCY: "1",
  JUDGE_RESET_HOUR_UTC: "0",
  JUDGE_VERIFIED_AT: "2026-09-11T00:00:00Z",
  ALLOWED_ORIGINS: "https://frontend.invalid",
} as Env;
function request(path: string, options: RequestInit = {}) {
  return new Request("https://dalgo.invalid/api" + path, {
    ...options,
    headers: { Authorization: "Bearer user-jwt", ...options.headers },
  });
}
beforeEach(() => {
  vi.mocked(jwtVerify).mockReset();
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: A },
    protectedHeader: { alg: "ES256" },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected remote call");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("admission API boundary", () => {
  it("returns eligibility for the authenticated UUID without exposing testers or secrets", async () => {
    const response = await worker.fetch(request("/admission"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "staging",
      canJoin: true,
      reason: "",
    });
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { sub: B, user_metadata: { tester: true } },
      protectedHeader: { alg: "ES256" },
    });
    const denied = await worker.fetch(request("/admission"), env);
    expect(await denied.json()).toMatchObject({
      mode: "staging",
      canJoin: false,
    });
    expect(
      (
        await worker.fetch(
          new Request("https://dalgo.invalid/api/admission"),
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("publishes only the browser key and admission mode in config", async () => {
    const response = await worker.fetch(
      new Request("https://dalgo.invalid/api/config"),
      env,
    );
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      supabaseKey: env.SUPABASE_PUBLISHABLE_KEY,
      admissionMode: "staging",
    });
    for (const secret of [
      A,
      env.SUPABASE_SECRET_KEY,
      env.WEBSOCKET_SIGNING_SECRET,
      env.JDOODLE_CLIENT_ID,
      env.JDOODLE_CLIENT_SECRET,
    ])
      expect(text).not.toContain(secret);
  });

  it("issues independently signed socket tickets even while new admissions are paused", async () => {
    const response = await worker.fetch(
      request("/socket-ticket", {
        method: "POST",
        body: JSON.stringify({ path: "/queue/events" }),
      }),
      { ...env, ADMISSION_MODE: "disabled" },
    );
    expect(response.status).toBe(200);
    const { ticket } = (await response.json()) as { ticket: string };
    const actual = await vi.importActual<typeof import("jose")>("jose");
    const verified = await actual.jwtVerify(
      ticket,
      new TextEncoder().encode(env.WEBSOCKET_SIGNING_SECRET),
      { issuer: "dalgo", audience: "dalgo-websocket" },
    );
    expect(verified.payload).toMatchObject({ sub: A, path: "/queue/events" });
    await expect(
      actual.jwtVerify(
        ticket,
        new TextEncoder().encode(env.SUPABASE_SECRET_KEY),
      ),
    ).rejects.toThrow();
  });

  it("uses the publishable key for the legacy-JWT Auth fallback", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(
      new Error("No matching asymmetric key"),
    );
    const fetch = vi.fn(async () => Response.json({ id: A }));
    vi.stubGlobal("fetch", fetch);
    expect((await worker.fetch(request("/admission"), env)).status).toBe(200);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://offline.invalid/auth/v1/user");
    expect(new Headers(options.headers).get("apikey")).toBe(
      "sb_publishable_public",
    );
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer user-jwt",
    );
  });
});
