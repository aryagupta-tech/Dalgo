import { describe, expect, it } from "vitest";
import {
  configuredAttemptLimits,
  executionReservation,
} from "../worker/limits";
// @ts-expect-error Standalone Node setup script has no generated declarations.
import { evaluateSetup } from "../scripts/check-setup.mjs";

describe("attempt policy configuration", () => {
  it("preserves the original allowance and reserves both retry executions", () => {
    const limits = configuredAttemptLimits({})!;
    expect(limits).toEqual({ runs: 3, submits: 5 });
    expect(executionReservation(limits, 1)).toEqual({
      base: 8,
      retries: 2,
      total: 10,
    });
    expect(executionReservation(limits, 3)).toEqual({
      base: 24,
      retries: 6,
      total: 30,
    });
  });

  it("computes a two-human reservation that fits the 20-credit plan when explicitly configured", () => {
    const settings = {
      JUDGE_PROVIDER: "jdoodle",
      MATCH_RUN_LIMIT: "2",
      MATCH_SUBMISSION_LIMIT: "4",
      JUDGE_DAILY_QUOTA: "20",
      JUDGE_CREDIT_COST: "1",
    };
    const limits = configuredAttemptLimits(settings)!;
    expect(limits).toEqual({ runs: 2, submits: 4 });
    expect(executionReservation(limits, 1)).toEqual({
      base: 6,
      retries: 2,
      total: 8,
    });
    const report = evaluateSetup(settings);
    expect(report.attemptLimits).toEqual(limits);
    expect(report.capacity).toEqual({
      admissionCredits: 16,
      creditsPerHuman: 8,
      botMatchReservation: 8,
      humanMatchReservation: 16,
    });
    expect(
      report.checks.find((check: any) => check.id === "human_match_capacity")
        ?.status,
    ).toBe("configured");
  });

  it("fails closed for malformed overrides in the worker and setup preflight", () => {
    for (const key of ["MATCH_RUN_LIMIT", "MATCH_SUBMISSION_LIMIT"]) {
      for (const value of [
        "",
        " ",
        "0",
        "-1",
        "1.5",
        "1e1",
        "0x2",
        "Infinity",
        "NaN",
        "21",
        "9007199254740992",
      ]) {
        const settings = {
          JUDGE_PROVIDER: "jdoodle",
          MATCH_RUN_LIMIT: undefined,
          MATCH_SUBMISSION_LIMIT: undefined,
          [key]: value,
          JUDGE_DAILY_QUOTA: "20",
          JUDGE_CREDIT_COST: "1",
        };
        expect(configuredAttemptLimits(settings)).toBeNull();
        const report = evaluateSetup(settings);
        expect(report.attemptLimits).toBeNull();
        expect(report.capacity).toBeNull();
        expect(
          report.checks.find((check: any) => check.id === "attempt_limits")
            ?.status,
        ).toBe("needs_setup");
      }
    }
  });
});
