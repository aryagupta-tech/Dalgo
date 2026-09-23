import type { Env } from "./env";
import { supabaseSecretKey } from "./env";
import { AppError, json } from "./core";
import { db } from "./db";
import type {
  PublicPlayerHistory,
  PublicPlayerIdentity,
  PublicPlayerMatch,
  PublicPlayerProfile,
  RankedRating,
} from "../shared/public-player";
import type { Arena, Mode } from "../shared/types";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const arenas: Arena[] = ["easy", "medium", "hard"];
const modes: Mode[] = ["human", "bot"];
const pageSize = 20;
const isoTimestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

interface ProfileRow {
  id: string;
  username: string;
  username_configured_at: string | null;
  display_name: string;
  avatar_url: string | null;
}
interface RatingRow {
  arena: Arena;
  mode: Mode;
  rating: number;
  rd: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}
interface MatchRow {
  id: string;
  arena: Arena;
  mode: Mode;
  ended_at: string;
  result: { winner_id?: string | null; reason?: string };
}

function identity(row: ProfileRow): PublicPlayerIdentity {
  return {
    id: row.id,
    username: row.username_configured_at ? row.username : "",
    name: row.display_name || row.username,
    ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
  };
}

async function rankedCount(env: Env, playerId: string, row: RatingRow) {
  if (!row.matches) return null;
  const key = supabaseSecretKey(env);
  if (!env.SUPABASE_URL || !key)
    throw new AppError("Player rankings are temporarily unavailable.", 503);
  const query = new URLSearchParams({
    arena: `eq.${row.arena}`,
    mode: `eq.${row.mode}`,
    matches: "gt.0",
    or: `(rating.gt.${row.rating},and(rating.eq.${row.rating},user_id.lt.${playerId}))`,
    select: "user_id",
    limit: "1",
  });
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/arena_ratings?${query}`,
    {
      headers: {
        apikey: key,
        ...(key.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${key}` }),
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  const count = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!response.ok || !count)
    throw new AppError("Player rankings are temporarily unavailable.", 503);
  return Number(count[1]) + 1;
}

async function profile(
  env: Env,
  playerId: string,
): Promise<PublicPlayerProfile> {
  const profiles = await db<ProfileRow[]>(
    env,
    `profiles?id=eq.${playerId}&select=id,username,username_configured_at,display_name,avatar_url&limit=1`,
  );
  if (!profiles[0]) throw new AppError("Player not found.", 404);
  const ratings = await db<RatingRow[]>(
    env,
    `arena_ratings?user_id=eq.${playerId}&select=arena,mode,rating,rd,matches,wins,losses,draws`,
  );
  const ordered = arenas.flatMap((arena) =>
    modes.flatMap((mode) =>
      ratings.filter((r) => r.arena === arena && r.mode === mode),
    ),
  );
  const ranks = await Promise.all(
    ordered.map((row) => rankedCount(env, playerId, row)),
  );
  const ranked: RankedRating[] = ordered.map((row, index) => ({
    ...row,
    rank: ranks[index],
  }));
  return {
    player: identity(profiles[0]),
    ratings: ranked,
    record: ranked.reduce(
      (total, row) => ({
        matches: total.matches + row.matches,
        wins: total.wins + row.wins,
        losses: total.losses + row.losses,
        draws: total.draws + row.draws,
      }),
      { matches: 0, wins: 0, losses: 0, draws: 0 },
    ),
  };
}

function parseCursor(value: string | null) {
  if (!value) return null;
  const [date, id, extra] = value.split("|");
  if (
    extra ||
    !date ||
    !uuid.test(id || "") ||
    !isoTimestamp.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    throw new AppError("Invalid history cursor.", 400);
  return { date, id };
}

async function history(
  env: Env,
  playerId: string,
  rawCursor: string | null,
): Promise<PublicPlayerHistory> {
  const exists = await db<{ id: string }[]>(
    env,
    `profiles?id=eq.${playerId}&select=id&limit=1`,
  );
  if (!exists[0]) throw new AppError("Player not found.", 404);
  const cursor = parseCursor(rawCursor);
  const older = cursor
    ? `&or=${encodeURIComponent(`(ended_at.lt.${cursor.date},and(ended_at.eq.${cursor.date},id.lt.${cursor.id}))`)}`
    : "";
  const rows = await db<MatchRow[]>(
    env,
    `matches?select=id,arena,mode,ended_at,result,participants!inner(user_id)&participants.user_id=eq.${playerId}${older}&order=ended_at.desc,id.desc&limit=${pageSize + 1}`,
  );
  const page = rows.slice(0, pageSize);
  const matchIds = page.map((row) => row.id);
  const [participants, ledger] = await Promise.all([
    matchIds.length
      ? db<{ match_id: string; user_id: string | null }[]>(
          env,
          `participants?match_id=in.(${matchIds.join(",")})&select=match_id,user_id`,
        )
      : Promise.resolve([]),
    matchIds.length
      ? db<{ match_id: string; user_id: string; delta: number }[]>(
          env,
          `rating_ledger?match_id=in.(${matchIds.join(",")})&user_id=eq.${playerId}&select=match_id,user_id,delta`,
        )
      : Promise.resolve([]),
  ]);
  const opponentIds = [
    ...new Set(
      participants
        .map((p) => p.user_id)
        .filter((id): id is string => !!id && id !== playerId),
    ),
  ];
  const opponents = opponentIds.length
    ? await db<ProfileRow[]>(
        env,
        `profiles?id=in.(${opponentIds.join(",")})&select=id,username,username_configured_at,display_name,avatar_url`,
      )
    : [];
  const opponentById = new Map(opponents.map((row) => [row.id, row]));
  const opponentByMatch = new Map(
    participants
      .filter((row) => row.user_id && row.user_id !== playerId)
      .map((row) => [row.match_id, row.user_id!]),
  );
  const deltaByMatch = new Map(ledger.map((row) => [row.match_id, row.delta]));
  const matches: PublicPlayerMatch[] = page.map((row) => {
    const opponentId = opponentByMatch.get(row.id);
    const opponent = opponentId ? opponentById.get(opponentId) : undefined;
    const outcome =
      row.result.reason === "void"
        ? "void"
        : !row.result.winner_id
          ? "draw"
          : row.result.winner_id === playerId
            ? "win"
            : "loss";
    return {
      id: row.id,
      arena: row.arena,
      mode: row.mode,
      endedAt: row.ended_at,
      outcome,
      ratingDelta: deltaByMatch.get(row.id) ?? 0,
      opponent: opponent ? identity(opponent) : null,
    };
  });
  const last = page.at(-1);
  return {
    matches,
    nextCursor:
      rows.length > pageSize && last ? `${last.ended_at}|${last.id}` : null,
  };
}

/** Public, server-whitelisted player data; call this before bearer authentication. */
export async function publicPlayerResponse(
  path: string,
  url: URL,
  env: Env,
): Promise<Response | null> {
  const match = path.match(/^\/players\/([^/]+)(\/matches)?$/);
  if (!match) return null;
  if (!uuid.test(match[1])) throw new AppError("Player not found.", 404);
  if (match[2])
    return json(await history(env, match[1], url.searchParams.get("cursor")));
  return json(await profile(env, match[1]));
}
