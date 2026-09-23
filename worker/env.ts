import { configuredAttemptLimits, executionReservation } from "./limits";

export interface Env {
  ASSETS: Fetcher;
  COORDINATOR: DurableObjectNamespace;
  MATCHES: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  /** Legacy JWT keys remain supported for existing deployments. */
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  WEBSOCKET_SIGNING_SECRET: string;
  /** Legacy JDoodle requires explicit selection; new deployments use Codebox. */
  JUDGE_PROVIDER?: "codebox" | "jdoodle";
  CODEBOX?: { fetch(request: Request): Promise<Response> };
  CODEBOX_AUTH_TOKEN?: string;
  CODEBOX_LOCAL_URL?: string;
  MAX_ACTIVE_MATCHES?: string;
  JDOODLE_CLIENT_ID: string;
  JDOODLE_CLIENT_SECRET: string;
  LIVE_MATCHES_ENABLED: string;
  ADMISSION_MODE: string;
  TESTER_USER_IDS?: string;
  JUDGE_VERIFIED_AT: string;
  JUDGE_DAILY_QUOTA: string;
  JUDGE_CREDIT_COST: string;
  MATCH_RUN_LIMIT?: string;
  MATCH_SUBMISSION_LIMIT?: string;
  JUDGE_CONCURRENCY: string;
  JUDGE_RESET_HOUR_UTC: string;
  ALLOWED_ORIGINS: string;
}

export type AdmissionMode = "disabled" | "staging" | "public";
const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function supabasePublicKey(env: Env) {
  return (
    env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim() || ""
  );
}

export function supabaseSecretKey(env: Env) {
  return (
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

export function admissionMode(env: Env): AdmissionMode {
  return env.ADMISSION_MODE === "staging" || env.ADMISSION_MODE === "public"
    ? env.ADMISSION_MODE
    : "disabled";
}

export function testerUserIds(env: Env): Set<string> {
  const values = (env.TESTER_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  // A malformed allowlist is a configuration error; fail closed as a whole.
  if (values.some((id) => !userIdPattern.test(id))) return new Set();
  return new Set(values.map((id) => id.toLowerCase()));
}

export function launchReady(env: Env) {
  const positiveInteger = (value: string) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const reset = env.JUDGE_RESET_HOUR_UTC;
  const mode = admissionMode(env);
  const limits = configuredAttemptLimits(env);
  return (
    env.LIVE_MATCHES_ENABLED === "true" &&
    mode !== "disabled" &&
    (mode !== "staging" || testerUserIds(env).size > 0) &&
    [env.SUPABASE_URL, supabasePublicKey(env), supabaseSecretKey(env)].every(
      nonempty,
    ) &&
    typeof env.WEBSOCKET_SIGNING_SECRET === "string" &&
    new TextEncoder().encode(env.WEBSOCKET_SIGNING_SECRET.trim()).byteLength >=
      32 &&
    limits !== null &&
    Number.isFinite(Date.parse(env.JUDGE_VERIFIED_AT)) &&
    Date.parse(env.JUDGE_VERIFIED_AT) <= Date.now() &&
    (env.JUDGE_PROVIDER !== "jdoodle"
      ? (!env.JUDGE_PROVIDER || env.JUDGE_PROVIDER === "codebox") &&
        nonempty(env.CODEBOX_AUTH_TOKEN) &&
        env.CODEBOX_AUTH_TOKEN.trim().length >= 32 &&
        (Boolean(env.CODEBOX) ||
          (mode === "staging" &&
            /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(
              env.CODEBOX_LOCAL_URL ?? "",
            ))) &&
        env.JUDGE_CONCURRENCY === "1" &&
        env.MAX_ACTIVE_MATCHES === "1"
      : [env.JDOODLE_CLIENT_ID, env.JDOODLE_CLIENT_SECRET].every(nonempty) &&
        positiveInteger(env.JUDGE_DAILY_QUOTA) &&
        positiveInteger(env.JUDGE_CREDIT_COST) &&
        limits !== null &&
        Number.isSafeInteger(
          executionReservation(limits, Number(env.JUDGE_CREDIT_COST)).total,
        ) &&
        positiveInteger(env.JUDGE_CONCURRENCY) &&
        Number.isFinite(Date.parse(env.JUDGE_VERIFIED_AT)) &&
        typeof reset === "string" &&
        reset.trim() !== "" &&
        Number.isInteger(Number(reset)) &&
        Number(reset) >= 0 &&
        Number(reset) < 24)
  );
}
