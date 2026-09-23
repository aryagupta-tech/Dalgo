import type { Problem } from "../shared/types";
import type { PublicMatchReview } from "../shared/review";
import { AppError, publicProblem, type MatchRecord } from "./core";

const SOURCE_RETENTION_MS = 30 * 86_400_000;

/** A deliberate public projection. Never spread a stored match or submission. */
export function publicMatchReview(
  match: MatchRecord,
  problem: Problem,
  now: number,
): PublicMatchReview {
  if (!match.result?.settled)
    throw new AppError("Match review is not available yet.", 404);

  const codeStatus = !match.codeRevealAllowed
    ? "not_available"
    : now >= match.createdAt + SOURCE_RETENTION_MS
      ? "expired"
      : "available";

  return {
    id: match.id,
    arena: match.arena,
    mode: match.mode,
    startsAt: match.startsAt,
    endsAt: match.terminalAt ?? match.endsAt,
    problem: publicProblem(problem),
    result: {
      winnerId: match.result.winnerId,
      reason: match.result.reason,
      deltas: { ...match.result.deltas },
      settled: true,
    },
    codeStatus,
    players: match.players.map((player) => ({
      id: player.id,
      name: player.name,
      ...(player.avatar ? { avatar: player.avatar } : {}),
      rating: player.rating,
      isBot: Boolean(player.isBot),
      submissions: player.isBot
        ? []
        : match.submissions
            .filter(
              (submission) =>
                submission.userId === player.id && submission.kind === "submit",
            )
            .sort((a, b) => a.sequence - b.sequence)
            .map((submission) => ({
              id: submission.id,
              language: submission.language,
              verdict: submission.verdict,
              receivedAt: submission.receivedAt,
              sequence: submission.sequence,
              ...(codeStatus === "available" && submission.source
                ? { source: submission.source }
                : {}),
            })),
    })),
  };
}
