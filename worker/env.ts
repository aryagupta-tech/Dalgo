export interface Env {
  ASSETS: Fetcher;
  COORDINATOR: DurableObjectNamespace;
  MATCHES: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JDOODLE_CLIENT_ID: string;
  JDOODLE_CLIENT_SECRET: string;
  LIVE_MATCHES_ENABLED: string;
  JUDGE_VERIFIED_AT: string;
  JUDGE_DAILY_QUOTA: string;
  JUDGE_CREDIT_COST: string;
  JUDGE_CONCURRENCY: string;
  JUDGE_RESET_HOUR_UTC: string;
  ALLOWED_ORIGINS: string;
  DEV_AUTH_SECRET?: string;
}
export function launchReady(env: Env) {
  const positiveInteger = (value: string) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const reset = env.JUDGE_RESET_HOUR_UTC;
  return (
    env.LIVE_MATCHES_ENABLED === "true" &&
    [
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.JDOODLE_CLIENT_ID,
      env.JDOODLE_CLIENT_SECRET,
    ].every((value) => typeof value === "string" && value.trim().length > 0) &&
    positiveInteger(env.JUDGE_DAILY_QUOTA) &&
    positiveInteger(env.JUDGE_CREDIT_COST) &&
    positiveInteger(env.JUDGE_CONCURRENCY) &&
    Number.isFinite(Date.parse(env.JUDGE_VERIFIED_AT)) &&
    typeof reset === "string" &&
    reset.trim() !== "" &&
    Number.isInteger(Number(reset)) &&
    Number(reset) >= 0 &&
    Number(reset) < 24
  );
}
