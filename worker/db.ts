import { supabaseSecretKey, type Env } from "./env";
import type {
  Arena,
  FriendChallenge,
  FriendIdentity,
  Mode,
  Player,
} from "../shared/types";
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
    const detail = (await r.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    console.error(
      JSON.stringify({
        event: "database_error",
        status: r.status,
        operation: path.split("?")[0],
      }),
    );
    if (path === "rpc/claim_username") {
      if (r.status === 409 || detail?.code === "23505")
        throw new AppError("That username is already taken.", 409);
      if (r.status === 400 || detail?.code === "22023")
        throw new AppError(
          detail?.message || "Choose a different username.",
          400,
        );
    }
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
export async function getFriendIdentity(
  env: Env,
  id: string,
): Promise<FriendIdentity> {
  const rows = await db<any[]>(
    env,
    `profiles?id=eq.${id}&select=id,display_name,username,username_configured_at,avatar_url`,
  );
  if (!rows[0])
    throw new AppError(
      "This player profile is not ready yet. Try again in a moment.",
      503,
    );
  return {
    id: rows[0].id,
    username: rows[0].username_configured_at ? rows[0].username : "",
    usernameConfigured: Boolean(rows[0].username_configured_at),
    name: rows[0].display_name || rows[0].username,
    ...(rows[0].avatar_url ? { avatar: rows[0].avatar_url } : {}),
  };
}

export async function findFriendByUsername(
  env: Env,
  username: string,
): Promise<FriendIdentity | null> {
  const rows = await db<any[]>(
    env,
    `profiles?username=eq.${encodeURIComponent(username)}&username_configured_at=not.is.null&select=id,display_name,username,username_configured_at,avatar_url&limit=1`,
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    usernameConfigured: true,
    name: rows[0].display_name || rows[0].username,
    ...(rows[0].avatar_url ? { avatar: rows[0].avatar_url } : {}),
  };
}

export async function claimUsername(
  env: Env,
  id: string,
  username: string,
): Promise<FriendIdentity> {
  const rows = await db<any[]>(env, "rpc/claim_username", {
    method: "POST",
    body: JSON.stringify({ p_user_id: id, p_username: username }),
  });
  const row = rows[0];
  if (!row) throw new AppError("Your username could not be saved.", 503);
  return {
    id: row.id,
    username: row.username,
    usernameConfigured: true,
    name: row.display_name || row.username,
    ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
  };
}

export async function persistFriendChallenge(
  env: Env,
  challenge: FriendChallenge,
) {
  return db(env, "friend_challenges?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: challenge.id,
      challenger_id: challenge.challenger.id,
      challenged_id: challenge.challenged.id,
      arena: challenge.arena,
      status: challenge.status,
      match_id: challenge.matchId ?? null,
      created_at: new Date(challenge.createdAt).toISOString(),
      expires_at: new Date(challenge.expiresAt).toISOString(),
      responded_at: challenge.respondedAt
        ? new Date(challenge.respondedAt).toISOString()
        : null,
    }),
  });
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
