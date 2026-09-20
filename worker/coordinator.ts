import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { launchReady, testerUserIds } from "./env";
import {
  configuredAttemptLimits,
  executionReservation,
  sameAttemptLimits,
} from "./limits";
import {
  admissionStatus,
  ADMISSION_WINDOW_MS,
  AdmissionRateLimitError,
  recordAdmission,
} from "./admission";
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
import {
  findFriendByPublicId,
  getFriendIdentity,
  getPlayer,
  persistFriendChallenge,
  recentProblems,
} from "./db";
import { creditSpent } from "./judge";
import { codeboxHealthy, usesCodebox } from "./codebox";
import {
  ARENAS,
  DEFAULT_ATTEMPT_LIMITS,
  type AttemptLimits,
  type Arena,
  type FriendChallenge,
  type FriendChallengeView,
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
  attemptLimits?: AttemptLimits;
}
interface Reservation {
  remaining: number;
  creditCost?: number;
  userIds: string[];
  budgets: Record<string, { base: number; retries: number }>;
}
interface CoordinatorState {
  admissions: Record<string, number[]>;
  entries: Record<string, Entry>;
  reservations: Record<string, Reservation>;
  day: string;
  spent: number;
  leases: Record<string, { until: number; reservation: string }>;
  charged: Record<string, number>;
  lastReconciled: number;
  healthy: boolean;
  provider?: string;
  assignments: Record<
    string,
    { record: MatchRecord; reservationKeys: string[] }
  >;
  challenges: Record<string, FriendChallenge>;
  challengeAuditPending: Record<string, true>;
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
        admissions: {},
        entries: {},
        reservations: {},
        day: "",
        spent: 0,
        leases: {},
        charged: {},
        lastReconciled: 0,
        healthy: false,
        assignments: {},
        challenges: {},
        challengeAuditPending: {},
      };
      this.data.admissions ??= {};
      this.data.challenges ??= {};
      this.data.challengeAuditPending ??= {};
      if (this.data.provider !== (env.JUDGE_PROVIDER ?? "codebox")) {
        this.data.provider = env.JUDGE_PROVIDER ?? "codebox";
        this.data.healthy = false;
        this.data.lastReconciled = 0;
      }
      // Legacy queue entries predate configurable limits and keep the original
      // policy. Persist their migration before a later deployment changes it.
      let migrated = false;
      for (const entry of Object.values(this.data.entries)) {
        if (!entry.attemptLimits) {
          entry.attemptLimits = { ...DEFAULT_ATTEMPT_LIMITS };
          migrated = true;
        }
      }
      for (const reservation of Object.values(this.data.reservations)) {
        if (reservation.creditCost === undefined) {
          reservation.creditCost = this.cost();
          migrated = true;
        }
      }
      if (migrated) await this.save();
    });
  }
  private async save() {
    await this.ctx.storage.put("state", this.data);
  }
  private challengeSnapshot(userId: string): FriendChallengeView {
    const all = Object.values(this.data.challenges)
      .filter(
        (challenge) =>
          challenge.challenger.id === userId ||
          challenge.challenged.id === userId,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      serverNow: Date.now(),
      incoming: all.filter(
        (challenge) =>
          challenge.status === "open" && challenge.challenged.id === userId,
      ),
      outgoing: all.filter(
        (challenge) =>
          challenge.status === "open" && challenge.challenger.id === userId,
      ),
      recent: all
        .filter((challenge) => challenge.status !== "open")
        .slice(0, 20),
      ...(this.data.entries[userId]?.matchId
        ? { currentMatchId: this.data.entries[userId].matchId }
        : {}),
    };
  }
  private broadcastChallenges(userId: string) {
    for (const ws of this.ctx.getWebSockets(userId)) {
      try {
        ws.send(
          JSON.stringify({
            type: "challenges",
            data: this.challengeSnapshot(userId),
          }),
        );
      } catch {}
    }
  }
  private openChallengeFor(userId: string) {
    return Object.values(this.data.challenges).find(
      (challenge) =>
        challenge.status === "open" &&
        (challenge.challenger.id === userId ||
          challenge.challenged.id === userId),
    );
  }
  private userBusy(userId: string) {
    return (
      Boolean(this.data.entries[userId]) ||
      Object.values(this.data.reservations).some((reservation) =>
        reservation.userIds.includes(userId),
      )
    );
  }
  private async expireChallenges() {
    const now = Date.now();
    const expired = Object.values(this.data.challenges).filter(
      (challenge) => challenge.status === "open" && challenge.expiresAt <= now,
    );
    if (!expired.length) return;
    for (const challenge of expired) {
      challenge.status = "expired";
      challenge.respondedAt = now;
      this.data.challengeAuditPending[challenge.id] = true;
    }
    await this.save();
    for (const challenge of expired) {
      await this.auditChallenge(challenge);
      this.broadcastChallenges(challenge.challenger.id);
      this.broadcastChallenges(challenge.challenged.id);
    }
  }
  private async auditChallenge(challenge: FriendChallenge) {
    try {
      await persistFriendChallenge(this.env, challenge);
      if (this.data.challengeAuditPending[challenge.id]) {
        delete this.data.challengeAuditPending[challenge.id];
        await this.save();
      }
    } catch (error) {
      this.data.challengeAuditPending[challenge.id] = true;
      await this.save();
      console.error(
        JSON.stringify({
          event: "friend_challenge_audit_failed",
          challengeId: challenge.id,
          message: (error as Error).message,
        }),
      );
    }
  }
  private async retryChallengeAudits() {
    for (const id of Object.keys(this.data.challengeAuditPending)) {
      const challenge = this.data.challenges[id];
      if (!challenge) {
        delete this.data.challengeAuditPending[id];
        continue;
      }
      await this.auditChallenge(challenge);
    }
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
    for (const [id, timestamps] of Object.entries(this.data.admissions)) {
      const recent = timestamps.filter(
        (time) => time > now - ADMISSION_WINDOW_MS,
      );
      if (recent.length) this.data.admissions[id] = recent;
      else delete this.data.admissions[id];
    }
    for (const [id, l] of Object.entries(this.data.leases))
      if (l.until < now) delete this.data.leases[id];
    for (const [id, challenge] of Object.entries(this.data.challenges))
      if (
        challenge.status !== "open" &&
        !this.data.challengeAuditPending[id] &&
        (challenge.respondedAt ?? challenge.createdAt) < now - 86_400_000
      )
        delete this.data.challenges[id];
  }
  private cap() {
    return Math.floor(Number(this.env.JUDGE_DAILY_QUOTA) * 0.8);
  }
  private cost() {
    if (usesCodebox(this.env)) return 1;
    return Number(this.env.JUDGE_CREDIT_COST) || 1;
  }
  private activeMatches() {
    return Object.keys(this.data.reservations).filter(
      (id) => !this.data.entries[id],
    ).length;
  }
  private serverFull() {
    return (
      this.activeMatches() >= 1 || Object.keys(this.data.leases).length > 0
    );
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
          attemptLimits: e.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS,
          ...(e.status === "waiting" &&
          usesCodebox(this.env) &&
          (!this.data.healthy || this.serverFull())
            ? {
                message: this.data.healthy
                  ? "Waiting for execution capacity. Your search is saved; the current match must finish first."
                  : "The execution server is unavailable. Your search is saved while it recovers.",
              }
            : {}),
          ...(e.matchId ? { matchId: e.matchId } : {}),
        }
      : {
          status: "idle",
          serverNow: Date.now(),
          ...(admissionStatus(this.env, userId).canJoin
            ? {}
            : { message: admissionStatus(this.env, userId).reason }),
        };
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
      if (usesCodebox(this.env)) await codeboxHealthy(this.env);
      else
        this.data.spent = Math.max(
          this.data.spent,
          await creditSpent(this.env),
        );
      this.data.lastReconciled = Date.now();
      this.data.healthy = true;
      console.log(
        JSON.stringify({
          event: usesCodebox(this.env)
            ? "execution_health"
            : "quota_reconciled",
          spent: this.data.spent,
          reserved: Object.values(this.data.reservations).reduce(
            (sum, r) => sum + r.remaining,
            0,
          ),
          remaining: usesCodebox(this.env)
            ? null
            : Math.max(0, this.remaining()),
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
        await this.expireChallenges();
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
          pair[1].send(
            JSON.stringify({
              type: "challenges",
              data: this.challengeSnapshot(userId),
            }),
          );
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        if (url.pathname === "/status")
          return json(this.snapshot(url.searchParams.get("userId")!));
        if (url.pathname === "/challenge-status")
          return json(this.challengeSnapshot(url.searchParams.get("userId")!));
        if (url.pathname === "/challenge-create") {
          const userId = body.userId as string;
          const requestId = body.requestId as string;
          const existing = this.data.challenges[requestId];
          if (existing) {
            if (existing.challenger.id !== userId)
              throw new AppError(
                "That challenge identifier is already in use.",
                409,
              );
            return json(existing);
          }
          const arena = parseArena(body.arena);
          const admission = admissionStatus(this.env, userId);
          if (!admission.canJoin) throw new AppError(admission.reason, 403);
          if (this.userBusy(userId))
            throw new AppError(
              "Finish or leave your current match first.",
              409,
            );
          if (this.openChallengeFor(userId))
            throw new AppError(
              "Respond to your current friend challenge first.",
              409,
            );
          const challenged = await findFriendByPublicId(
            this.env,
            body.friendPublicId as string,
          );
          if (!challenged)
            throw new AppError("No player was found with that Dalgo ID.", 404);
          if (challenged.id === userId)
            throw new AppError("You cannot challenge yourself.", 400);
          if (!admissionStatus(this.env, challenged.id).canJoin)
            throw new AppError(
              "This player is not available for live challenges.",
              409,
            );
          if (
            this.userBusy(challenged.id) ||
            this.openChallengeFor(challenged.id)
          )
            throw new AppError(
              "This player already has a match or challenge open.",
              409,
            );
          const challenger = await getFriendIdentity(this.env, userId);
          const now = Date.now();
          const challenge: FriendChallenge = {
            id: requestId,
            arena,
            status: "open",
            challenger,
            challenged,
            createdAt: now,
            expiresAt: now + 10 * 60_000,
          };
          this.data.challenges[challenge.id] = challenge;
          this.data.challengeAuditPending[challenge.id] = true;
          await this.save();
          await this.auditChallenge(challenge);
          this.broadcastChallenges(challenger.id);
          this.broadcastChallenges(challenged.id);
          await this.schedule();
          return json(challenge, 201);
        }
        if (url.pathname === "/challenge-respond") {
          const userId = body.userId as string;
          const challenge = this.data.challenges[body.challengeId as string];
          if (!challenge) throw new AppError("Challenge not found.", 404);
          if (body.action === "accept" && challenge.status === "accepted") {
            if (challenge.challenged.id !== userId)
              throw new AppError(
                "Only the invited player can accept this challenge.",
                403,
              );
            return json(challenge);
          }
          if (challenge.status !== "open")
            throw new AppError("This challenge is no longer open.", 409);
          if (body.action === "cancel") {
            if (challenge.challenger.id !== userId)
              throw new AppError(
                "Only the challenger can cancel this challenge.",
                403,
              );
            challenge.status = "cancelled";
          } else if (body.action === "decline") {
            if (challenge.challenged.id !== userId)
              throw new AppError(
                "Only the invited player can decline this challenge.",
                403,
              );
            challenge.status = "declined";
          } else if (body.action === "accept") {
            if (challenge.challenged.id !== userId)
              throw new AppError(
                "Only the invited player can accept this challenge.",
                403,
              );
            const ids = [challenge.challenger.id, challenge.challenged.id];
            for (const id of ids) {
              const admission = admissionStatus(this.env, id);
              if (!admission.canJoin) throw new AppError(admission.reason, 403);
              if (this.userBusy(id))
                throw new AppError(
                  "One of you already has a queue or match open.",
                  409,
                );
            }
            if (Date.now() - this.data.lastReconciled > 5000)
              await this.reconcile();
            if (!this.data.healthy)
              throw new AppError("The execution server is unavailable.", 503);
            if (usesCodebox(this.env) && this.serverFull())
              throw new AppError(
                "The execution server is busy. Try again shortly.",
                503,
              );
            const attemptLimits = configuredAttemptLimits(this.env)!;
            const reserved = executionReservation(attemptLimits, this.cost());
            if (!usesCodebox(this.env) && this.remaining() < reserved.total * 2)
              throw new AppError(
                "There is not enough execution capacity for this match.",
                503,
              );
            const players = await Promise.all(
              ids.map((id) =>
                getPlayer(this.env, id, challenge.arena, "human"),
              ),
            );
            const entries = ids.map((id, index): Entry => ({
              userId: id,
              arena: challenge.arena,
              joinedAt: challenge.createdAt,
              rating: players[index].rating,
              player: players[index],
              requestId: challenge.id,
              status: "assigning",
              attemptLimits: { ...attemptLimits },
            }));
            const nextAdmissions = Object.fromEntries(
              entries.map((entry) => [
                entry.userId,
                recordAdmission(this.data.admissions[entry.userId], Date.now()),
              ]),
            );
            for (const entry of entries) {
              this.data.admissions[entry.userId] = nextAdmissions[entry.userId];
              this.data.entries[entry.userId] = entry;
              this.data.reservations[entry.userId] = {
                remaining: reserved.total,
                creditCost: this.cost(),
                userIds: [entry.userId],
                budgets: {
                  [entry.userId]: {
                    base: reserved.base,
                    retries: reserved.retries,
                  },
                },
              };
            }
            challenge.status = "accepted";
            challenge.respondedAt = Date.now();
            this.data.challengeAuditPending[challenge.id] = true;
            challenge.matchId = await this.createMatch(entries, challenge);
            await this.auditChallenge(challenge);
            this.broadcastChallenges(challenge.challenger.id);
            this.broadcastChallenges(challenge.challenged.id);
            return json(challenge);
          } else {
            throw new AppError("Choose accept, decline, or cancel.");
          }
          challenge.respondedAt = Date.now();
          this.data.challengeAuditPending[challenge.id] = true;
          await this.save();
          await this.auditChallenge(challenge);
          this.broadcastChallenges(challenge.challenger.id);
          this.broadcastChallenges(challenge.challenged.id);
          await this.schedule();
          return json(challenge);
        }
        if (url.pathname === "/join") {
          const userId = body.userId as string;
          // A reconnect or a second tab must recover the original assignment even
          // when new admissions have since been paused or the tester list changed.
          if (this.data.entries[userId]) return json(this.snapshot(userId));
          if (this.openChallengeFor(userId))
            throw new AppError(
              "Respond to or cancel your friend challenge before joining the queue.",
              409,
            );
          const arena = parseArena(body.arena);
          const admission = admissionStatus(this.env, userId);
          if (!admission.canJoin)
            throw new AppError(
              admission.reason,
              admission.mode === "staging" &&
                !testerUserIds(this.env).has(userId.toLowerCase())
                ? 403
                : 503,
            );
          this.data.admissions[userId] = recordAdmission(
            this.data.admissions[userId],
            Date.now(),
          );
          // Persist before quota reconciliation or profile requests: failed new
          // searches still consume admission budget, while duplicate joins do not.
          await this.save();
          if (Date.now() - this.data.lastReconciled > 60000)
            await this.reconcile();
          if (!this.data.healthy)
            throw new AppError(
              "We are checking judging capacity. Try again shortly.",
              503,
            );
          const attemptLimits = configuredAttemptLimits(this.env)!;
          const reserved = executionReservation(attemptLimits, this.cost());
          if (
            usesCodebox(this.env)
              ? this.serverFull() ||
                Object.values(this.data.entries).filter(
                  (e) => e.status === "waiting",
                ).length >= 2
              : this.remaining() < reserved.total
          )
            return json({
              status: "capacity",
              serverNow: Date.now(),
              message: usesCodebox(this.env)
                ? "The execution server is busy. Please try again when the current match finishes."
                : "Today’s free match capacity is full. Active matches can finish; please return after the daily reset.",
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
            attemptLimits: { ...attemptLimits },
          };
          this.data.reservations[userId] = {
            remaining: reserved.total,
            creditCost: this.cost(),
            userIds: [userId],
            budgets: {
              [userId]: { base: reserved.base, retries: reserved.retries },
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
            return json(
              usesCodebox(this.env) &&
                this.data.leases[jobId].reservation === matchId
                ? { ok: true }
                : { ok: false, reason: "already_running" },
            );
          if (this.data.charged[jobId])
            return json({ ok: false, reason: "already_spent" });
          if (
            Object.keys(this.data.leases).length >=
            Number(this.env.JUDGE_CONCURRENCY)
          )
            return json({ ok: false, reason: "busy" });
          const cost = r.creditCost ?? this.cost();
          const budget = r.budgets[body.userId];
          const bucket = body.retry ? "retries" : "base";
          if (!budget || budget[bucket] < cost || r.remaining < cost)
            return json({ ok: false, reason: "quota" });
          budget[bucket] -= cost;
          r.remaining -= cost;
          if (!usesCodebox(this.env)) this.data.spent += cost;
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
            remaining: usesCodebox(this.env)
              ? null
              : Math.max(0, this.remaining()),
            activeMatches: Object.keys(this.data.reservations).filter(
              (id) => !this.data.entries[id],
            ).length,
          });
        throw new AppError("Not found.", 404);
      });
    } catch (e) {
      const response = json(
        { error: (e as Error).message },
        e instanceof AppError ? e.status : 500,
      );
      if (e instanceof AdmissionRateLimitError)
        response.headers.set("Retry-After", String(e.retryAfter));
      return response;
    }
  }
  private async releaseIneligibleWaiting() {
    const removed: string[] = [];
    for (const [userId, entry] of Object.entries(this.data.entries)) {
      if (
        entry.status !== "waiting" ||
        admissionStatus(this.env, userId).canJoin
      )
        continue;
      delete this.data.entries[userId];
      delete this.data.reservations[userId];
      removed.push(userId);
    }
    if (removed.length) {
      await this.save();
      for (const userId of removed) this.broadcast(userId);
    }
  }
  private async createMatch(
    entries: Entry[],
    acceptedChallenge?: FriendChallenge,
  ): Promise<string> {
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
      attemptLimits: {
        ...(entries[0].attemptLimits ?? DEFAULT_ATTEMPT_LIMITS),
      },
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
      creditCost:
        this.data.reservations[entries[0].userId].creditCost ?? this.cost(),
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
    if (acceptedChallenge) acceptedChallenge.matchId = id;
    await this.save();
    await this.finishAssignment(id);
    return id;
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
    // Recheck before pairing as well as on alarms: a new join must not match
    // with a tester whose eligibility changed while they were waiting.
    await this.releaseIneligibleWaiting();
    if (usesCodebox(this.env)) {
      if (Date.now() - this.data.lastReconciled > 5000) await this.reconcile();
      if (!this.data.healthy || this.serverFull()) return;
    }
    const now = Date.now();
    const waiting = Object.values(this.data.entries)
      .filter((e) => e.status === "waiting")
      .sort((a, b) => a.joinedAt - b.joinedAt);
    for (const a of waiting) {
      if (usesCodebox(this.env) && this.serverFull()) break;
      if (a.status !== "waiting") continue;
      const b = waiting
        .filter(
          (b) =>
            b.userId !== a.userId &&
            b.status === "waiting" &&
            sameAttemptLimits(
              a.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS,
              b.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS,
            ) &&
            this.data.reservations[a.userId]?.creditCost ===
              this.data.reservations[b.userId]?.creditCost &&
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
    const openChallenges = Object.values(this.data.challenges).filter(
      (challenge) => challenge.status === "open",
    );
    if (
      !Object.keys(this.data.entries).length &&
      !Object.keys(this.data.assignments).length &&
      !openChallenges.length &&
      !Object.keys(this.data.challengeAuditPending).length
    ) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const waiting = Object.values(this.data.entries).some(
      (e) => e.status === "waiting",
    );
    const hasAssignments = Object.keys(this.data.assignments).length > 0;
    const hasEntries = Object.keys(this.data.entries).length > 0;
    const hasPendingAudit =
      Object.keys(this.data.challengeAuditPending).length > 0;
    const periodicDelay =
      waiting || hasAssignments
        ? 1000
        : hasEntries || hasPendingAudit
          ? 60000
          : Number.POSITIVE_INFINITY;
    const expiryDelay = openChallenges.length
      ? Math.max(
          250,
          Math.min(...openChallenges.map((c) => c.expiresAt)) - Date.now(),
        )
      : Number.POSITIVE_INFINITY;
    await this.ctx.storage.setAlarm(
      Date.now() + Math.min(periodicDelay, expiryDelay),
    );
  }
  async alarm() {
    await this.serial.run(async () => {
      try {
        this.roll();
        await this.expireChallenges();
        await this.retryChallengeAudits();
        await this.releaseIneligibleWaiting();
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
