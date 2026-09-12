import { describe, it, expect } from "vitest";
import { buildHarness } from "../worker/harness";
import { interpretJudge } from "../worker/judge";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Import the CLI as a native module: its entrypoint guard must prevent requests,
// report writes and SIGINT registration when tests load its pure helpers.
const scriptUrl = new URL("../scripts/verify-judge.mjs", import.meta.url).href;
const { makeChecks, evaluate, parseArgs, selectChecks } = await import(
  scriptUrl
);
const adapter = { buildHarness, interpretJudge };
const languages = ["python", "cpp", "java", "javascript"];
const checks = makeChecks(adapter, [], false);
const memory = checks.find((check: any) => check.id === "python:memory");
const wrongAnswer = checks.find(
  (check: any) => check.id === "python:wrong_answer",
);
const result = (output: string, extra: Record<string, unknown> = {}) => ({
  statusCode: 200,
  isCompiled: 1,
  isExecutionSuccess: 1,
  output,
  ...extra,
});

describe("judge verification launch evidence", () => {
  it("can import the runner without making requests or writing a report", () => {
    const process = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `globalThis.fetch = () => { throw new Error('Unexpected network request'); }; const before = process.listenerCount('SIGINT'); await import(${JSON.stringify(scriptUrl)}); if (process.listenerCount('SIGINT') !== before) throw new Error('Import registered a signal handler');`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(process.status).toBe(0);
    expect(process.stdout).toBe("");
    expect(process.stderr).toBe("");
  });

  it("includes wrong-answer and bounded-memory probes in all four languages and the cost plan", () => {
    expect(checks).toHaveLength(32);
    expect(new Set(checks.map((check: any) => check.id)).size).toBe(32);
    for (const language of languages) {
      expect(
        checks.find((check: any) => check.id === `${language}:wrong_answer`),
      ).toMatchObject({ expectedVerdict: "wrong_answer", kind: "submit" });
      expect(
        checks.find((check: any) => check.id === `${language}:memory`),
      ).toMatchObject({ expectedVerdict: "runtime_error", kind: "submit" });
    }
    expect(makeChecks(adapter, [], true)).toEqual([]);
  });

  it("requires a structured incorrect answer; compile failures do not count as wrong-answer coverage", () => {
    expect(
      evaluate(wrongAnswer, result("\n__DALGO_RESULT__[16]\n"), adapter),
    ).toMatchObject({ status: "passed", verdict: "wrong_answer" });
    expect(
      evaluate(wrongAnswer, result("\n__DALGO_RESULT__[17]\n"), adapter),
    ).toMatchObject({ status: "failed", verdict: "accepted" });
    expect(
      evaluate(
        wrongAnswer,
        result("SyntaxError: invalid syntax", { isCompiled: 0 }),
        adapter,
      ),
    ).toMatchObject({ status: "failed", verdict: "compile_error" });
  });

  it("runs the generated JavaScript wrong-answer harness through the actual adapter", () => {
    const check = checks.find(
      (check: any) => check.id === "javascript:wrong_answer",
    );
    const process = spawnSync("node", ["-e", check.script], {
      encoding: "utf8",
      timeout: 5000,
    });
    expect(process.status).toBe(0);
    expect(evaluate(check, result(process.stdout), adapter)).toMatchObject({
      status: "passed",
      verdict: "wrong_answer",
    });
  });

  it.each([
    ["python", "Traceback (most recent call last):\nMemoryError\n"],
    [
      "cpp",
      "terminate called after throwing an instance of 'std::bad_alloc'\n",
    ],
    [
      "java",
      'Exception in thread "main" java.lang.OutOfMemoryError: Java heap space\n',
    ],
    [
      "javascript",
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n",
    ],
  ])(
    "accepts explicit allocation-failure evidence with a safe %s application verdict",
    (language, output) => {
      const check = checks.find(
        (check: any) => check.id === `${language}:memory`,
      );
      expect(
        evaluate(
          check,
          result(output, { isExecutionSuccess: 0, exitCode: 1 }),
          adapter,
        ),
      ).toMatchObject({
        status: "passed",
        verdict: "runtime_error",
        memoryProbeMaximumBytes: 512 * 1024 * 1024,
      });
    },
  );

  it("accepts a caught allocation marker followed by unsuccessful execution", () => {
    expect(
      evaluate(
        memory,
        result("\n__DALGO_MEMORY__allocation_failed\n", {
          isExecutionSuccess: 0,
        }),
        adapter,
      ),
    ).toMatchObject({ status: "passed", verdict: "runtime_error" });
  });

  it("does not mistake a clean cap-reached completion for verified memory isolation", () => {
    expect(
      evaluate(
        memory,
        result("__DALGO_MEMORY__cap_reached\n\n__DALGO_RESULT__[17]\n"),
        adapter,
      ),
    ).toMatchObject({ status: "inconclusive", verdict: "accepted" });
    expect(
      evaluate(
        memory,
        result("__DALGO_MEMORY__cap_reached\nMemoryError\n", {
          isExecutionSuccess: 0,
        }),
        adapter,
      ),
    ).toMatchObject({ status: "inconclusive", verdict: "runtime_error" });
  });

  it.each([
    result("Killed", { isExecutionSuccess: 0, exitCode: 137, memory: 524288 }),
    result("", { isExecutionSuccess: 0, exitCode: 9 }),
    result("JDoodle - Timeout."),
    result("\n__DALGO_RESULT__[17]\n"),
    result("\n__DALGO_RESULT__[16]\n"),
  ])(
    "keeps ambiguous termination and non-memory results inconclusive: %j",
    (data) => {
      expect(evaluate(memory, data, adapter).status).toBe("inconclusive");
    },
  );

  it("fails provider errors and compile failures even if their output mentions OOM", () => {
    expect(
      evaluate(
        memory,
        result("MemoryError", {
          statusCode: 500,
          error: "backend unavailable",
        }),
        adapter,
      ),
    ).toMatchObject({ status: "failed", verdict: "judge_error" });
    expect(
      evaluate(
        memory,
        result("std::bad_alloc", { isCompiled: 0, isExecutionSuccess: 0 }),
        adapter,
      ).status,
    ).toBe("failed");
  });
});

