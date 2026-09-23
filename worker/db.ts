import { supabaseSecretKey, type Env } from "./env";
import type {
  Arena,
  FriendChallenge,
  FriendIdentity,
  FriendRequest,
  FriendsView,
  FriendChatView,
  FriendMessage,
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
    if (
      path === "rpc/create_friend_request" ||
      path === "rpc/respond_friend_request"
    ) {
      if (detail?.code === "23505" || detail?.code === "23000")
        throw new AppError(
          detail.message || "That friend request already exists.",
          409,
        );
      if (detail?.code === "42501")
        throw new AppError(
          detail.message || "You cannot update this friend request.",
          403,
        );
      if (detail?.code === "P0002")
        throw new AppError("Friend request not found.", 404);
      if (detail?.code === "22023")
        throw new AppError(detail.message || "Invalid friend request.", 400);
    }
    if (path === "rpc/send_friend_message") {
      if (detail?.code === "42501")
        throw new AppError("This friendship is no longer available.", 403);
      if (detail?.code === "23505")
        throw new AppError("That message identifier is already in use.", 409);
      if (detail?.code === "P0001")
        throw new AppError(
          "Wait a moment before sending another message.",
          429,
        );
      if (detail?.code === "22023")
        throw new AppError(
          "Write a single-line message under 500 characters.",
          400,
        );
    }
    if (path === "rpc/claim_username") {
      if (r.status === 409 || detail?.code === "23505")
        throw new AppError("That username is already taken.", 409);
      if (r.status === 400 || detail?.code === "22023")
        throw new AppError(
          detail?.message || "Choose a different username.",
          400,
        );
    }
    if (path === "rpc/swap_profile_avatar")
      throw new AppError(
        detail?.code === "22023"
          ? "The profile picture is invalid."
          : "Your profile picture could not be saved. Try again.",
        detail?.code === "22023" ? 400 : 503,
      );
    if (
      path.startsWith("friend_requests") ||
      path.startsWith("friendships") ||
      path === "rpc/create_friend_request" ||
      path === "rpc/respond_friend_request"
    )
      throw new AppError(
        "Friends are temporarily unavailable. Please try again.",
        503,
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

type FriendRequestRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: FriendRequest["status"];
  created_at: string;
  responded_at: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
  username_configured_at: string | null;
  display_name: string;
  avatar_url: string | null;
};

function identityFromRow(row: ProfileRow): FriendIdentity {
  return {
    id: row.id,
    username: row.username_configured_at ? row.username : "",
    usernameConfigured: Boolean(row.username_configured_at),
    name: row.display_name || row.username,
    ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
  };
}

async function friendIdentities(env: Env, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, FriendIdentity>();
  const rows = await db<ProfileRow[]>(
    env,
    `profiles?id=in.(${unique.join(",")})&select=id,display_name,username,username_configured_at,avatar_url`,
  );
  return new Map(rows.map((row) => [row.id, identityFromRow(row)]));
}

function friendRequestFromRow(
  row: FriendRequestRow,
  identities: Map<string, FriendIdentity>,
): FriendRequest {
  const sender = identities.get(row.sender_id);
  const receiver = identities.get(row.receiver_id);
  if (!sender || !receiver)
    throw new AppError("A player profile is unavailable.", 503);
  return {
    id: row.id,
    status: row.status,
    sender,
    receiver,
    createdAt: Date.parse(row.created_at),
    ...(row.responded_at ? { respondedAt: Date.parse(row.responded_at) } : {}),
  };
}

export async function getFriendsView(
  env: Env,
  userId: string,
): Promise<FriendsView> {
  const [friendships, requests] = await Promise.all([
    db<
      { id: string; user_low: string; user_high: string; created_at: string }[]
    >(
      env,
      `friendships?or=(user_low.eq.${userId},user_high.eq.${userId})&select=id,user_low,user_high,created_at&order=created_at.desc`,
    ),
    db<FriendRequestRow[]>(
      env,
      `friend_requests?or=(sender_id.eq.${userId},receiver_id.eq.${userId})&status=eq.pending&select=id,sender_id,receiver_id,status,created_at,responded_at&order=created_at.desc`,
    ),
  ]);
  const identities = await friendIdentities(env, [
    ...friendships.flatMap((row) => [row.user_low, row.user_high]),
    ...requests.flatMap((row) => [row.sender_id, row.receiver_id]),
  ]);
  return {
    friends: friendships.map((row) => {
      const friendId = row.user_low === userId ? row.user_high : row.user_low;
      const friend = identities.get(friendId);
      if (!friend) throw new AppError("A friend profile is unavailable.", 503);
      return {
        id: row.id,
        friend,
        friendsSince: Date.parse(row.created_at),
      };
    }),
    incoming: requests
      .filter((row) => row.receiver_id === userId)
      .map((row) => friendRequestFromRow(row, identities)),
    outgoing: requests
      .filter((row) => row.sender_id === userId)
      .map((row) => friendRequestFromRow(row, identities)),
  };
}

type FriendMessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
function friendMessage(row: FriendMessageRow): FriendMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    text: row.body,
    sentAt: Date.parse(row.created_at),
  };
}
async function requireFriendship(
  env: Env,
  userId: string,
  friendshipId: string,
) {
  const rows = await db<{ id: string }[]>(
    env,
    `friendships?id=eq.${friendshipId}&or=(user_low.eq.${userId},user_high.eq.${userId})&select=id&limit=1`,
  );
  if (!rows.length)
    throw new AppError("This friendship is no longer available.", 403);
}
export async function getFriendChat(
  env: Env,
  userId: string,
  friendshipId: string,
): Promise<FriendChatView> {
  await requireFriendship(env, userId, friendshipId);
  const rows = await db<FriendMessageRow[]>(
    env,
    `friend_messages?friendship_id=eq.${friendshipId}&select=id,sender_id,body,created_at&order=created_at.desc,id.desc&limit=100`,
  );
  return { friendshipId, messages: rows.reverse().map(friendMessage) };
}
export async function sendFriendMessage(
  env: Env,
  userId: string,
  friendshipId: string,
  messageId: string,
  text: string,
): Promise<FriendMessage> {
  const rows = await db<FriendMessageRow[]>(env, "rpc/send_friend_message", {
    method: "POST",
    body: JSON.stringify({
      p_friendship_id: friendshipId,
      p_user_id: userId,
      p_message_id: messageId,
      p_body: text,
    }),
  });
  if (!rows[0]) throw new AppError("Message could not be sent.", 503);
  return friendMessage(rows[0]);
}
export async function removeFriendship(
  env: Env,
  userId: string,
  friendshipId: string,
): Promise<void> {
  await requireFriendship(env, userId, friendshipId);
  await db(
    env,
    `friendships?id=eq.${friendshipId}&or=(user_low.eq.${userId},user_high.eq.${userId})`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
}

export async function createFriendRequest(
  env: Env,
  userId: string,
  username: string,
  requestId: string,
): Promise<FriendRequest> {
  const target = await findFriendByUsername(env, username);
  if (!target)
    throw new AppError("No player was found with that username.", 404);
  if (target.id === userId)
    throw new AppError("You cannot send a friend request to yourself.", 400);
  const rows = await db<FriendRequestRow[]>(env, "rpc/create_friend_request", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId,
      p_target_id: target.id,
      p_request_id: requestId,
    }),
  });
  if (!rows[0]) throw new AppError("Friend request could not be sent.", 503);
  const sender = await getFriendIdentity(env, userId);
  return friendRequestFromRow(
    rows[0],
    new Map([
      [sender.id, sender],
      [target.id, target],
    ]),
  );
}

export async function respondFriendRequest(
  env: Env,
  userId: string,
  requestId: string,
  action: "accept" | "decline" | "cancel",
): Promise<FriendRequest> {
  const rows = await db<FriendRequestRow[]>(env, "rpc/respond_friend_request", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId,
      p_request_id: requestId,
      p_action: action,
    }),
  });
  if (!rows[0]) throw new AppError("Friend request could not be updated.", 503);
  const identities = await friendIdentities(env, [
    rows[0].sender_id,
    rows[0].receiver_id,
  ]);
  return friendRequestFromRow(rows[0], identities);
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
