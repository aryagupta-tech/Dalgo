import type { Language, Problem, Submission, Verdict } from "../shared/types";
import type { Env } from "./env";
import { buildHarness, compareOutputs } from "./harness";
export const RUNTIMES: Record<
  Language,
  { language: string; versionIndex: string }
> = {
  python: { language: "python3", versionIndex: "6" },
  cpp: { language: "cpp17", versionIndex: "3" },
  java: { language: "java", versionIndex: "6" },
  javascript: { language: "nodejs", versionIndex: "7" },
};
export type JudgeResult = Pick<
  Submission,
  "verdict" | "message" | "sampleResults"
>;
export function interpretJudge(
  data: Record<string, any>,
  problem: Problem,
  kind: "run" | "submit",
): JudgeResult {
  const output = typeof data.output === "string" ? data.output : "";
  if (output.startsWith("JDoodle - Timeout."))
    return {
      verdict: "time_limit",
      message: "Your program exceeded the execution time limit.",
    };
  if (data.statusCode !== 200 || data.error)
    return {
      verdict: "judge_error",
      message: "The judge could not finish this attempt.",
    };
  if (
    data.isExecutionSuccess === false ||
    data.isExecutionSuccess === 0 ||
    data.isExecutionSuccess === "0" ||
    (data.exitCode !== undefined && Number(data.exitCode) !== 0)
  )
    return {
      verdict: "runtime_error",
      message: "Your program did not finish successfully.",
    };
  if (output.length > 256000)
    return {
      verdict: "output_limit",
      message: "Your program produced too much output.",
    };
  if (data.compilationStatus && data.compilationStatus !== "success")
    return {
      verdict: "compile_error",
      message:
        "Your code did not compile. Check the function signature and syntax.",
    };
  if (data.isCompiled === 0 || data.isCompiled === false) {
    return {
      verdict: "compile_error",
      message:
        "Your code did not compile. Check the function signature and syntax.",
    };
  }
  const cases = kind === "run" ? problem.examples : problem.tests;
  const parsed = compareOutputs(
    output,
    cases.map((c) => c.expected),
  );
  if (!parsed.valid) {
    const compile =
      /error:|SyntaxError|compilation failed|cannot find symbol/i.test(output);
    return {
      verdict: compile ? "compile_error" : "runtime_error",
      message: compile
        ? "Check your syntax and the supplied function signature."
        : "The function did not return valid results for every test.",
    };
  }
  return {
    verdict: parsed.passed ? "accepted" : "wrong_answer",
    message: parsed.passed
      ? kind === "run"
        ? "All sample cases passed. Submit to check the hidden tests."
        : "All hidden tests passed."
      : "Some test cases did not pass. Check edge cases and try again.",
    ...(kind === "run"
      ? {
          sampleResults: cases.map((c, i) => ({
            passed:
              JSON.stringify(parsed.actual[i]) === JSON.stringify(c.expected),
            actual: parsed.actual[i],
            expected: c.expected,
          })),
        }
      : {}),
  };
}
class OutputLimitError extends Error {}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512000) {
      await reader.cancel();
      throw new OutputLimitError("Response too large");
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}
export async function execute(
  env: Env,
  problem: Problem,
  s: Submission,
): Promise<JudgeResult> {
  try {
    const response = await fetch("https://api.jdoodle.com/v1/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: env.JDOODLE_CLIENT_ID,
        clientSecret: env.JDOODLE_CLIENT_SECRET,
        script: buildHarness(problem, s.language, s.source, s.kind),
        stdin: "",
        ...RUNTIMES[s.language],
        compileOnly: false,
        internetEnabled: false,
      }),
      signal: AbortSignal.timeout(140000),
    });
    if (!response.ok)
      return {
        verdict: "judge_error",
        message:
          "The judge is temporarily unavailable. Your match will be protected.",
      };
    const data = await boundedJson(response);
    return interpretJudge(data, problem, s.kind);
  } catch (error) {
    return error instanceof OutputLimitError
      ? {
          verdict: "output_limit",
          message: "Your program produced too much output.",
        }
      : {
          verdict: "judge_error",
          message: "The judge did not return a reliable result.",
        };
  }
}
export async function creditSpent(env: Env) {
  const r = await fetch("https://api.jdoodle.com/v1/credit-spent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: env.JDOODLE_CLIENT_ID,
      clientSecret: env.JDOODLE_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Credit reconciliation failed");
  const data = (await r.json()) as { used: number };
  if (!Number.isInteger(data.used) || data.used < 0)
    throw new Error("Invalid credit counter");
  return data.used;
}
