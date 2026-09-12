import { DEFAULT_ATTEMPT_LIMITS, type AttemptLimits } from "../shared/types";

export const EXECUTION_RETRY_LIMIT = 2;
interface LimitSettings {
  MATCH_RUN_LIMIT?: string;
  MATCH_SUBMISSION_LIMIT?: string;
}
function parseLimit(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  // Empty or malformed overrides must pause new matches, not silently expand them.
  if (!/^[1-9]\d*$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 20 ? count : null;
}
export function configuredAttemptLimits(
  env: LimitSettings,
): AttemptLimits | null {
  const runs = parseLimit(env.MATCH_RUN_LIMIT, DEFAULT_ATTEMPT_LIMITS.runs);
  const submits = parseLimit(
    env.MATCH_SUBMISSION_LIMIT,
    DEFAULT_ATTEMPT_LIMITS.submits,
  );
  return runs === null || submits === null ? null : { runs, submits };
}
export function executionReservation(
  limits: AttemptLimits,
  creditCost: number,
) {
  const base = (limits.runs + limits.submits) * creditCost;
  const retries = EXECUTION_RETRY_LIMIT * creditCost;
  return { base, retries, total: base + retries };
}
export function sameAttemptLimits(a: AttemptLimits, b: AttemptLimits) {
  return a.runs === b.runs && a.submits === b.submits;
}
