import { describe, expect, it } from "vitest";
import {
  admissionStatus,
  AdmissionRateLimitError,
  recordAdmission,
} from "../worker/admission";
import {
  admissionMode,
  launchReady,
  testerUserIds,
  type Env,
} from "../worker/env";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const configured = {
  LIVE_MATCHES_ENABLED: "true",
  ADMISSION_MODE: "public",
  SUPABASE_URL: "https://offline.invalid",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  WEBSOCKET_SIGNING_SECRET: "offline-test-websocket-signing-secret",
  JUDGE_PROVIDER: "jdoodle",
  JDOODLE_CLIENT_ID: "test",
  JDOODLE_CLIENT_SECRET: "test",
  JUDGE_DAILY_QUOTA: "200",
  JUDGE_CREDIT_COST: "1",
  JUDGE_CONCURRENCY: "1",
  JUDGE_RESET_HOUR_UTC: "0",
  JUDGE_VERIFIED_AT: "2026-09-11T00:00:00Z",
} as Env;

describe("staging and public admission", () => {
  it("fails closed for unknown modes even with complete execution configuration", () => {
    for (const mode of [
      undefined,
      "",
      "PUBLIC",
      "preview",
      "true",
      "disabled",
    ]) {
      const env = { ...configured, ADMISSION_MODE: mode } as Env;
      expect(admissionMode(env)).toBe("disabled");
      expect(launchReady(env)).toBe(false);
      expect(admissionStatus(env, A).canJoin).toBe(false);
    }
  });

  it("requires a valid, server-configured tester UUID and verified execution settings", () => {
    const env = {
      ...configured,
      ADMISSION_MODE: "staging",
      TESTER_USER_IDS: ` ${A}, ${B},${A}`,
    };
    expect(testerUserIds(env)).toEqual(new Set([A, B]));
    expect(admissionStatus(env, A)).toEqual({
      mode: "staging",
      canJoin: true,
      reason: "",
    });
    expect(admissionStatus(env).canJoin).toBe(false);
    expect(
      admissionStatus(env, "33333333-3333-4333-8333-333333333333").canJoin,
    ).toBe(false);
    for (const ids of ["", "tester@example.com", `${A},invalid`, `${A},*`]) {
      expect(launchReady({ ...env, TESTER_USER_IDS: ids })).toBe(false);
      expect(admissionStatus({ ...env, TESTER_USER_IDS: ids }, A).canJoin).toBe(
        false,
      );
    }
    for (const overrides of [
      { LIVE_MATCHES_ENABLED: "false" },
      { JUDGE_VERIFIED_AT: "" },
      { JUDGE_DAILY_QUOTA: "0" },
      { WEBSOCKET_SIGNING_SECRET: "short" },
    ])
      expect(admissionStatus({ ...env, ...overrides }, A).canJoin).toBe(false);
  });

  it("allows signed-in public accounts but never exposes the allowlist", () => {
    expect(admissionStatus(configured, A)).toEqual({
      mode: "public",
      canJoin: true,
      reason: "",
    });
    expect(admissionStatus(configured).canJoin).toBe(false);
    expect(
      JSON.stringify(admissionStatus({ ...configured, TESTER_USER_IDS: A }, B)),
    ).not.toContain(A);
  });

  it("requires independent socket signing material with modern Supabase keys", () => {
    expect(launchReady(configured)).toBe(true);
    expect(launchReady({ ...configured, WEBSOCKET_SIGNING_SECRET: "" })).toBe(
      false,
    );
    expect(
      launchReady({
        ...configured,
        SUPABASE_SECRET_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      }),
    ).toBe(false);
  });
});

describe("new-search rolling windows", () => {
  it("limits bursts and permits a request exactly when the oldest timestamp expires", () => {
    const now = 100_000;
    let times: number[] = [];
    for (let i = 0; i < 6; i++) times = recordAdmission(times, now + i * 1000);
    try {
      recordAdmission(times, now + 5500);
      throw new Error("Expected a limit");
    } catch (error) {
      expect(error).toBeInstanceOf(AdmissionRateLimitError);
      expect((error as AdmissionRateLimitError).retryAfter).toBe(55);
    }
    expect(recordAdmission(times, now + 60_000)).toHaveLength(7);
  });

  it("enforces the hour window after minute bursts recover", () => {
    const times = Array.from(
      { length: 30 },
      (_, i) => 100_000 + Math.floor(i / 6) * 60_000,
    );
    expect(() => recordAdmission(times, 400_000)).toThrow(
      AdmissionRateLimitError,
    );
    expect(recordAdmission(times, 3_700_000)).toHaveLength(25);
  });
});
