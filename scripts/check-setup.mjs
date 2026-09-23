#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const positive = (value) =>
  clean(value) !== "" &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;
const configured = (value) =>
  clean(value) !== "" &&
  !/^(?:your[_ -]|replace[_ -]|<|TODO$|CHANGEME$)/i.test(clean(value));
function legacyRole(value) {
  try {
    return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString())
      .role;
  } catch {
    return null;
  }
}
function validProjectUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// Output contains fixed labels and verdicts only, never input values or provider responses.
// This checks local configuration; it does not authenticate keys or establish launch evidence.
export function evaluateSetup(env, now = Date.now()) {
  const codebox = env.JUDGE_PROVIDER !== "jdoodle";
  const checks = [];
  const add = (id, ok, requirement) =>
    checks.push({ id, status: ok ? "configured" : "needs_setup", requirement });
  const publicKey =
    clean(env.SUPABASE_PUBLISHABLE_KEY) || clean(env.SUPABASE_ANON_KEY);
  const secretKey =
    clean(env.SUPABASE_SECRET_KEY) || clean(env.SUPABASE_SERVICE_ROLE_KEY);
  add(
    "supabase_url",
    validProjectUrl(clean(env.SUPABASE_URL)),
    "Supabase project HTTPS URL",
  );
  add(
    "supabase_public_key",
    publicKey.startsWith("sb_publishable_") || legacyRole(publicKey) === "anon",
    "Supabase publishable key (legacy anon supported)",
  );
  add(
    "supabase_secret_key",
    secretKey.startsWith("sb_secret_") ||
      legacyRole(secretKey) === "service_role",
    "Supabase server secret key (legacy service role supported)",
  );
  add(
    "websocket_secret",
    Buffer.byteLength(clean(env.WEBSOCKET_SIGNING_SECRET)) >= 32,
    "Independent WebSocket signing secret of at least 32 bytes",
  );
  if (codebox) {
    add(
      "judge_provider",
      !env.JUDGE_PROVIDER || env.JUDGE_PROVIDER === "codebox",
      "Codebox execution provider",
    );
    add(
      "codebox_credentials",
      configured(env.CODEBOX_AUTH_TOKEN) &&
        clean(env.CODEBOX_AUTH_TOKEN).length >= 32,
      "Private Codebox API token (32+ characters)",
    );
    add(
      "codebox_connection",
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(
        clean(env.CODEBOX_LOCAL_URL),
      ) || configured(env.CODEBOX_SERVICE_ID),
      "Local Codebox endpoint or configured Cloudflare VPC service ID",
    );
    add(
      "server_capacity",
      env.JUDGE_CONCURRENCY === "1" && env.MAX_ACTIVE_MATCHES === "1",
      "One execution and one active match for the initial server",
    );
  } else {
    add(
      "jdoodle_credentials",
      configured(env.JDOODLE_CLIENT_ID) &&
        configured(env.JDOODLE_CLIENT_SECRET),
      "JDoodle Compiler API client ID and secret",
    );
    add(
      "judge_allowance",
      positive(env.JUDGE_DAILY_QUOTA) &&
        positive(env.JUDGE_CREDIT_COST) &&
        positive(env.JUDGE_CONCURRENCY),
      "Verified daily credits, execution cost, and concurrency",
    );
  }
  const parseAttemptLimit = (value, fallback) => {
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(clean(value))) return null;
    const count = Number(value);
    return Number.isSafeInteger(count) && count <= 20 ? count : null;
  };
  const runs = parseAttemptLimit(env.MATCH_RUN_LIMIT, 3);
  const submits = parseAttemptLimit(env.MATCH_SUBMISSION_LIMIT, 5);
  const attemptLimits =
    runs === null || submits === null ? null : { runs, submits };
  const creditsPerHuman = attemptLimits
    ? (attemptLimits.runs + attemptLimits.submits + 2) *
      Number(env.JUDGE_CREDIT_COST)
    : null;
  add(
    "attempt_limits",
    !!attemptLimits,
    "Sample-run and submission limits (defaults: 3 and 5; overrides: whole numbers 1–20)",
  );
  const budgetValid =
    positive(env.JUDGE_DAILY_QUOTA) &&
    positive(env.JUDGE_CREDIT_COST) &&
    creditsPerHuman !== null &&
    Number.isSafeInteger(creditsPerHuman);
  const capacity =
    !codebox && budgetValid
      ? {
          admissionCredits: Math.floor(Number(env.JUDGE_DAILY_QUOTA) * 0.8),
          creditsPerHuman,
          botMatchReservation: creditsPerHuman,
          humanMatchReservation: 2 * creditsPerHuman,
        }
      : null;
  if (!codebox) {
    add(
      "human_match_capacity",
      !!capacity && capacity.admissionCredits >= capacity.humanMatchReservation,
      "Free daily capacity can reserve at least one two-human match under the agreed attempt limits",
    );
    const reset = clean(env.JUDGE_RESET_HOUR_UTC);
    add(
      "judge_reset",
      reset !== "" &&
        Number.isInteger(Number(reset)) &&
        Number(reset) >= 0 &&
        Number(reset) < 24,
      "Verified provider reset hour in UTC (0–23)",
    );
  }
  const date = Date.parse(env.JUDGE_VERIFIED_AT ?? "");
  add(
    "judge_evidence",
    Number.isFinite(date) && date <= now,
    "Actual completed judge-verification date; leave empty until verified",
  );
  const testers = clean(env.TESTER_USER_IDS)
    .split(",")
    .map(clean)
    .filter(Boolean);
  add(
    "test_accounts",
    testers.every((id) => uuid.test(id)) &&
      new Set(testers.map((id) => id.toLowerCase())).size >= 2,
    "Two distinct real Supabase tester user IDs for staging acceptance",
  );
  add(
    "staging_mode",
    env.ADMISSION_MODE === "staging",
    "Isolated staging admission mode",
  );
  const privateValues = [
    secretKey,
    clean(env.CODEBOX_AUTH_TOKEN),
    clean(env.JDOODLE_CLIENT_ID),
    clean(env.JDOODLE_CLIENT_SECRET),
    clean(env.WEBSOCKET_SIGNING_SECRET),
  ].filter(Boolean);
  const exposed = Object.entries(env).some(([name, raw]) => {
    const value = clean(raw);
    return (
      name.startsWith("VITE_") &&
      value &&
      (value.startsWith("sb_secret_") ||
        legacyRole(value) === "service_role" ||
        privateValues.some((secret) => value.includes(secret)) ||
        /SECRET|SERVICE_ROLE|JDOODLE|CODEBOX|SIGNING/.test(name))
    );
  });
  add(
    "frontend_secret_boundary",
    !exposed,
    "No private credentials in VITE_ variables",
  );
  const live = env.LIVE_MATCHES_ENABLED;
  add(
    "live_switch",
    live === "true" || live === "false",
    "Explicit true/false live-play switch; keep false until evidence passes",
  );
  return {
    configurationComplete: checks.every(
      (check) => check.status === "configured",
    ),
    livePlayRequested: live === "true",
    publicLaunchVerified: false,
    capacity,
    executionCapacity: codebox
      ? { concurrentExecutions: 1, activeMatches: 1 }
      : null,
    attemptLimits,
    checks,
    externalRequirements: [
      "Cloudflare deployment authorization and Workers setup",
      "Dedicated Supabase project, applied migration, seeded problems, and verified access policies",
      "Google and GitHub OAuth apps connected with verified redirects",
      codebox
        ? "Hosted Codebox runtime and sandbox verification, AWS server, private tunnel"
        : "Account-specific JDoodle runtimes, quota, concurrency, and sandbox evidence",
      "One real bot match and two-account hosted staging acceptance",
      "Operator name, support contact, published privacy information, and data-request process",
    ],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--json")) {
    console.error(
      "Use npm run check:setup, optionally with -- --json. Credentials belong in the local environment file.",
    );
    process.exitCode = 2;
  } else {
    const report = evaluateSetup(process.env);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("dalgo local staging configuration (no network requests)");
      for (const check of report.checks)
        console.log(
          `${check.status === "configured" ? "OK" : "NEEDED"}  ${check.requirement}`,
        );
      console.log(
        `\nLive play requested: ${report.livePlayRequested ? "yes" : "no"}. Configuration checks do not establish public-launch readiness.`,
      );
      if (report.capacity)
        console.log(
          `Daily admission budget: ${report.capacity.admissionCredits} credits; reserve ${report.capacity.botMatchReservation} per bot match or ${report.capacity.humanMatchReservation} per human match.`,
        );
      console.log(
        "See docs/REQUIREMENTS.md for account actions and hosted acceptance.",
      );
    }
    process.exitCode = report.configurationComplete ? 0 : 1;
  }
}
