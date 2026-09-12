import { supabaseSecretKey, type Env } from "./env";
import type { Arena, Mode, Player } from "../shared/types";
import type { MatchRecord } from "./core";
import { AppError } from "./core";
export async function db<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = supabaseSecretKey(env);
  if (!env.SUPABASE_URL || !key)
    throw new AppError("Accounts and match history are being connected.", 503);
  const r = await fetch(
    env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path,
    {
      ...init,
      headers: {
        apikey: key,
        ...(key.startsWith("sb_secret_")
          ? {}
          : { Authorization: "Bearer " + key }),
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!r.ok) {
    console.error(
      JSON.stringify({
        event: "database_error",
        status: r.status,
        operation: path.split("?")[0],
      }),
    );
    throw new AppError(
      "Match history is temporarily unavailable. Your result is safe and will retry.",
      503,
    );
  }
  return (
    r.status === 204 || r.headers.get("content-length") === "0"
      ? null
      : await r.json()
  ) as T;
}
export async function getPlayer(
  env: Env,
  id: string,
  arena: Arena,
  mode: Mode,
): Promise<Player> {
  const [rows, ratings] = await Promise.all([
    db<any[]>(
      env,
      `profiles?id=eq.${id}&select=id,display_name,username,avatar_url`,
    ),
    db<any[]>(
      env,
      `arena_ratings?user_id=eq.${id}&arena=eq.${arena}&mode=eq.${mode}&select=rating`,
    ),
  ]);
  if (!rows[0] || !ratings[0])
    throw new AppError(
      "Your profile is being prepared. Please try again in a moment.",
      503,
    );
  return {
    id,
    name: rows[0].display_name || rows[0].username,
    avatar: rows[0].avatar_url,
    rating: ratings[0].rating,
  };
}
export async function recentProblems(env: Env, ids: string[]) {
  const rows = await db<any[]>(
    env,
    `matches?select=problem_id,ended_at,participants!inner(user_id)&participants.user_id=in.(${ids.join(",")})&order=ended_at.desc&limit=200`,
  );
  const recent: Record<string, number> = {};
  for (const row of rows) {
    const m = row;
    if (m?.problem_id)
      recent[m.problem_id] = Math.max(
        recent[m.problem_id] ?? 0,
        Date.parse(m.ended_at),
      );
  }
  return recent;
}
export async function settle(env: Env, m: MatchRecord) {
  const r = m.result!;
  return db<{
    rating_changes: {
      user_id: string;
      before: number;
      after: number;
      delta: number;
    }[];
  }>(env, "rpc/settle_match", {
    method: "POST",
    body: JSON.stringify({
      p_match: {
        id: m.id,
        settlement_key: m.id,
        arena: m.arena,
        mode: m.mode,
        problem_id: m.problemId,
        problem_version: m.problemVersion,
        started_at: new Date(m.startsAt).toISOString(),
        ended_at: new Date(
          r.reason === "solved"
            ? (m.submissions.find(
                (s) =>
                  s.kind === "submit" &&
                  s.verdict === "accepted" &&
                  s.userId === r.winnerId,
              )?.receivedAt ??
                (m.bot?.completesAt && r.winnerId === "bot"
                  ? m.bot.completesAt
                  : (m.terminalAt ?? m.endsAt)))
            : (m.terminalAt ?? m.endsAt),
        ).toISOString(),
        result: {
          outcome: r.reason === "void" ? "void" : r.winnerId ? "win" : "draw",
          winner_id: r.winnerId,
          reason: r.reason,
        },
        participants: m.players.map((p) =>
          p.isBot
            ? { user_id: null, bot_rating: p.rating, pre_rating: p.rating }
            : { user_id: p.id, pre_rating: p.rating },
        ),
      },
    }),
  });
}