const planningAdapter = {
  ...adapter,
  problems: [
    {
      ...memory.problem,
      id: "reference-example",
      references: {
        python: "def solve():\n    return 17",
        cpp: "int solve() { return 17; }",
        java: "public static int solve() { return 17; }",
        javascript: "function solve() { return 17; }",
      },
    },
  ],
};

function runCli(args: string[]) {
  const temp = mkdtempSync(join(tmpdir(), "dalgo-judge-cli-test-"));
  try {
    const report = join(temp, "report.json");
    const execution = spawnSync(
      "node",
      [
        fileURLToPath(scriptUrl),
        "--project",
        fileURLToPath(new URL("../", import.meta.url)),
        "--report",
        report,
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          JDOODLE_CLIENT_ID: "",
          JDOODLE_CLIENT_SECRET: "",
          JUDGE_DAILY_QUOTA: "20",
          JUDGE_CREDIT_COST: "1",
        },
      },
    );
    return {
      code: execution.status,
      report: JSON.parse(readFileSync(report, "utf8")),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("judge verification probe batches", () => {
  it("keeps the complete probe and reference suite as the default", () => {
    const plan = selectChecks(planningAdapter, parseArgs([]));
    expect(plan.checks).toHaveLength(40);
    expect(plan.coverage).toMatchObject({
      allProbeCount: 32,
      allProbesSelected: true,
      fullBankSelected: true,
      fullCoverageSelected: true,
      skippedProbeIds: [],
    });
  });

  it("supports disjoint zero-based batches that cover each probe once", () => {
    const batches = [0, 8, 16, 24].map((offset) =>
      selectChecks(
        planningAdapter,
        parseArgs([
          "--problem-limit",
          "0",
          "--probe-offset",
          String(offset),
          "--probe-limit",
          "8",
        ]),
      ),
    );
    expect(batches.map((plan) => plan.coverage.languages)).toEqual([
      ["python"],
      ["cpp"],
      ["java"],
      ["javascript"],
    ]);
    const ids = batches.flatMap((plan) => plan.coverage.selectedProbeIds);
    expect(ids).toEqual(checks.map((check: any) => check.id));
    expect(new Set(ids).size).toBe(32);
    for (const plan of batches) {
      expect(plan.checks).toHaveLength(8);
      expect(plan.coverage.skippedProbeIds).toHaveLength(24);
      expect(plan.coverage).toMatchObject({
        fullCoverageSelected: false,
        allProbesSelected: false,
        fullBankSelected: false,
        selectedProblemIds: [],
        referenceSuites: [],
      });
    }
  });

  it.each([
    ["--probe-offset", "-1"],
    ["--probe-limit", "-1"],
    ["--probe-offset", "1.5"],
    ["--probe-limit", "NaN"],
    ["--probe-offset", "9007199254740992"],
    ["--probe-limit"],
  ])("rejects invalid argument values: %j", (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });

  it.each([
    ["--probe-offset", "33"],
    ["--probe-limit", "33"],
    ["--probe-offset", "31", "--probe-limit", "2"],
  ])(
    "rejects ranges extending beyond the suite instead of silently clipping: %j",
    (...args) => {
      expect(() => selectChecks(planningAdapter, parseArgs(args))).toThrow(
        /exceeds/,
      );
    },
  );

  it("rejects conflicting skip/range options even for an explicit zero offset", () => {
    expect(() => parseArgs(["--skip-probes", "--probe-offset", "0"])).toThrow(
      /cannot be combined/,
    );
    expect(() => parseArgs(["--skip-probes", "--probe-limit", "0"])).toThrow(
      /cannot be combined/,
    );
  });

  it("can omit probes while retaining reference tests, with excluded scope recorded", () => {
    for (const args of [
      ["--skip-probes"],
      ["--probe-limit", "0"],
      ["--probe-offset", "32"],
    ]) {
      const plan = selectChecks(planningAdapter, parseArgs(args));
      expect(plan.checks).toHaveLength(8);
      expect(plan.coverage.selectedProbeIds).toEqual([]);
      expect(plan.coverage.skippedProbeIds).toHaveLength(32);
      expect(plan.coverage.fullCoverageSelected).toBe(false);
    }
  });

  it("rejects a valid range that leaves an entirely empty plan", () => {
    for (const args of [
      ["--problem-limit", "0", "--probe-limit", "0"],
      ["--problem-limit", "0", "--skip-probes"],
      ["--problem-limit", "0", "--probe-offset", "32"],
    ])
      expect(() => selectChecks(planningAdapter, parseArgs(args))).toThrow(
        /no checks/,
      );
  });

  it("prints a no-network eight-probe plan affordable within a 20-credit account cap", () => {
    const { code, report } = runCli([
      "--problem-limit",
      "0",
      "--probe-offset",
      "8",
      "--probe-limit",
      "8",
    ]);
    expect(code).toBe(0);
    expect(report.status).toBe("dry_run");
    expect(report.requests).toEqual({});
    expect(report.plan).toMatchObject({
      executeRequests: 8,
      estimatedMaximumCredits: 10,
      quotaFromEnvironment: 20,
      quotaSafetyCap: 16,
    });
    expect(report.plan.estimatedMaximumCredits).toBeLessThanOrEqual(
      report.plan.quotaSafetyCap,
    );
    expect(report.coverage.selectedProbeIds).toEqual(
      checks.slice(8, 16).map((check: any) => check.id),
    );
    expect(report.coverage.skippedProbeIds).toHaveLength(24);
    expect(report.coverage.fullCoverageSelected).toBe(false);
    expect(report.launchVerified).toBe(false);
    expect(report.requestedCoveragePassed).toBe(false);
    expect(report.sourceHashes["scripts/verify-judge.mjs"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("reports only selected memory/timeout requirements and preserves the explicit credit maximum gate", () => {
    const subset = runCli(["--problem-limit", "0", "--probe-limit", "3"]);
    expect(subset.report.plan).toMatchObject({
      boundedTimeoutProbeSeconds: 0,
      boundedMemoryProbeBytes: 0,
      memoryProbeChunkBytes: 0,
      estimatedMaximumCredits: 5,
    });
    const refused = runCli([
      "--problem-limit",
      "0",
      "--probe-limit",
      "8",
      "--execute",
      "--max-credits",
      "9",
    ]);
    expect(refused.code).toBe(2);
    expect(refused.report.status).toBe("preflight_failed");
    expect(refused.report.requests).toEqual({});
    expect(refused.report.failures).toContainEqual(
      expect.stringContaining("--max-credits of at least 10"),
    );
  });
});
