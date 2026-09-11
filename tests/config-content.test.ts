import { describe, expect, it } from "vitest";
import { launchReady, type Env } from "../worker/env";
import { publicProblem } from "../worker/core";
import bank from "../worker/problems.json";
import publicBank from "../public/problems.json";
import type { Problem } from "../shared/types";

const configured = {
  LIVE_MATCHES_ENABLED: "true",
  SUPABASE_URL: "https://offline.invalid",
  SUPABASE_ANON_KEY: "test",
  SUPABASE_SERVICE_ROLE_KEY: "test",
  JDOODLE_CLIENT_ID: "test",
  JDOODLE_CLIENT_SECRET: "test",
  JUDGE_DAILY_QUOTA: "200",
  JUDGE_CREDIT_COST: "1",
  JUDGE_CONCURRENCY: "1",
  JUDGE_RESET_HOUR_UTC: "0",
  JUDGE_VERIFIED_AT: "2026-09-11T00:00:00Z",
} as Env;

describe("launch gates and public content", () => {
  it("requires explicit launch permission and every verification setting", () => {
    expect(launchReady(configured)).toBe(true);
    expect(launchReady({} as Env)).toBe(false);
    for (const key of Object.keys(configured)) {
      expect(launchReady({ ...configured, [key]: "" })).toBe(false);
    }
    expect(launchReady({ ...configured, LIVE_MATCHES_ENABLED: "false" })).toBe(
      false,
    );
  });
  it("rejects malformed limits that could bypass capacity accounting", () => {
    for (const key of [
      "JUDGE_DAILY_QUOTA",
      "JUDGE_CREDIT_COST",
      "JUDGE_CONCURRENCY",
    ]) {
      for (const value of [
        "Infinity",
        "NaN",
        "0",
        "-1",
        "1.5",
        "9007199254740992",
      ]) {
        expect(launchReady({ ...configured, [key]: value })).toBe(false);
      }
    }
    for (const value of ["", " ", "-1", "24", "0.5", "NaN"]) {
      expect(launchReady({ ...configured, JUDGE_RESET_HOUR_UTC: value })).toBe(
        false,
      );
    }
    expect(launchReady({ ...configured, JDOODLE_CLIENT_SECRET: " " })).toBe(
      false,
    );
  });
  it("ships ten versioned problems per arena and only public fields to browsers", () => {
    expect(bank).toHaveLength(30);
    expect(new Set(bank.map((p) => `${p.id}:${p.version}`)).size).toBe(30);
    for (const arena of ["easy", "medium", "hard"])
      expect(bank.filter((p) => p.arena === arena)).toHaveLength(10);
    expect(publicBank).toEqual(bank.map((p) => publicProblem(p as Problem)));
    for (const p of bank) {
      expect(p.tests.length).toBeGreaterThanOrEqual(8);
      for (const language of ["python", "cpp", "java", "javascript"] as const) {
        expect(p.references[language].trim().length).toBeGreaterThan(10);
        expect(p.starter[language].trim().length).toBeGreaterThan(10);
      }
    }
  });
});
