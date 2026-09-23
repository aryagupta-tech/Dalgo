import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { EXECUTION_RETRY_LIMIT } from "./limits";
import {
  adjudicate,
  AppError,
  json,
  makeResult,
  MAX_JUDGE_MS,
  publicProblem,
  Serial,
  type MatchRecord,
} from "./core";
import { db, settle } from "./db";
import { execute } from "./judge";
import {
  CODEBOX_POLL_MS,
  createExecution,
  pollExecution,
  usesCodebox,
} from "./codebox";
import {
  LANGUAGES,
  DEFAULT_ATTEMPT_LIMITS,
  type MatchView,
  type MatchChatMessage,
  type Problem,
  type Submission,
} from "../shared/types";
import bank from "./problems.json";
import { publicMatchReview } from "./review";
const MATCH_CHAT_AFTER_RESULT_MS = 24 * 60 * 60 * 1000;
interface InternalSubmission extends Submission {
  requestId: string;
  dispatchedAt?: number;
  jobId?: string;
  executionProvider?: "codebox";
  executionToken?: string;
  nextPollAt?: number;
}
export class MatchRoom extends DurableObject<Env> {
  private serial = new Serial();
  private record: MatchRecord | null = null;
  private chat: MatchChatMessage[] = [];
  private running = new Set<string>();
  private settling = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.record = (await ctx.storage.get("match")) ?? null;
      this.chat = (await ctx.storage.get<MatchChatMessage[]>("chat")) ?? [];
    });
  }
  private problem() {
    const p = (bank as Problem[]).find(
      (p) =>
        p.id === this.record!.problemId &&
        p.version === this.record!.problemVersion,
    );
    if (!p) throw new Error("Problem version unavailable");
    return p;
  }
  private async save() {
    await this.ctx.storage.put("match", this.record);
  }
  private chatEndsAt() {
    const m = this.record!;
    return (m.terminalAt ?? m.endsAt) + MATCH_CHAT_AFTER_RESULT_MS;
  }
  private chatAvailable(now = Date.now()) {
    return (
      this.record!.mode === "human" &&
      (!this.record!.result || now < this.chatEndsAt())
    );
  }
  private view(userId: string): MatchView {
    const m = this.record!;
    if (!m.players.some((p) => p.id === userId && !p.isBot))
      throw new AppError("This match belongs to other players.", 403);
    return {
      id: m.id,
      arena: m.arena,
      mode: m.mode,
      status: m.result
        ? m.settlementComplete
          ? "finished"
          : "settling"
        : Date.now() < m.startsAt
          ? "ready"
          : "active",
      players: m.players,
      problem: publicProblem(this.problem()),
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      serverNow: Date.now(),
      opponentStatus: m.result
        ? "Finished"
        : Date.now() < m.startsAt
          ? "Ready"
          : m.submissions.some(
                (s) => s.userId !== userId && s.verdict === "pending",
              )
            ? "Judging"
            : "Solving",
      submissions: m.submissions
        .filter((s) => s.userId === userId)
        .map((s) => ({
          id: s.id,
          userId: s.userId,
          kind: s.kind,
          language: s.language,
          receivedAt: s.receivedAt,
          sequence: s.sequence,
          verdict: s.verdict,
          message: s.message,
          sampleResults: s.sampleResults,
          completedAt: s.completedAt,
        })),
      attemptLimits: m.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS,
      attempts: {
        runs: m.submissions.filter(
          (s) => s.userId === userId && s.kind === "run",
        ).length,
        submits: m.submissions.filter(
          (s) => s.userId === userId && s.kind === "submit",
        ).length,
      },
      result: m.result,
      ...(this.chatAvailable()
        ? {
            chat: this.chat.slice(-100),
            ...(m.result ? { chatEndsAt: this.chatEndsAt() } : {}),
          }
        : {}),
    };
  }
  private broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: "match", id: this.record!.id }));
      } catch {}
    }
  }
  private async coordinator(path: string, data: any) {
    const res = await this.env.COORDINATOR.get(
      this.env.COORDINATOR.idFromName("global"),
    ).fetch("https://internal" + path, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Coordinator unavailable");
    return res.json() as Promise<any>;
  }
  private async advance(now = Date.now()) {
    if (!this.record) return;
    for (const s of this.record.submissions) {
      if (s.verdict === "pending" && now - s.receivedAt >= MAX_JUDGE_MS) {
        s.verdict = "judge_error";
        s.message = "The judge did not return a result in time.";
        s.completedAt = now;
      }
    }
    if (!this.record.result) {
      this.record.result = adjudicate(this.record, now);
      if (this.record.result) this.record.terminalAt = now;
    }
    if (this.record.result && this.chat.length && now >= this.chatEndsAt()) {
      await this.ctx.storage.delete("chat");
      this.chat = [];
      this.broadcast();
    }
    await this.save();
    await this.schedule();
  }
  private async schedule() {
    const m = this.record;
    if (!m) return;
    if (m.settlementComplete) {
      if (!m.coordinatorReleased) {
        const alarm = await this.ctx.storage.getAlarm();
        if (alarm === null || alarm <= Date.now())
          await this.ctx.storage.setAlarm(Date.now() + 5000);
        return;
      }
      const alarms: number[] = [];
      if (m.submissions.some((s) => s.source))
        alarms.push(m.createdAt + 30 * 86400000);
      if (this.chat.length && m.result) alarms.push(this.chatEndsAt());
      if (alarms.length)
        await this.ctx.storage.setAlarm(
          Math.max(Date.now() + 1000, Math.min(...alarms)),
        );
      else await this.ctx.storage.deleteAlarm();
      return;
    }
    const times = [m.endsAt, Date.now() + 60000];
    if (m.result) times.push(Date.now() + 5000);
    if (m.bot?.completesAt && m.bot.completesAt > Date.now())
      times.push(m.bot.completesAt);
    for (const s of m.submissions as InternalSubmission[]) {
      if (s.verdict === "pending") {
        times.push(s.receivedAt + MAX_JUDGE_MS);
        if (usesCodebox(this.env))
          times.push(
            Math.max(Date.now() + 100, s.nextPollAt ?? Date.now() + 1000),
          );
        else if (!s.dispatchedAt) times.push(Date.now() + 1000);
      }
    }
    const future = times.filter((t) => t > Date.now());
    await this.ctx.storage.setAlarm(Math.min(...future, Date.now() + 60000));
  }
  async fetch(request: Request): Promise<Response> {
    const receivedAt = Date.now();
    let kick = false;
    try {
      const response = await this.serial.run(async () => {
        const url = new URL(request.url);
        if (url.pathname === "/init") {
          if (this.record) return json({ id: this.record.id });
          this.record = (await request.json()) as MatchRecord;
          await this.save();
          await this.schedule();
          return json({ id: this.record.id });
        }
        if (!this.record) throw new AppError("Match not found.", 404);
        if (url.pathname === "/review")
          return json(publicMatchReview(this.record, this.problem(), receivedAt));
        const userId = request.headers.get("X-Dalgo-User") ?? "";
        this.view(userId);
        await this.advance(receivedAt);
        kick = true;
        if (url.pathname === "/events") {
          if (this.ctx.getWebSockets(userId).length >= 3)
            throw new AppError("Too many active connections.", 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1], [userId]);
          pair[1].send(JSON.stringify({ type: "match", id: this.record.id }));
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        if (url.pathname === "/view") return json(this.view(userId));
        if (url.pathname === "/chat") {
          if (request.method !== "POST")
            throw new AppError("Method not allowed.", 405);
          if (this.record.mode !== "human")
            throw new AppError("Chat is available in human matches only.", 409);
          const body = (await request.json()) as {
            requestId?: unknown;
            text?: unknown;
          };
          if (
            typeof body.requestId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              body.requestId,
            )
          )
            throw new AppError("A valid request identifier is required.");
          if (!this.chatAvailable(receivedAt))
            throw new AppError("Match chat has ended.", 409);
          const prior = this.chat.find((item) => item.id === body.requestId);
          if (prior) {
            if (prior.senderId !== userId || prior.text !== body.text)
              throw new AppError(
                "That message identifier is already in use.",
                409,
              );
            return json(this.view(userId));
          }
          if (
            typeof body.text !== "string" ||
            body.text !== body.text.trim() ||
            body.text.length < 1 ||
            body.text.length > 500 ||
            new TextEncoder().encode(body.text).length > 2000 ||
            /[\u0000-\u001f\u007f]/.test(body.text)
          )
            throw new AppError(
              "Write a single-line message under 500 characters.",
            );
          if (this.chat.length >= 1000)
            throw new AppError("This match chat is full.", 429);
          if (
            this.chat.some(
              (item) =>
                item.senderId === userId && receivedAt - item.sentAt < 2000,
            )
          )
            throw new AppError(
              "Wait a moment before sending another message.",
              429,
            );
          const next = [
            ...this.chat,
            {
              id: body.requestId,
              senderId: userId,
              text: body.text,
              sentAt: receivedAt,
            },
          ];
          await this.ctx.storage.put("chat", next);
          this.chat = next;
          await this.schedule();
          this.broadcast();
          return json(this.view(userId), 201);
        }
        if (url.pathname === "/resign") {
          if (!this.record.result) {
            if (Date.now() < this.record.startsAt)
              throw new AppError("The match has not started yet.");
            this.record.result = makeResult(
              this.record,
              this.record.players.find((p) => p.id !== userId)!.id,
              "resigned",
            );
            this.record.terminalAt = receivedAt;
            await this.save();
            await this.schedule();
            this.broadcast();
          }
          return json(this.view(userId));
        }
        if (url.pathname === "/run" || url.pathname === "/submit") {
          const body = (await request.json()) as {
            language: string;
            source: string;
            requestId: string;
          };
          if (!body.requestId || !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestId))
            throw new AppError("A valid request identifier is required.");
          const prior = (this.record.submissions as InternalSubmission[]).find(
            (s) => s.userId === userId && s.requestId === body.requestId,
          );
          if (prior) return json(this.view(userId));
          const now = receivedAt;
          if (
            this.record.result ||
            now >= this.record.endsAt ||
            now < this.record.startsAt
          )
            throw new AppError("This match is not accepting submissions.", 409);
          if (
            !Object.hasOwn(LANGUAGES, body.language) ||
            typeof body.source !== "string" ||
            !body.source.trim() ||
            body.source.includes("\u0000") ||
            body.source !==
              new TextDecoder().decode(new TextEncoder().encode(body.source)) ||
            new TextEncoder().encode(body.source).length > 65536
          )
            throw new AppError(
              "Choose a supported language and provide code under 64 KB.",
            );
          if (
            this.record.submissions.some(
              (s) => s.userId === userId && s.verdict === "pending",
            )
          )
            throw new AppError("Wait for your current attempt to finish.", 409);
          const kind = url.pathname === "/run" ? "run" : "submit";
          const limits = this.record.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS;
          const limit = kind === "run" ? limits.runs : limits.submits;
          if (
            this.record.submissions.filter(
              (s) => s.userId === userId && s.kind === kind,
            ).length >= limit
          )
            throw new AppError(
              kind === "run"
                ? `You have used all ${limit} sample runs.`
                : `You have used all ${limit} submissions.`,
              429,
            );
          const s: InternalSubmission = {
            id: crypto.randomUUID(),
            userId,
            kind,
            language: body.language as any,
            source: body.source,
            requestId: body.requestId,
            receivedAt: now,
            sequence: this.record.submissions.length,
            verdict: "pending",
          };
          this.record.submissions.push(s);
          await this.save();
          await this.schedule();
          this.broadcast();
          return json(this.view(userId), 202);
        }
        throw new AppError("Not found.", 404);
      });
      if (kick) this.ctx.waitUntil(this.pump());
      return response;
    } catch (e) {
      return json(
        { error: (e as Error).message },
        e instanceof AppError ? e.status : 500,
      );
    }
  }
  private async pump() {
    if (!this.record) return;
    const pending = await this.serial.run(async () => {
      await this.advance();
      this.broadcast();
      return (this.record!.submissions as InternalSubmission[])
        .filter(
          (s) =>
            s.verdict === "pending" &&
            !this.record!.result &&
            (usesCodebox(this.env)
              ? (s.nextPollAt ?? 0) <= Date.now()
              : !s.dispatchedAt),
        )
        .map((s) => s.id);
    });
    for (const id of pending) {
      if (this.running.has(id)) continue;
      this.running.add(id);
      this.ctx.waitUntil(
        (usesCodebox(this.env)
          ? this.stepCodebox(id)
          : this.runJob(id)
        ).finally(() => this.running.delete(id)),
      );
    }
    if (
      this.record.result &&
      !this.record.settlementComplete &&
      !this.settling
    ) {
      this.settling = true;
      try {
        await this.persistSettlement();
      } finally {
        this.settling = false;
      }
    }
  }
  /** One bounded network step per wakeup. Durable state, not waitUntil, owns the job. */
  private async stepCodebox(id: string) {
    const m = this.record!;
    try {
      const submission = await this.serial.run(async () => {
        const s = (m.submissions as InternalSubmission[]).find(
          (s) => s.id === id,
        )!;
        if (
          s.verdict !== "pending" ||
          m.result ||
          (s.nextPollAt ?? 0) > Date.now()
        )
          return null;
        if (s.dispatchedAt && s.executionProvider !== "codebox") {
          s.verdict = "judge_error";
          s.message =
            "A previous execution could not be recovered after the judge changed.";
          await this.advance();
          return null;
        }
        // Save the deterministic key and next wakeup before contacting either service.
        s.jobId ??= id + "-codebox";
        s.executionProvider = "codebox";
        s.nextPollAt = Date.now() + CODEBOX_POLL_MS;
        await this.save();
        await this.schedule();
        if (!s.dispatchedAt) {
          const lease = await this.coordinator("/lease", {
            jobId: s.jobId,
            matchId: m.id,
            userId: s.userId,
            retry: false,
          });
          if (!lease.ok) {
            if (lease.reason !== "busy") {
              s.verdict = "judge_error";
              s.message = "The execution reservation could not be recovered.";
              await this.advance();
            }
            return null;
          }
          s.dispatchedAt = Date.now();
          s.attempt = 1;
          await this.save();
        }
        return { ...s };
      });
      if (!submission) return;
      if (!submission.executionToken) {
        const token = await createExecution(
          this.env,
          this.problem(),
          submission,
          submission.jobId!,
        );
        await this.serial.run(async () => {
          const s = (m.submissions as InternalSubmission[]).find(
            (s) => s.id === id,
          )!;
          s.executionToken = token;
          await this.save();
        });
      } else {
        const result = await pollExecution(
          this.env,
          submission.executionToken,
          this.problem(),
          submission.kind,
        );
        if (result) {
          await this.serial.run(async () => {
            await this.advance();
            const s = m.submissions.find((s) => s.id === id)!;
            if (s.verdict === "pending" && !m.result) {
              Object.assign(s, result, { completedAt: Date.now() });
              await this.advance();
              this.broadcast();
              console.log(
                JSON.stringify({
                  event: "judge_result",
                  provider: "codebox",
                  matchId: m.id,
                  language: s.language,
                  verdict: s.verdict,
                  latencyMs: Date.now() - s.receivedAt,
                }),
              );
            }
          });
          await this.coordinator("/release-lease", { jobId: submission.jobId });
        }
      }
    } catch {
      // Unknown network outcomes retain the same key/token until the original
      // deadline. They never create another execution or consume another attempt.
      console.warn(
        JSON.stringify({
          event: "codebox_retry_pending",
          matchId: m.id,
          submissionId: id,
        }),
      );
    } finally {
      await this.serial.run(async () => {
        const s = (m.submissions as InternalSubmission[]).find(
          (s) => s.id === id,
        );
        if (s?.verdict === "pending")
          s.nextPollAt = Date.now() + CODEBOX_POLL_MS;
        await this.advance();
        this.broadcast();
      });
      if (m.result) this.ctx.waitUntil(this.pump());
    }
  }
  private async runJob(id: string) {
    const m = this.record!;
    let jobId = "";
    try {
      const submission = await this.serial.run(async () => {
        const s = (m.submissions as InternalSubmission[]).find(
          (s) => s.id === id,
        )!;
        if (s.verdict !== "pending" || s.dispatchedAt || m.result) return null;
        jobId = id + ":0";
        const lease = await this.coordinator("/lease", {
          jobId,
          matchId: m.id,
          userId: s.userId,
          retry: false,
        });
        if (!lease.ok) {
          if (lease.reason === "busy") {
            await this.schedule();
            return null;
          }
          s.verdict = "judge_error";
          s.message = "The execution reservation could not be used.";
          await this.advance();
          return null;
        }
        s.jobId = jobId;
        s.dispatchedAt = Date.now();
        s.attempt = 1;
        await this.save();
        return { ...s };
      });
      if (!submission) return;
      const started = Date.now();
      let result = await execute(this.env, this.problem(), submission);
      // One bounded retry is allowed, billed against the operational reservation.
      if (
        result.verdict === "judge_error" &&
        Date.now() - submission.receivedAt < 10000
      ) {
        await this.coordinator("/release-lease", { jobId });
        jobId = id + ":1";
        const retry = await this.serial.run(async () => {
          if (
            m.result ||
            m.submissions.filter(
              (s) => s.userId === submission.userId && s.attempt === 2,
            ).length >= EXECUTION_RETRY_LIMIT
          )
            return false;
          const lease = await this.coordinator("/lease", {
            jobId,
            matchId: m.id,
            userId: submission.userId,
            retry: true,
          });
          if (!lease.ok) return false;
          const s = m.submissions.find((s) => s.id === id)!;
          s.attempt = 2;
          await this.save();
          return true;
        });
        if (retry) result = await execute(this.env, this.problem(), submission);
      }
      await this.serial.run(async () => {
        const s = m.submissions.find((s) => s.id === id)!;
        if (s.verdict === "pending" && !m.result) {
          if (Date.now() - s.receivedAt >= MAX_JUDGE_MS) {
            s.verdict = "judge_error";
            s.message = "The judge did not return a result in time.";
            s.completedAt = Date.now();
          } else Object.assign(s, result, { completedAt: Date.now() });
          await this.advance();
          this.broadcast();
        }
        console.log(
          JSON.stringify({
            event: "judge_result",
            language: s.language,
            verdict: s.verdict,
            latencyMs: Date.now() - started,
            matchId: m.id,
          }),
        );
      });
    } catch {
      await this.serial.run(async () => {
        const s = m.submissions.find((s) => s.id === id);
        if (s && s.verdict === "pending") {
          s.verdict = "judge_error";
          s.message = "Code execution is temporarily unavailable.";
          await this.advance();
          this.broadcast();
        }
      });
    } finally {
      if (jobId)
        await this.coordinator("/release-lease", { jobId }).catch(() => {});
      await this.serial.run(() => this.schedule());
      if (m.result) this.ctx.waitUntil(this.pump());
    }
  }
  private async persistSettlement() {
    const m = this.record!;
    try {
      if (!m.archived) {
        const result = await settle(this.env, m);
        await this.serial.run(async () => {
          for (const change of result.rating_changes)
            m.result!.deltas[change.user_id] = change.delta;
          m.archived = true;
          await this.save();
        });
      }
      if (m.submissions.length) {
        await db(this.env, "submissions?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(
            (m.submissions as InternalSubmission[]).map((s) => ({
              id: s.id,
              match_id: m.id,
              user_id: s.userId,
              kind: s.kind,
              source: s.source,
              language: s.language,
              verdict: s.verdict,
              received_at: new Date(s.receivedAt).toISOString(),
              sequence: s.sequence,
              idempotency_key: s.requestId,
              payload: { message: s.message, completedAt: s.completedAt },
            })),
          ),
        });
      }
      await this.serial.run(async () => {
        m.settlementComplete = true;
        await this.save();
        this.broadcast();
        await this.schedule();
      });
      await this.coordinator("/settled", { matchId: m.id });
      await this.serial.run(async () => {
        m.coordinatorReleased = true;
        m.result!.settled = true;
        await this.save();
        await this.schedule();
        this.broadcast();
      });
      console.log(
        JSON.stringify({
          event: "match_settled",
          matchId: m.id,
          mode: m.mode,
          arena: m.arena,
          reason: m.result!.reason,
        }),
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "settlement_pending",
          matchId: m.id,
          message: (e as Error).message,
        }),
      );
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }
  async alarm() {
    await this.serial.run(async () => {
      if (!this.record) return;
      await this.advance();
      if (
        this.record.settlementComplete &&
        Date.now() >= this.record.createdAt + 30 * 86400000 &&
        this.record.submissions.some((s) => s.source)
      ) {
        for (const s of this.record.submissions) s.source = "";
        await this.save();
        await this.schedule();
      }
    });
    if (this.record?.settlementComplete && !this.record.coordinatorReleased) {
      try {
        await this.coordinator("/settled", { matchId: this.record.id });
        await this.serial.run(async () => {
          this.record!.coordinatorReleased = true;
          this.record!.result!.settled = true;
          await this.save();
          await this.schedule();
          this.broadcast();
        });
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 5000);
      }
      return;
    }
    await this.pump();
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
