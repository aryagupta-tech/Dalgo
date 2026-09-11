import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { launchReady } from "./env";
import {
  Serial,
  AppError,
  canPair,
  chooseBot,
  chooseProblem,
  json,
  parseArena,
  type MatchRecord,
} from "./core";
import { getPlayer, recentProblems } from "./db";
import { creditSpent } from "./judge";
import {
  ARENAS,
  type Arena,
  type Player,
  type Problem,
  type QueueView,
} from "../shared/types";
import bank from "./problems.json";
interface Entry {
  userId: string;
  arena: Arena;
  joinedAt: number;
  rating: number;
  requestId: string;
  player: Player;
  status: "waiting" | "assigning" | "matched";
  matchId?: string;
}
interface Reservation {
  remaining: number;
  userIds: string[];
  budgets: Record<string, { base: number; retries: number }>;
}
interface CoordinatorState {
  entries: Record<string, Entry>;
  reservations: Record<string, Reservation>;
  day: string;
  spent: number;
  leases: Record<string, { until: number; reservation: string }>;
  charged: Record<string, number>;
  lastReconciled: number;
  healthy: boolean;
  assignments: Record<
    string,
    { record: MatchRecord; reservationKeys: string[] }
  >;
}
function dayKey(now: number, offset: number) {
  return new Date(now - offset * 3600000).toISOString().slice(0, 10);
}
export class Coordinator extends DurableObject<Env> {
  private serial = new Serial();
  private data!: CoordinatorState;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get("state")) ?? {
        entries: {},
        reservations: {},
        day: "",
        spent: 0,
        leases: {},
        charged: {},
        lastReconciled: 0,
        healthy: false,
        assignments: {},
      };
    });
  }
  private async save() {
    await this.ctx.storage.put("state", this.data);
  }
  private roll() {
    const now = Date.now(),
      day = dayKey(now, Number(this.env.JUDGE_RESET_HOUR_UTC) || 0);
    if (day !== this.data.day) {
      this.data.day = day;
      this.data.spent = 0;
      this.data.lastReconciled = 0;
      this.data.healthy = false;
      for (const [id, t] of Object.entries(this.data.charged))
        if (t < now - 172800000) delete this.data.charged[id];
    }
    for (const [id, l] of Object.entries(this.data.leases))
      if (l.until < now) delete this.data.leases[id];
  }
  private cap() {
    return Math.floor(Number(this.env.JUDGE_DAILY_QUOTA) * 0.8);
  }
  private cost() {
    return Number(this.env.JUDGE_CREDIT_COST) || 1;
  }
  private remaining() {
    return (
      this.cap() -
      this.data.spent -
      Object.values(this.data.reservations).reduce((a, r) => a + r.remaining, 0)
    );
  }
  private snapshot(userId: string): QueueView {
    const e = this.data.entries[userId];
    return e
      ? {
          status: e.status === "waiting" ? "waiting" : "matched",
          joinedAt: e.joinedAt,
          requestId: e.requestId,
          serverNow: Date.now(),
          arena: e.arena,
          ...(e.matchId ? { matchId: e.matchId } : {}),
        }
      : { status: "idle", serverNow: Date.now() };
  }
  private broadcast(userId: string) {
    for (const ws of this.ctx.getWebSockets(userId)) {
      try {
        ws.send(JSON.stringify({ type: "queue", data: this.snapshot(userId) }));
      } catch {}
    }
  }
  private async reconcile() {
    try {
      this.data.spent = Math.max(this.data.spent, await creditSpent(this.env));
      this.data.lastReconciled = Date.now();
      this.data.healthy = true;
      console.log(
        JSON.stringify({
          event: "quota_reconciled",
          spent: this.data.spent,
          reserved: Object.values(this.data.reservations).reduce(
            (sum, r) => sum + r.remaining,
            0,
          ),
          remaining: Math.max(0, this.remaining()),
        }),
      );
    } catch {
      this.data.healthy = false;
    }
    await this.save();
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.serial.run(async () => {
        this.roll();
        const url = new URL(request.url);
        const body =
          request.method === "POST" ? ((await request.json()) as any) : {};
        if (url.pathname === "/events") {
          const userId = url.searchParams.get("userId")!;
          if (this.ctx.getWebSockets(userId).length >= 3)
            throw new AppError("Too many active connections.", 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1], [userId]);
          pair[1].send(
            JSON.stringify({ type: "queue", data: this.snapshot(userId) }),
          );
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        if (url.pathname === "/status")
          return json(this.snapshot(url.searchParams.get("userId")!));
        if (url.pathname === "/join") {
          if (!launchReady(this.env))
            throw new AppError(
              "Online matches are not open yet. Explore an arena in the meantime.",
              503,
            );
          const arena = parseArena(body.arena),
            userId = body.userId as string;
          if (this.data.entries[userId]) return json(this.snapshot(userId));
          if (Date.now() - this.data.lastReconciled > 60000)
            await this.reconcile();
          if (!this.data.healthy)
            throw new AppError(
              "We are checking judging capacity. Try again shortly.",
              503,
            );
          if (this.remaining() < 10 * this.cost())
            return json({
              status: "capacity",
              serverNow: Date.now(),
              message:
                "Today’s free match capacity is full. Active matches can finish; please return after the daily reset.",
            });
          const player = await getPlayer(this.env, userId, arena, "human");
          this.data.entries[userId] = {
            userId,
            arena,
            joinedAt: Date.now(),
            rating: player.rating,
            player,
            requestId: body.requestId,
            status: "waiting",
          };
          this.data.reservations[userId] = {
            remaining: 10 * this.cost(),
            userIds: [userId],
            budgets: {
              [userId]: { base: 8 * this.cost(), retries: 2 * this.cost() },
            },
          };
          await this.save();
          await this.pairWaiting();
          await this.schedule();
          return json(this.snapshot(userId));
        }
        if (url.pathname === "/cancel") {
          const e = this.data.entries[body.userId];
          if (e?.status === "waiting" && e.requestId === body.requestId) {
            delete this.data.entries[body.userId];
            delete this.data.reservations[body.userId];
            await this.save();
            this.broadcast(body.userId);
          }
          return json(this.snapshot(body.userId));
        }
        if (url.pathname === "/lease") {
          const { jobId, matchId } = body;
          const r = this.data.reservations[matchId];
          if (!r)
            throw new AppError("This match has no execution reservation.", 409);
          if (this.data.leases[jobId])
            return json({ ok: false, reason: "already_running" });
          if (this.data.charged[jobId])
            return json({ ok: false, reason: "already_spent" });
          if (
            Object.keys(this.data.leases).length >=
            Number(this.env.JUDGE_CONCURRENCY)
          )
            return json({ ok: false, reason: "busy" });
          const budget = r.budgets[body.userId];
          const bucket = body.retry ? "retries" : "base";
          if (
            !budget ||
            budget[bucket] < this.cost() ||
            r.remaining < this.cost()
          )
            return json({ ok: false, reason: "quota" });
          budget[bucket] -= this.cost();
          r.remaining -= this.cost();
          this.data.spent += this.cost();
          this.data.charged[jobId] = Date.now();
          this.data.leases[jobId] = {
            until: Date.now() + 170000,
            reservation: matchId,
          };
          await this.save();
          return json({ ok: true });
        }
        if (url.pathname === "/release-lease") {
          delete this.data.leases[body.jobId];
          await this.save();
          return json({ ok: true });
        }
        if (url.pathname === "/settled") {
          const r = this.data.reservations[body.matchId];
          if (r) {
            for (const id of r.userIds) {
              if (this.data.entries[id]?.matchId === body.matchId)
                delete this.data.entries[id];
              this.broadcast(id);
            }
            delete this.data.reservations[body.matchId];
            await this.save();
          }
          return json({ ok: true });
        }
        if (url.pathname === "/health")
          return json({
            healthy: this.data.healthy,
            remaining: Math.max(0, this.remaining()),
            activeMatches: Object.keys(this.data.reservations).filter(
              (id) => !this.data.entries[id],
            ).length,
          });
        throw new AppError("Not found.", 404);
      });
    } catch (e) {
      return json(
        { error: (e as Error).message },
        e instanceof AppError ? e.status : 500,
      );
    }
  }
  private async createMatch(entries: Entry[]) {
    const humans: Player[] = [];
    for (const e of entries)
      humans.push(
        entries.length === 1
          ? await getPlayer(this.env, e.userId, e.arena, "bot")
          : e.player,
      );
    const arena = entries[0].arena;
    const recent = await recentProblems(
      this.env,
      entries.map((e) => e.userId),
    );
    const problem = chooseProblem(bank as Problem[], arena, recent);
    const startsAt = Date.now() + 5000;
    const bot =
      entries.length === 1
        ? chooseBot(humans[0].rating, arena, startsAt)
        : null;
    const id = crypto.randomUUID();
    const record: MatchRecord = {
      id,
      arena,
      mode: bot ? "bot" : "human",
      players: bot
        ? [
            ...humans,
            {
              id: "bot",
              name:
                bot.rating === 800
                  ? "Byte · Rookie"
                  : bot.rating === 1200
                    ? "Vector · Challenger"
                    : "Nexus · Expert",
              rating: bot.rating,
              isBot: true,
            },
          ]
        : humans,
      problemId: problem.id,
      problemVersion: problem.version,
      startsAt,
      endsAt: startsAt + ARENAS[arena].duration * 1000,
      submissions: [],
      bot,
      result: null,
      settlementComplete: false,
      archived: false,
      createdAt: Date.now(),
    };
    // Persist assignment before the remote initialization: a restart retries this same ID.
    this.data.assignments[id] = {
      record,
      reservationKeys: entries.map((e) => e.userId),
    };
    this.data.reservations[id] = {
      remaining: entries.reduce(
        (sum, e) => sum + (this.data.reservations[e.userId]?.remaining ?? 0),
        0,
      ),
      userIds: entries.map((e) => e.userId),
      budgets: Object.fromEntries(
        entries.map((e) => [
          e.userId,
          this.data.reservations[e.userId].budgets[e.userId],
        ]),
      ),
    };
    for (const e of entries) {
      delete this.data.reservations[e.userId];
      e.status = "assigning";
      e.matchId = id;
    }
    await this.save();
    await this.finishAssignment(id);
  }
  private async finishAssignment(id: string) {
    const assignment = this.data.assignments[id];
    if (!assignment) return;
    const stub = this.env.MATCHES.get(this.env.MATCHES.idFromName(id));
    const res = await stub.fetch("https://internal/init", {
      method: "POST",
      body: JSON.stringify(assignment.record),
    });
    if (!res.ok) throw new Error("Match initialization failed");
    for (const userId of assignment.reservationKeys) {
      const e = this.data.entries[userId];
      if (e) {
        e.status = "matched";
        console.log(
          JSON.stringify({
            event: "queue_assigned",
            arena: e.arena,
            mode: assignment.record.mode,
            queueMs: Math.max(0, Date.now() - e.joinedAt),
            matchId: id,
          }),
        );
        this.broadcast(userId);
      }
    }
    delete this.data.assignments[id];
    await this.save();
  }
  private async pairWaiting() {
    const now = Date.now();
    const waiting = Object.values(this.data.entries)
      .filter((e) => e.status === "waiting")
      .sort((a, b) => a.joinedAt - b.joinedAt);
    for (const a of waiting) {
      if (a.status !== "waiting") continue;
      const b = waiting
        .filter(
          (b) =>
            b.userId !== a.userId &&
            b.status === "waiting" &&
            canPair(a, b, now),
        )
        .sort(
          (x, y) =>
            Math.abs(x.rating - a.rating) - Math.abs(y.rating - a.rating) ||
            x.joinedAt - y.joinedAt,
        )[0];
      if (b) await this.createMatch([a, b]);
      else if (now - a.joinedAt >= 15000) await this.createMatch([a]);
    }
  }
  private async schedule() {
    if (
      !Object.keys(this.data.entries).length &&
      !Object.keys(this.data.assignments).length
    ) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const waiting = Object.values(this.data.entries).some(
      (e) => e.status === "waiting",
    );
    await this.ctx.storage.setAlarm(
      Date.now() +
        (waiting || Object.keys(this.data.assignments).length ? 1000 : 60000),
    );
  }
  async alarm() {
    await this.serial.run(async () => {
      try {
        this.roll();
        for (const id of Object.keys(this.data.assignments))
          await this.finishAssignment(id);
        if (launchReady(this.env)) {
          if (Date.now() - this.data.lastReconciled > 60000)
            await this.reconcile();
          await this.pairWaiting();
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            event: "coordinator_alarm_failed",
            message: (e as Error).message,
          }),
        );
      } finally {
        await this.save();
        await this.schedule();
      }
    });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send("pong");
  }
  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {}
  }
}
