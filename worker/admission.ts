import { AppError } from "./core";
import { admissionMode, launchReady, testerUserIds, type Env } from "./env";

export function admissionStatus(env: Env, userId?: string) {
  const mode = admissionMode(env);
  if (mode === "disabled")
    return {
      mode,
      canJoin: false,
      reason: "Online matches are paused. You can still try the demo.",
    };
  if (
    mode === "staging" &&
    (!userId || !testerUserIds(env).has(userId.toLowerCase()))
  )
    return {
      mode,
      canJoin: false,
      reason:
        "Live matches are limited to invited testers while the beta is checked. You can still try the demo.",
    };
  if (!launchReady(env))
    return {
      mode,
      canJoin: false,
      reason:
        "Online matches are being prepared. Existing matches can finish; please try again later.",
    };
  if (!userId)
    return { mode, canJoin: false, reason: "Sign in to find a match." };
  return { mode, canJoin: true, reason: "" };
}

export const ADMISSION_WINDOW_MS = 60 * 60 * 1000;
export class AdmissionRateLimitError extends AppError {
  constructor(public readonly retryAfter: number) {
    super("Too many new searches. Wait a moment before joining again.", 429);
  }
}

/** Only fresh queue requests consume this durable budget, never active-match traffic. */
export function recordAdmission(timestamps: number[] | undefined, now: number) {
  const recent = (timestamps ?? []).filter(
    (time) => time > now - ADMISSION_WINDOW_MS,
  );
  const minute = recent.filter((time) => time > now - 60_000);
  const retryAt = Math.max(
    recent.length >= 30 ? recent[recent.length - 30] + ADMISSION_WINDOW_MS : 0,
    minute.length >= 6 ? minute[minute.length - 6] + 60_000 : 0,
  );
  if (retryAt > now)
    throw new AdmissionRateLimitError(
      Math.max(1, Math.ceil((retryAt - now) / 1000)),
    );
  return [...recent, now];
}
