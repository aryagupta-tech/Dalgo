import {
  ARENAS,
  type Arena,
  type AttemptLimits,
  type Mode,
  type Player,
  type Problem,
  type Submission,
  type Result,
} from "../shared/types";
export const MAX_JUDGE_MS = 150_000;
export interface BotPlan {
  rating: number;
  solves: boolean;
  completesAt: number | null;
}
export interface MatchRecord {
  id: string;
  arena: Arena;
  mode: Mode;
  players: Player[];
  problemId: string;
  problemVersion: number;
  startsAt: number;
  endsAt: number;
  submissions: Submission[];
  attemptLimits?: AttemptLimits;
  bot: BotPlan | null;
  result: Result | null;
  settlementComplete: boolean;
  archived: boolean;
  coordinatorReleased?: boolean;
  terminalAt?: number;
  createdAt: number;
  // Old persisted matches lack this launch flag and remain private.
  codeRevealAllowed?: boolean;
}
export function eloDelta(winner: number, loser: number) {
  return Math.round(32 * (1 - 1 / (1 + 10 ** ((loser - winner) / 400))));
}
export function ratingWindow(waitMs: number) {
  return waitMs < 5000 ? 100 : waitMs < 10000 ? 200 : 300;
}
export function canPair(
  a: { arena: Arena; rating: number; joinedAt: number },
  b: { arena: Arena; rating: number; joinedAt: number },
  now: number,
) {
  return (
    a.arena === b.arena &&
    Math.abs(a.rating - b.rating) <=
      Math.min(ratingWindow(now - a.joinedAt), ratingWindow(now - b.joinedAt))
  );
}
export function chooseBot(
  rating: number,
  arena: Arena,
  startsAt: number,
  random = Math.random,
): BotPlan {
  const profiles = [
    { rating: 800, p: 0.5, low: 0.7, high: 0.95 },
    { rating: 1200, p: 0.7, low: 0.45, high: 0.8 },
    { rating: 1600, p: 0.9, low: 0.2, high: 0.6 },
  ];
  const p = profiles.reduce((a, b) =>
    Math.abs(b.rating - rating) < Math.abs(a.rating - rating) ? b : a,
  );
  const solves = random() < p.p;
  return {
    rating: p.rating,
    solves,
    completesAt: solves
      ? startsAt +
        Math.round(
          ARENAS[arena].duration * 1000 * (p.low + (p.high - p.low) * random()),
        )
      : null,
  };
}
export function makeResult(
  m: MatchRecord,
  winnerId: string | null,
  reason: Result["reason"],
): Result {
  const deltas: Record<string, number> = {};
  for (const p of m.players) if (!p.isBot) deltas[p.id] = 0;
  if (winnerId) {
    const winner = m.players.find((p) => p.id === winnerId)!,
      loser = m.players.find((p) => p.id !== winnerId)!;
    const delta = eloDelta(winner.rating, loser.rating);
    if (!winner.isBot) deltas[winner.id] = delta;
    if (!loser.isBot) deltas[loser.id] = -delta;
  }
  return { winnerId, reason, deltas, settled: false };
}
export function adjudicate(m: MatchRecord, now: number): Result | null {
  if (m.result) return m.result;
  const attempts = m.submissions.filter(
    (s) =>
      s.kind === "submit" &&
      s.receivedAt >= m.startsAt &&
      s.receivedAt < m.endsAt,
  );
  const candidates = attempts
    .filter((s) => s.verdict === "accepted")
    .map((s) => ({ userId: s.userId, time: s.receivedAt }));
  if (m.bot?.solves && m.bot.completesAt !== null && m.bot.completesAt <= now)
    candidates.push({ userId: "bot", time: m.bot.completesAt });
  candidates.sort((a, b) => a.time - b.time);
  const first = candidates[0];
  const relevant = attempts.filter((s) => !first || s.receivedAt <= first.time);
  if (
    relevant.some(
      (s) =>
        s.verdict === "judge_error" ||
        (s.verdict === "pending" && now - s.receivedAt >= MAX_JUDGE_MS),
    )
  )
    return makeResult(m, null, "void");
  if (relevant.some((s) => s.verdict === "pending")) return null;
  if (first) {
    const tied = candidates.some(
      (c) => c.time === first.time && c.userId !== first.userId,
    );
    return makeResult(m, tied ? null : first.userId, tied ? "draw" : "solved");
  }
  return now >= m.endsAt ? makeResult(m, null, "draw") : null;
}
export function publicProblem(p: Problem) {
  const { tests, reference, references, complexity, ...safe } = p;
  return safe;
}
export function chooseProblem(
  problems: Problem[],
  arena: Arena,
  recent: Record<string, number>,
  random = Math.random,
) {
  const latest = new Map<string, Problem>();
  for (const problem of problems) {
    if (problem.arena !== arena) continue;
    const current = latest.get(problem.id);
    if (!current || problem.version > current.version)
      latest.set(problem.id, problem);
  }
  const pool = [...latest.values()];
  const unseen = pool.filter((p) => !recent[p.id]);
  if (unseen.length)
    return unseen[
      Math.min(unseen.length - 1, Math.floor(random() * unseen.length))
    ];
  return pool.sort((a, b) => (recent[a.id] ?? 0) - (recent[b.id] ?? 0))[0];
}
export class Serial {
  private last: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.last.then(work, work);
    this.last = next.catch(() => {});
    return next;
  }
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
export function parseArena(value: unknown): Arena {
  if (value !== "easy" && value !== "medium" && value !== "hard")
    throw new AppError("Choose a valid arena.");
  return value;
}
