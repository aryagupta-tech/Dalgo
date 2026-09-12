import {
  ARENAS,
  LANGUAGES,
  type Arena,
  type Language,
  type MatchView,
  type PublicProblem,
  type Result,
  type Submission,
} from "../shared/types";

export const DEMO_USER = "demo-you";
export const DEMO_BOT = "demo-bot";
export const DEMO_SEARCH_MS = 15_000;
export const DEMO_READY_MS = 5_000;
export const DEMO_PREVIEW_MS = 800;
export type DemoScenario = "win" | "loss" | "draw" | "void";
export type DemoPhase = "searching" | "ready" | "active" | "finished";
export type DemoSubmission = Omit<Submission, "source">;

export interface DemoState {
  schema: 1;
  id: string;
  arena: Arena;
  problemId: string;
  problemVersion: number;
  queuedAt: number;
  startsAt: number;
  endsAt: number;
  finishedAt?: number;
  scenario: DemoScenario;
  submissions: DemoSubmission[];
  pending?: {
    kind: "run" | "submit";
    language: Language;
    receivedAt: number;
    resolvesAt: number;
    id: string;
  };
  result: Result | null;
}

const SCENARIOS = new Set<DemoScenario>(["win", "loss", "draw", "void"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const allowedKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function assertTime(now: number) {
  if (!timestamp(now))
    throw new Error("The demo clock is unavailable. Start a new preview.");
}
function assertProblem(arena: Arena, problem: PublicProblem) {
  if (
    !Object.hasOwn(ARENAS, arena) ||
    problem.arena !== arena ||
    !problem.id ||
    !Number.isSafeInteger(problem.version) ||
    problem.version < 1
  ) {
    throw new Error("Choose a problem from this arena to start the demo.");
  }
}
function assertScenario(scenario: DemoScenario) {
  if (!SCENARIOS.has(scenario))
    throw new Error("Choose a win, loss, draw, or void preview.");
}
function sameProblem(state: DemoState, problem: PublicProblem) {
  assertProblem(state.arena, problem);
  if (
    state.problemId !== problem.id ||
    state.problemVersion !== problem.version
  ) {
    throw new Error("This demo uses a different problem. Start a new preview.");
  }
}

function illustrativeResult(scenario: DemoScenario, resigned = false): Result {
  return {
    winnerId:
      scenario === "win" ? DEMO_USER : scenario === "loss" ? DEMO_BOT : null,
    reason: resigned
      ? "resigned"
      : scenario === "draw"
        ? "draw"
        : scenario === "void"
          ? "void"
          : "solved",
    deltas: {
      [DEMO_USER]: scenario === "win" ? 16 : scenario === "loss" ? -16 : 0,
    },
    settled: true,
  };
}

export function createDemo(
  arena: Arena,
  problem: PublicProblem,
  now: number,
): DemoState {
  assertTime(now);
  assertProblem(arena, problem);
  const startsAt = now + DEMO_SEARCH_MS + DEMO_READY_MS;
  return {
    schema: 1,
    id: crypto.randomUUID(),
    arena,
    problemId: problem.id,
    problemVersion: problem.version,
    queuedAt: now,
    startsAt,
    endsAt: startsAt + ARENAS[arena].duration * 1000,
    scenario: "win",
    submissions: [],
    result: null,
  };
}

/** Phase is derived from the clock; advanceDemo materializes any due result. */
export function demoPhase(state: DemoState, now: number): DemoPhase {
  assertTime(now);
  if (
    state.result ||
    (now >= state.endsAt && (!state.pending || now >= state.pending.resolvesAt))
  )
    return "finished";
  if (now < state.startsAt - DEMO_READY_MS) return "searching";
  if (now < state.startsAt) return "ready";
  return "active";
}

/** Repeated calls after the wait/ready stages leave the session unchanged. */
export function skipDemoWait(state: DemoState, now: number): DemoState {
  const phase = demoPhase(state, now);
  if (phase !== "searching" && phase !== "ready") return state;
  const startsAt = phase === "searching" ? now + DEMO_READY_MS : now;
  return {
    ...state,
    startsAt,
    endsAt: startsAt + ARENAS[state.arena].duration * 1000,
  };
}

export function setDemoScenario(
  state: DemoState,
  scenario: DemoScenario,
): DemoState {
  assertScenario(scenario);
  if (state.result)
    throw new Error("Start a new demo to preview another outcome.");
  if (state.pending)
    throw new Error(
      "Wait for the current preview before changing its outcome.",
    );
  return state.scenario === scenario ? state : { ...state, scenario };
}

/** This function deliberately accepts no source code. Results are illustrative. */
export function previewAttempt(
  state: DemoState,
  kind: "run" | "submit",
  language: Language,
  now: number,
): DemoState {
  assertTime(now);
  if (kind !== "run" && kind !== "submit")
    throw new Error("Choose Run or Submit to preview an attempt.");
  if (!Object.hasOwn(LANGUAGES, language))
    throw new Error("Choose a supported language.");
  if (demoPhase(state, now) !== "active" || now >= state.endsAt)
    throw new Error("Start an active demo before previewing an attempt.");
  if (state.pending) throw new Error("Wait for the current preview to finish.");
  if (
    state.submissions.filter((submission) => submission.kind === kind).length >=
    (kind === "run" ? 3 : 5)
  ) {
    throw new Error(
      kind === "run"
        ? "You have used all three sample previews."
        : "You have used all five submission previews.",
    );
  }
  const id = crypto.randomUUID();
  const submission: DemoSubmission = {
    id,
    userId: DEMO_USER,
    kind,
    language,
    receivedAt: now,
    sequence: state.submissions.length,
    verdict: "pending",
    message: "Preparing an illustrative preview. No code is being executed.",
  };
  return {
    ...state,
    submissions: [...state.submissions, submission],
    pending: {
      id,
      kind,
      language,
      receivedAt: now,
      resolvesAt: now + DEMO_PREVIEW_MS,
    },
  };
}

/** Manual outcomes are local illustrations; resigning always previews a loss. */
export function finishDemo(
  state: DemoState,
  scenario: DemoScenario,
  now: number,
  reason?: "resigned",
): DemoState {
  assertTime(now);
  assertScenario(scenario);
  if (state.result) return state;
  const effective = reason === "resigned" ? "loss" : scenario;
  const finishedAt = Math.max(now, state.queuedAt);
  const { pending: _pending, ...rest } = state;
  return {
    ...rest,
    scenario: effective,
    finishedAt,
    submissions: state.submissions.map((submission) =>
      submission.verdict === "pending"
        ? {
            ...submission,
            verdict: "judge_error",
            completedAt: Math.max(finishedAt, submission.receivedAt),
            message:
              "The demo ended before this illustrative preview completed. No code was executed.",
          }
        : submission,
    ),
    result: illustrativeResult(effective, reason === "resigned"),
  };
}

export function advanceDemo(
  state: DemoState,
  now: number,
  problem: PublicProblem,
): DemoState {
  assertTime(now);
  sameProblem(state, problem);
  if (state.result) return state;
  let next = state;
  if (state.pending && now >= state.pending.resolvesAt) {
    const pending = state.pending;
    const { pending: _pending, ...rest } = state;
    next = {
      ...rest,
      submissions: state.submissions.map((submission) => {
        if (submission.id !== pending.id) return submission;
        if (pending.kind === "run")
          return {
            ...submission,
            verdict: "accepted",
            completedAt: pending.resolvesAt,
            message:
              "Illustrative sample outputs from the problem examples. Your code was not executed.",
            sampleResults: problem.examples.map((example) => ({
              passed: true,
              actual: clone(example.expected),
              expected: clone(example.expected),
            })),
          };
        return {
          ...submission,
          completedAt: pending.resolvesAt,
          verdict:
            state.scenario === "win"
              ? "accepted"
              : state.scenario === "void"
                ? "judge_error"
                : "wrong_answer",
          message: `Illustrative ${state.scenario} result selected for this demo. Your code was not executed.`,
        };
      }),
    };
    if (pending.kind === "submit")
      return finishDemo(next, state.scenario, pending.resolvesAt);
  }
  // An attempt received before expiry gets its scheduled illustrative resolution.
  if (!next.pending && now >= next.endsAt)
    return finishDemo(
      next,
      "draw",
      Math.max(next.endsAt, state.pending?.resolvesAt ?? next.endsAt),
    );
  return next;
}

/** Strict schema validation for sessionStorage strings or already-parsed data. */
export function restoreDemo(
  raw: unknown,
  arena: Arena,
  problem: PublicProblem,
  now: number,
): DemoState | null {
  try {
    assertTime(now);
    assertProblem(arena, problem);
    if (typeof raw === "string") {
      if (raw.length > 128_000) return null;
      raw = JSON.parse(raw);
    }
    if (
      !object(raw) ||
      !allowedKeys(raw, [
        "schema",
        "id",
        "arena",
        "problemId",
        "problemVersion",
        "queuedAt",
        "startsAt",
        "endsAt",
        "finishedAt",
        "scenario",
        "submissions",
        "pending",
        "result",
      ])
    )
      return null;
    if (
      raw.schema !== 1 ||
      typeof raw.id !== "string" ||
      !UUID.test(raw.id) ||
      raw.arena !== arena ||
      raw.problemId !== problem.id ||
      raw.problemVersion !== problem.version ||
      !SCENARIOS.has(raw.scenario as DemoScenario)
    )
      return null;
    if (
      !timestamp(raw.queuedAt) ||
      !timestamp(raw.startsAt) ||
      !timestamp(raw.endsAt) ||
      raw.queuedAt > now ||
      raw.startsAt < raw.queuedAt ||
      raw.startsAt > raw.queuedAt + DEMO_SEARCH_MS + DEMO_READY_MS ||
      raw.endsAt - raw.startsAt !== ARENAS[arena].duration * 1000
    )
      return null;
    if (!Array.isArray(raw.submissions) || raw.submissions.length > 8)
      return null;
    const ids = new Set<string>();
    let runs = 0,
      submits = 0,
      pendingRows = 0;
    for (let i = 0; i < raw.submissions.length; i++) {
      const row: unknown = raw.submissions[i];
      if (
        !object(row) ||
        !allowedKeys(row, [
          "id",
          "userId",
          "kind",
          "language",
          "receivedAt",
          "sequence",
          "verdict",
          "message",
          "sampleResults",
          "completedAt",
          "attempt",
        ])
      )
        return null;
      if (
        typeof row.id !== "string" ||
        !UUID.test(row.id) ||
        ids.has(row.id) ||
        row.userId !== DEMO_USER ||
        row.sequence !== i ||
        (row.kind !== "run" && row.kind !== "submit") ||
        typeof row.language !== "string" ||
        !Object.hasOwn(LANGUAGES, row.language)
      )
        return null;
      ids.add(row.id);
      if (row.kind === "run") runs++;
      else submits++;
      if (
        !timestamp(row.receivedAt) ||
        row.receivedAt < raw.startsAt ||
        row.receivedAt >= raw.endsAt ||
        row.receivedAt > now ||
        !["pending", "accepted", "wrong_answer", "judge_error"].includes(
          row.verdict as string,
        )
      )
        return null;
      if (
        row.message !== undefined &&
        (typeof row.message !== "string" || row.message.length > 500)
      )
        return null;
      if (row.attempt !== undefined && row.attempt !== 1) return null;
      if (row.verdict === "pending") {
        pendingRows++;
        if (row.completedAt !== undefined || row.sampleResults !== undefined)
          return null;
      } else if (
        !timestamp(row.completedAt) ||
        row.completedAt < row.receivedAt ||
        row.completedAt > now
      )
        return null;
      if (row.sampleResults !== undefined) {
        if (
          row.kind !== "run" ||
          row.verdict !== "accepted" ||
          !Array.isArray(row.sampleResults) ||
          row.sampleResults.length !== problem.examples.length
        )
          return null;
        for (let j = 0; j < row.sampleResults.length; j++) {
          const sample: unknown = row.sampleResults[j];
          if (
            !object(sample) ||
            !allowedKeys(sample, ["passed", "actual", "expected"]) ||
            sample.passed !== true ||
            JSON.stringify(sample.actual) !==
              JSON.stringify(problem.examples[j].expected) ||
            JSON.stringify(sample.expected) !==
              JSON.stringify(problem.examples[j].expected)
          )
            return null;
        }
      } else if (row.kind === "run" && row.verdict === "accepted") return null;
    }
    if (runs > 3 || submits > 5 || pendingRows > 1) return null;
    if (raw.pending !== undefined) {
      const pending = raw.pending;
      if (
        !object(pending) ||
        !allowedKeys(pending, [
          "id",
          "kind",
          "language",
          "receivedAt",
          "resolvesAt",
        ]) ||
        pendingRows !== 1 ||
        !timestamp(pending.receivedAt) ||
        pending.resolvesAt !== pending.receivedAt + DEMO_PREVIEW_MS
      )
        return null;
      const row = raw.submissions.find(
        (row: Record<string, unknown>) => row.id === pending.id,
      );
      if (
        !row ||
        row.verdict !== "pending" ||
        row.kind !== pending.kind ||
        row.language !== pending.language ||
        row.receivedAt !== pending.receivedAt
      )
        return null;
    } else if (pendingRows) return null;
    if (raw.result !== null) {
      const result = raw.result;
      if (
        !object(result) ||
        !allowedKeys(result, ["winnerId", "reason", "deltas", "settled"]) ||
        raw.pending !== undefined ||
        !timestamp(raw.finishedAt) ||
        raw.finishedAt < raw.queuedAt ||
        raw.finishedAt > now
      )
        return null;
      if (result.reason === "resigned" && raw.scenario !== "loss") return null;
      const expected = illustrativeResult(
        raw.scenario as DemoScenario,
        result.reason === "resigned",
      );
      if (
        result.winnerId !== expected.winnerId ||
        result.reason !== expected.reason ||
        result.settled !== true ||
        !object(result.deltas) ||
        Object.keys(result.deltas).length !== 1 ||
        result.deltas[DEMO_USER] !== expected.deltas[DEMO_USER]
      )
        return null;
    } else if (raw.finishedAt !== undefined) return null;
    return advanceDemo(clone(raw) as unknown as DemoState, now, problem);
  } catch {
    return null;
  }
}

export function toDemoMatch(
  state: DemoState,
  problem: PublicProblem,
  now: number,
): MatchView {
  const next = advanceDemo(state, now, problem);
  const phase = demoPhase(next, now);
  // Whitelist public fields even if the caller supplies a larger problem object.
  const publicProblem: PublicProblem = {
    id: problem.id,
    version: problem.version,
    title: problem.title,
    arena: problem.arena,
    topic: problem.topic,
    description: problem.description,
    constraints: clone(problem.constraints),
    parameters: clone(problem.parameters),
    returnType: problem.returnType,
    examples: clone(problem.examples),
    starter: clone(problem.starter),
  };
  return {
    id: next.id,
    arena: next.arena,
    mode: "bot",
    status:
      phase === "finished"
        ? "finished"
        : phase === "active"
          ? "active"
          : "ready",
    players: [
      { id: DEMO_USER, name: "You · Demo", rating: 1200 },
      { id: DEMO_BOT, name: "Vector · Demo", rating: 1200, isBot: true },
    ],
    problem: publicProblem,
    startsAt: next.startsAt,
    endsAt: next.endsAt,
    serverNow: now,
    opponentStatus:
      phase === "finished"
        ? "Finished"
        : next.pending
          ? "Judging"
          : phase === "active"
            ? "Solving"
            : "Ready",
    submissions: clone(next.submissions),
    attempts: {
      runs: next.submissions.filter((submission) => submission.kind === "run")
        .length,
      submits: next.submissions.filter(
        (submission) => submission.kind === "submit",
      ).length,
    },
    result: clone(next.result),
  };
}
