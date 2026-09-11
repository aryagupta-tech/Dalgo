import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { Env } from "./env";
import { launchReady } from "./env";
import { AppError, json, parseArena } from "./core";
import { db } from "./db";
export { Coordinator } from "./coordinator";
export { MatchRoom } from "./match";
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function user(request: Request, env: Env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw new AppError("Sign in to continue.", 401);
  if (!env.SUPABASE_URL) throw new AppError("Sign-in is being connected.", 503);
  const origin = env.SUPABASE_URL.replace(/\/$/, "");
  try {
    let jwks = jwksCache.get(origin);
    if (!jwks) {
      jwks = createRemoteJWKSet(
        new URL(origin + "/auth/v1/.well-known/jwks.json"),
      );
      jwksCache.set(origin, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: origin + "/auth/v1",
      audience: "authenticated",
    });
    if (!payload.sub || !uuid.test(payload.sub))
      throw new Error("Invalid identity");
    return payload.sub;
  } catch {
    const r = await fetch(origin + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok)
      throw new AppError("Your session expired. Please sign in again.", 401);
    const data = (await r.json()) as { id: string };
    if (!uuid.test(data.id)) throw new AppError("Invalid session.", 401);
    return data.id;
  }
}
const coordinator = (env: Env) =>
  env.COORDINATOR.get(env.COORDINATOR.idFromName("global"));
async function internal(
  stub: DurableObjectStub,
  path: string,
  id?: string,
  body?: unknown,
) {
  return stub.fetch("https://internal" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(id ? { "X-Dalgo-User": id } : {}),
      "Content-Type": "application/json",
      ...(path.startsWith("/events") ? { Upgrade: "websocket" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function origins(env: Env, request: Request) {
  return [
    new URL(request.url).origin,
    ...(env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  ];
}
async function api(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.slice(4);
  if (path === "/config")
    return json({
      supabaseUrl: env.SUPABASE_URL ?? "",
      supabaseKey: env.SUPABASE_ANON_KEY ?? "",
      playEnabled: launchReady(env),
      reason: launchReady(env)
        ? ""
        : "The beta is being prepared. Explore an arena while online play gets ready.",
      dailyCapacity: launchReady(env)
        ? Math.floor(Number(env.JUDGE_DAILY_QUOTA) * 0.8)
        : null,
    });
  if (path === "/leaderboard" && request.method === "GET") {
    const arena = parseArena(url.searchParams.get("arena"));
    const mode = url.searchParams.get("mode");
    if (mode !== "human" && mode !== "bot")
      throw new AppError("Choose a rating type.");
    return json(
      await db(
        env,
        `arena_ratings?arena=eq.${arena}&mode=eq.${mode}&matches=gt.0&select=user_id,rating,matches,wins,profiles(username,display_name,avatar_url)&order=rating.desc,user_id.asc&limit=100`,
      ),
    );
  }
  let id: string;
  if (path.endsWith("/events")) {
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    )
      throw new AppError("A WebSocket upgrade is required.", 426);
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new AppError("A connection ticket is required.", 401);
    const { payload } = await jwtVerify(
      ticket,
      new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
      { audience: "dalgo-websocket", issuer: "dalgo" },
    );
    if (payload.path !== path || !payload.sub || !uuid.test(payload.sub))
      throw new AppError("Invalid connection ticket.", 401);
    id = payload.sub;
  } else id = await user(request, env);
  if (path === "/socket-ticket" && request.method === "POST") {
    const b = (await request.json()) as { path: string };
    if (!/^\/queue\/events$|^\/matches\/[a-f0-9-]{36}\/events$/.test(b.path))
      throw new AppError("Invalid connection path.");
    const ticket = await new SignJWT({ path: b.path })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(id)
      .setIssuer("dalgo")
      .setAudience("dalgo-websocket")
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY));
    return json({ ticket });
  }
  if (path === "/ratings" && request.method === "GET")
    return json(
      await db(
        env,
        `arena_ratings?user_id=eq.${id}&select=arena,mode,rating,matches,wins,losses,draws`,
      ),
    );
  if (path === "/history" && request.method === "GET") {
    const rows = await db<any[]>(
      env,
      `matches?select=id,arena,mode,started_at,ended_at,result,participants!inner(user_id),rating_ledger(user_id,delta)&participants.user_id=eq.${id}&order=ended_at.desc&limit=50`,
    );
    return json(
      rows.map((r) => ({
        ...r,
        result: {
          winnerId: r.result.winner_id ?? null,
          reason: r.result.reason,
          deltas: Object.fromEntries(
            r.rating_ledger.map((l: any) => [l.user_id, l.delta]),
          ),
        },
      })),
    );
  }
  if (path === "/queue/events")
    return internal(coordinator(env), "/events?userId=" + id);
  if (path === "/queue") {
    if (request.method === "GET")
      return internal(coordinator(env), "/status?userId=" + id);
    const body = (await request.json()) as any;
    if (!body.requestId || !uuid.test(body.requestId))
      throw new AppError("A valid request identifier is required.");
    if (request.method === "POST")
      return internal(coordinator(env), "/join", id, {
        userId: id,
        arena: body.arena,
        requestId: body.requestId,
      });
    if (request.method === "DELETE")
      return internal(coordinator(env), "/cancel", id, {
        userId: id,
        requestId: body.requestId,
      });
  }
  const match = path.match(
    /^\/matches\/([a-f0-9-]{36})(?:\/(run|submit|resign|events))?$/,
  );
  if (match) {
    if (!uuid.test(match[1])) throw new AppError("Invalid match.", 400);
    const action = match[2] ?? "view";
    if (
      (["run", "submit", "resign"].includes(action) &&
        request.method !== "POST") ||
      (["view", "events"].includes(action) && request.method !== "GET")
    )
      throw new AppError("Method not allowed.", 405);
    const stub = env.MATCHES.get(env.MATCHES.idFromName(match[1]));
    return internal(
      stub,
      "/" + action,
      id,
      ["run", "submit"].includes(action)
        ? await request.json()
        : action === "resign"
          ? {}
          : undefined,
    );
  }
  throw new AppError("Not found.", 404);
}
async function limitBody(request: Request) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 512000) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new Request(request, { body: bytes });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const origin = request.headers.get("Origin");
    if (origin && !origins(env, request).includes(origin))
      return json({ error: "This origin is not allowed." }, 403);
    if (Number(request.headers.get("Content-Length") ?? 0) > 512000)
      return json({ error: "Request is too large." }, 413);
    let response: Response;
    try {
      if (request.method === "POST" || request.method === "DELETE")
        request = await limitBody(request);
      response =
        request.method === "OPTIONS"
          ? new Response(null, { status: 204 })
          : await api(request, env);
    } catch (e) {
      response = json(
        {
          error:
            e instanceof AppError
              ? e.message
              : "The service is temporarily unavailable. Please try again.",
        },
        e instanceof AppError ? e.status : 503,
      );
      console.error(
        JSON.stringify({
          event: "api_error",
          path: url.pathname,
          status: response.status,
        }),
      );
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (env.SUPABASE_SERVICE_ROLE_KEY)
      ctx.waitUntil(
        db(env, "rpc/purge_submission_sources", {
          method: "POST",
          body: "{}",
        }).catch(() =>
          console.error(JSON.stringify({ event: "retention_failed" })),
        ),
      );
  },
} satisfies ExportedHandler<Env>;
