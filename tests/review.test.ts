import { describe, expect, it } from "vitest";
import type { MatchRecord } from "../worker/core";
import type { Problem, Submission } from "../shared/types";
import { publicMatchReview } from "../worker/review";
import bank from "../worker/problems.json";

const CREATED_AT = Date.UTC(2026, 8, 24);
const DAY = 86_400_000;
const problem = bank[0] as Problem;

function submission(
  userId: string,
  kind: Submission["kind"],
  sequence: number,
  source: string,
): Submission {
  return {
    id: `${userId}-${sequence}`,
    userId,
    kind,
    sequence,
    source,
    language: "python",
    verdict: "accepted",
    receivedAt: CREATED_AT + sequence * 1000,
    sampleResults: [{ passed: true, actual: "hidden-output", expected: "secret-answer" }],
  };
}

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    arena: "easy",
    mode: "human",
    players: [
      { id: "alice", name: "Alice", rating: 800 },
      { id: "bob", name: "Bob", rating: 1200 },
    ],
    problemId: problem.id,
    problemVersion: problem.version,
    startsAt: CREATED_AT + 5000,
    endsAt: CREATED_AT + 605000,
    submissions: [
      submission("alice", "run", 0, "private sample code"),
      submission("alice", "submit", 1, "def solve(): return 1"),
      submission("bob", "submit", 2, "def solve(): return 2"),
    ],
    bot: null,
    result: { winnerId: "alice", reason: "solved", deltas: { alice: 29, bob: -29 }, settled: true },
    settlementComplete: true,
    archived: true,
    createdAt: CREATED_AT,
    codeRevealAllowed: true,
    ...overrides,
  };
}

describe("public match review", () => {
  it("rejects active and settlement-pending matches even when flagged", () => {
    expect(() => publicMatchReview(match({ result: null }), problem, CREATED_AT + 5000)).toThrow();
    expect(() => publicMatchReview(match({ result: { winnerId: "alice", reason: "solved", deltas: {}, settled: false } }), problem, CREATED_AT + 5000)).toThrow();
  });

  it("shows only scored Submit sources and public problem fields", () => {
    const review = publicMatchReview(match(), problem, CREATED_AT + DAY);
    expect(review.players.map((p) => p.submissions.length)).toEqual([1, 1]);
    expect(review.players[0].submissions[0].source).toBe("def solve(): return 1");
    const output = JSON.stringify(review);
    expect(output).not.toContain("private sample code");
    expect(output).not.toContain("secret-answer");
    expect(output).not.toContain("hidden-output");
    expect(output).not.toContain('"tests"');
    expect(output).not.toContain('"reference"');
    expect(output).not.toContain('"payload"');
  });

  it("keeps all prelaunch match code private", () => {
    const review = publicMatchReview(match({ codeRevealAllowed: undefined }), problem, CREATED_AT + DAY);
    expect(review.codeStatus).toBe("not_available");
    expect(review.players[0].submissions[0].source).toBeUndefined();
    expect(JSON.stringify(review)).not.toContain("def solve(): return 1");
    expect(JSON.stringify(review)).not.toContain("def solve(): return 2");
  });

  it("expires access at 30 days even before the storage purge runs", () => {
    const review = publicMatchReview(match(), problem, CREATED_AT + 30 * DAY);
    expect(review.codeStatus).toBe("expired");
    expect(review.players[1].submissions[0].source).toBeUndefined();
  });

  it("makes bot participation clear without fabricating source", () => {
    const m = match({
      mode: "bot",
      players: [
        { id: "alice", name: "Alice", rating: 800 },
        { id: "bot", name: "Byte", rating: 800, isBot: true },
      ],
    });
    const review = publicMatchReview(m, problem, CREATED_AT + DAY);
    expect(review.players[1]).toMatchObject({ isBot: true, submissions: [] });
    expect(review.players[0].submissions).toHaveLength(1);
  });
});
