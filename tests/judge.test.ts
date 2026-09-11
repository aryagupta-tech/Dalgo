import { describe, it, expect, vi } from "vitest";
import { buildHarness, compareOutputs } from "../worker/harness";
import { interpretJudge, execute } from "../worker/judge";
import bank from "../worker/problems.json";
import type { Language, Problem, Submission } from "../shared/types";
import type { Env } from "../worker/env";
import fs from "node:fs";
const p = bank[0] as Problem;
it("rejects an oversized provider stream as output limit instead of voiding the match", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(512001))),
  );
  try {
    const result = await execute({} as Env, p, {
      language: "javascript",
      source: p.starter.javascript,
      kind: "submit",
    } as Submission);
    expect(result.verdict).toBe("output_limit");
  } finally {
    vi.unstubAllGlobals();
  }
});
describe("judge output trust boundary", () => {
  it("does not accept a self-reported pass flag", () => {
    expect(
      interpretJudge(
        { statusCode: 200, output: "passed", isExecutionSuccess: 1 },
        p,
        "submit",
      ).verdict,
    ).not.toBe("accepted");
  });
  it("rejects expected output if execution explicitly failed", () => {
    const output =
      "\n__DALGO_RESULT__" + JSON.stringify(p.tests.map((t) => t.expected));
    expect(
      interpretJudge(
        { statusCode: 200, output, isExecutionSuccess: 0 },
        p,
        "submit",
      ).verdict,
    ).toBe("runtime_error");
  });
  it("classifies documented HTTP200 timeout as TLE", () => {
    expect(
      interpretJudge(
        {
          statusCode: 200,
          isExecutionSuccess: 1,
          isCompiled: 0,
          output: "JDoodle - Timeout. more details",
        },
        p,
        "submit",
      ).verdict,
    ).toBe("time_limit");
  });
  it("hides hidden actual and expected outputs", () => {
    const result = interpretJudge(
      {
        statusCode: 200,
        output: "\n__DALGO_RESULT__" + JSON.stringify(p.tests.map(() => -900)),
        isExecutionSuccess: 1,
      },
      p,
      "submit",
    );
    expect(result.verdict).toBe("wrong_answer");
    expect(result.sampleResults).toBeUndefined();
  });
  it("requires complete correctly typed output", () => {
    expect(compareOutputs("\n__DALGO_RESULT__[3]", [3, 5]).valid).toBe(false);
    expect(compareOutputs('\n__DALGO_RESULT__["3"]', [3]).passed).toBe(false);
    expect(compareOutputs("\n__DALGO_RESULT__[3]\nTraceback", [3]).valid).toBe(
      false,
    );
  });
  it("rejects oversized output", () => {
    expect(
      interpretJudge(
        { statusCode: 200, output: "x".repeat(260000) },
        p,
        "submit",
      ).verdict,
    ).toBe("output_limit");
  });
  it("only emits test inputs in harnesses, never expected answers or refcode", () => {
    const sentinel = {
      ...p,
      tests: [{ args: [[4]], expected: "EXPECTED_SECRET_abc" }],
    } as Problem;
    for (const lang of ["python", "cpp", "java", "javascript"] as Language[])
      expect(
        buildHarness(sentinel, lang, p.starter[lang], "submit"),
      ).not.toContain("EXPECTED_SECRET_abc");
  });
  it("ships no hidden bank in public content", () => {
    const publicBank = JSON.parse(
      fs.readFileSync("public/problems.json", "utf8"),
    );
    expect(publicBank).toHaveLength(30);
    for (const row of publicBank) {
      expect(row).not.toHaveProperty("tests");
      expect(row).not.toHaveProperty("references");
      expect(row).not.toHaveProperty("reference");
    }
  });
});
