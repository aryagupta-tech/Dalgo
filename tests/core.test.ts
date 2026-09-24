import { describe, it, expect } from "vitest";
import {
  adjudicate,
  chooseBot,
  ratingWindow,
  canPair,
  chooseProblem,
  type MatchRecord,
  MAX_JUDGE_MS,
} from "../worker/core";
import bank from "../worker/problems.json";
import type { Problem, Submission } from "../shared/types";
function match(): MatchRecord {
  return {
    id: "match",
    arena: "easy",
    mode: "human",
    players: [
      { id: "a", name: "A", rating: 1200 },
      { id: "b", name: "B", rating: 1200 },
    ],
    problemId: "p",
    problemVersion: 1,
    startsAt: 1000,
    endsAt: 601000,
    submissions: [],
    bot: null,
    result: null,
    settlementComplete: false,
    archived: false,
    createdAt: 0,
  };
}
function s(
  userId: string,
  receivedAt: number,
  verdict: Submission["verdict"],
): Submission {
  return {
    id: userId + receivedAt,
    userId,
    receivedAt,
    verdict,
    kind: "submit",
    language: "python",
    source: "",
    sequence: 0,
  };
}
describe("rating and matchmaking", () => {
  it("widens only within the same arena and both player windows", () => {
    expect([ratingWindow(0), ratingWindow(5000), ratingWindow(10000)]).toEqual([
      100, 200, 300,
    ]);
    expect(
      canPair(
        { arena: "easy", rating: 1000, joinedAt: 0 },
        { arena: "medium", rating: 1000, joinedAt: 0 },
        15000,
      ),
    ).toBe(false);
    expect(
      canPair(
        { arena: "easy", rating: 1000, joinedAt: 0 },
        { arena: "easy", rating: 1250, joinedAt: 14000 },
        15000,
      ),
    ).toBe(false);
  });
  it("selects lower bot on a tie, samples once", () => {
    const bot = chooseBot(1000, "easy", 1000, () => 0.1);
    expect(bot.rating).toBe(800);
    expect(bot.solves).toBe(true);
    expect(bot.completesAt).toBe(436000);
  });
  it("prefers unseen problems, then least recent", () => {
    const pool = bank as Problem[];
    const easy = pool.filter((p) => p.arena === "easy" && p.version === 2);
    const chosen = chooseProblem(pool, "easy", { [easy[0].id]: 100 }, () => 0);
    expect(chosen.id).toBe(easy[1].id);
    expect(chosen.version).toBe(2);
    expect(
      chooseProblem(
        pool,
        "easy",
        Object.fromEntries(easy.map((p, i) => [p.id, i + 1])),
        () => 0,
      ).id,
    ).toBe(easy[0].id);
  });
});
describe("authoritative results", () => {
  it("waits for earlier submission even if later judge finishes first", () => {
    const m = match();
    m.submissions = [s("a", 2000, "pending"), s("b", 3000, "accepted")];
    expect(adjudicate(m, 4000)).toBe(null);
    m.submissions[0].verdict = "accepted";
    expect(adjudicate(m, 5000)?.winnerId).toBe("a");
  });
  it("a later pending submission cannot delay a valid earlier win", () => {
    const m = match();
    m.submissions = [s("a", 2000, "accepted"), s("b", 3000, "pending")];
    expect(adjudicate(m, 4000)?.winnerId).toBe("a");
  });
  it("no solve is a draw, no rating movement even with different ratings", () => {
    const m = match();
    m.players[1].rating = 1600;
    expect(adjudicate(m, m.endsAt)).toMatchObject({
      reason: "draw",
      deltas: { a: 0, b: 0 },
    });
  });
  it("ties at identical timestamps", () => {
    const m = match();
    m.submissions = [s("a", 2000, "accepted"), s("b", 2000, "accepted")];
    expect(adjudicate(m, 3000)?.reason).toBe("draw");
  });
  it("rejects submissions at the match deadline", () => {
    const m = match();
    m.submissions = [s("a", m.endsAt, "accepted")];
    expect(adjudicate(m, m.endsAt)?.reason).toBe("draw");
  });
  it("waits for pre-deadline judging after timer expires", () => {
    const m = match();
    m.submissions = [s("a", 600000, "pending")];
    expect(adjudicate(m, 602000)).toBe(null);
    m.submissions[0].verdict = "accepted";
    expect(adjudicate(m, 603000)?.winnerId).toBe("a");
  });
  it("voids unresolved earlier submissions after150 seconds", () => {
    const m = match();
    m.submissions = [s("a", 2000, "pending"), s("b", 3000, "accepted")];
    expect(adjudicate(m, 2000 + MAX_JUDGE_MS)?.reason).toBe("void");
  });
  it("voids judge failure that could affect the winner", () => {
    const m = match();
    m.submissions = [s("a", 2000, "judge_error"), s("b", 3000, "accepted")];
    expect(adjudicate(m, 4000)?.reason).toBe("void");
  });
  it("sample runs cannot win or void a scored result", () => {
    const m = match();
    m.submissions = [
      { ...s("a", 2000, "accepted"), kind: "run" },
      s("b", 3000, "accepted"),
    ];
    expect(adjudicate(m, 4000)?.winnerId).toBe("b");
  });
  it("bot waits for an earlier human submission", () => {
    const m = match();
    m.mode = "bot";
    m.players[1] = { id: "bot", name: "Bot", rating: 1200, isBot: true };
    m.bot = { rating: 1200, solves: true, completesAt: 4000 };
    m.submissions = [s("a", 3000, "pending")];
    expect(adjudicate(m, 5000)).toBe(null);
    m.submissions[0].verdict = "wrong_answer";
    expect(adjudicate(m, 6000)).toMatchObject({
      winnerId: "bot",
      deltas: { a: 0 },
    });
  });
  it("never changes a persisted result", () => {
    const m = match();
    m.result = {
      winnerId: "a",
      reason: "solved",
      deltas: { a: 16, b: -16 },
      settled: true,
    };
    expect(adjudicate(m, 900000)).toBe(m.result);
  });
});
