import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone Node setup script has no generated declarations.
import { evaluateSetup } from "../scripts/check-setup.mjs";
const valid = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-public",
  SUPABASE_SECRET_KEY: "sb_secret_test-private",
  WEBSOCKET_SIGNING_SECRET: "test-independent-signing-secret-32-bytes",
  JUDGE_PROVIDER: "jdoodle",
  JDOODLE_CLIENT_ID: "test-client-id",
  JDOODLE_CLIENT_SECRET: "test-client-secret",
  JUDGE_DAILY_QUOTA: "100",
  JUDGE_CREDIT_COST: "1",
  JUDGE_CONCURRENCY: "1",
  JUDGE_RESET_HOUR_UTC: "0",
  JUDGE_VERIFIED_AT: "2026-09-12T00:00:00Z",
  TESTER_USER_IDS:
    "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222",
  ADMISSION_MODE: "staging",
  LIVE_MATCHES_ENABLED: "false",
};
const now = Date.parse("2026-09-12T01:00:00Z");
const check = (env: Record<string, string>, id: string) =>
  evaluateSetup(env, now).checks.find((item: { id: string }) => item.id === id)
    .status;
describe("local setup preflight", () => {
  it("never labels configuration as verified public launch or enables play", () => {
    const report = evaluateSetup(valid, now);
    expect(report.configurationComplete).toBe(true);
    expect(report.publicLaunchVerified).toBe(false);
    expect(report.livePlayRequested).toBe(false);
    expect(valid.LIVE_MATCHES_ENABLED).toBe("false");
  });
  it("reports missing configuration without crashing", () => {
    expect(evaluateSetup({}, now).configurationComplete).toBe(false);
    expect(check({}, "codebox_credentials")).toBe("needs_setup");
  });
  it("flags free quotas that cannot support the reserved cost of two humans", () => {
    const report = evaluateSetup({ ...valid, JUDGE_DAILY_QUOTA: "20" }, now);
    expect(report.capacity).toEqual({
      admissionCredits: 16,
      creditsPerHuman: 10,
      botMatchReservation: 10,
      humanMatchReservation: 20,
    });
    expect(report.configurationComplete).toBe(false);
    expect(
      check({ ...valid, JUDGE_DAILY_QUOTA: "20" }, "human_match_capacity"),
    ).toBe("needs_setup");
  });
  it("does not leak secrets in successful or failing reports", () => {
    for (const env of [
      valid,
      { ...valid, VITE_SECRET: valid.SUPABASE_SECRET_KEY },
    ]) {
      const result = JSON.stringify(evaluateSetup(env, now));
      for (const key of [
        "SUPABASE_SECRET_KEY",
        "JDOODLE_CLIENT_ID",
        "JDOODLE_CLIENT_SECRET",
        "WEBSOCKET_SIGNING_SECRET",
      ] as const)
        expect(result).not.toContain(valid[key]);
    }
  });
  it("detects private credential exposure through frontend variables", () => {
    expect(
      check(
        { ...valid, VITE_SUPABASE_KEY: valid.SUPABASE_SECRET_KEY },
        "frontend_secret_boundary",
      ),
    ).toBe("needs_setup");
    expect(
      check(
        {
          ...valid,
          VITE_API_BASE: `https://example.invalid/?key=${valid.JDOODLE_CLIENT_SECRET}`,
        },
        "frontend_secret_boundary",
      ),
    ).toBe("needs_setup");
  });
  it("rejects invalid quota, future evidence and duplicate tester identities", () => {
    expect(check({ ...valid, JUDGE_CONCURRENCY: "0" }, "judge_allowance")).toBe(
      "needs_setup",
    );
    expect(
      check({ ...valid, JUDGE_VERIFIED_AT: "2099-01-01" }, "judge_evidence"),
    ).toBe("needs_setup");
    expect(
      check(
        {
          ...valid,
          TESTER_USER_IDS: Array(2)
            .fill("11111111-1111-4111-8111-111111111111")
            .join(","),
        },
        "test_accounts",
      ),
    ).toBe("needs_setup");
  });
  it("supports empty modern fields with legacy JWT keys", () => {
    const jwt = (role: string) =>
      `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    expect(
      evaluateSetup(
        {
          ...valid,
          SUPABASE_PUBLISHABLE_KEY: "",
          SUPABASE_SECRET_KEY: "",
          SUPABASE_ANON_KEY: jwt("anon"),
          SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
        },
        now,
      ).configurationComplete,
    ).toBe(true);
  });
});
