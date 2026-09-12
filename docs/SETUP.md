# Dalgo service setup

Work in `/Users/arya/Developer/Dalgo`. The Documents path is obsolete.

The owner-facing requirements are in [REQUIREMENTS.md](REQUIREMENTS.md). Use `npm run setup:local` to initialize private staging settings and `npm run check:setup` to inspect missing fields without exposing values.

## Current safe deployment defaults

`npm run deploy:staging` builds the UI and deploys `dalgo-staging`. Its own Coordinator and MatchRoom namespaces are isolated from production. Staging admission mode is selected, but `LIVE_MATCHES_ENABLED=false` keeps execution off. `npm run deploy:production` targets `dalgo` with admission disabled. The compatibility alias `deploy:cloudflare` now targets staging.

A direct API deployment must upload the same Worker bundle, static assets, environment values, SQLite class migration and cron as `wrangler.jsonc`. Use the connected Cloudflare account; never create a temporary or paid account as a deployment workaround.

## Cloudflare connection

Cloudflare write access is verified as of 12 September 2026. The staging Worker is deployed at [https://dalgo-staging.dalgo-arya.workers.dev](https://dalgo-staging.dalgo-arya.workers.dev), with its static assets, SQLite Coordinator/MatchRoom namespaces, an independent signing secret, and the daily `0 3 * * *` retention schedule. URL query strings are redacted in observability logs.

The earlier authentication error `10000` is resolved. The account subdomain is `dalgo-arya.workers.dev`; no further Cloudflare setup is currently needed from the owner. Live matches remain disabled until Supabase, OAuth, judge evidence and staging acceptance are complete.

Deployment smoke checks returned 200 for configuration, the demo page and all 30 public problems, and 401 for unauthenticated admission. The updated deployment connects the saved Supabase and JDoodle settings while keeping real play disabled pending judge evidence.

## Supabase

The dedicated `dalgo-staging` project exists in Mumbai with ref `gtdofekbolymsrrullpb`. Both version-controlled migrations are applied and all 30 problems are seeded. Google/GitHub provider settings are enabled. The private staging file contains the validated project URL and keys. The unrelated Lockedin project was left untouched.

Use `npm run seed:problems:staging` for an inspection or append `-- --apply` for immutable-version seeding. Modern server keys are sent as `apikey`, not as JWT Bearer tokens.

The Supabase bootstrap event trigger retains owner execution; unnecessary browser grants were revoked. The remaining informational advisor notice for `public.problems` is intentional: RLS is enabled without browser policies because hidden content is backend-only. See [the Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Public statements are served separately, without hidden tests or solutions.

The exact OAuth callback and frontend redirect settings are in `REQUIREMENTS.md`. Provider flags are verified; the owner will perform browser sign-in testing.

## Worker secrets

Use `.dev.vars.example` for local development. `.dev.vars` and `.dev.vars.staging` are ignored. Generate a distinct 32-byte-or-longer random `WEBSOCKET_SIGNING_SECRET`; never reuse a Supabase key as a signing key.

Store these in the staging Worker's secret bindings:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `WEBSOCKET_SIGNING_SECRET`
- `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET`
- `TESTER_USER_IDS`: comma-separated UUIDs of real Supabase test users

No secret belongs in a `VITE_` variable. A combined frontend/API deployment gets its public Supabase URL/key from `/api/config`, so frontend build credentials are optional.

## Admission and first real match

`GET /api/admission` authenticates the current user and returns `{mode, canJoin, reason}`. The frontend refreshes this after account changes. Actual enforcement occurs in the Coordinator; editing browser state cannot grant access. Unknown modes and malformed allowlists deny new admissions.

Staging requires the judge evidence in `LAUNCH.md`, `ADMISSION_MODE=staging`, a valid tester list, and `LIVE_MATCHES_ENABLED=true`. Public mode additionally requires completing the two-account staging acceptance. A pause blocks fresh searches, releases unassigned waiting reservations, and preserves active/assigned matches and settlement retries. Fresh searches are capped per account at six per minute and thirty per hour; idempotent retries do not consume that budget.

JDoodle verification is opt-in. At a verified cost of one credit per execution, all 30 problems plus 32 probes need 272 executions and an estimated 274-credit budget including retries. Split the matrix across quota days; never upgrade billing to finish it. A bounded memory probe can be inconclusive and must not be recorded as a pass.

## Owner input still required

See `REQUIREMENTS.md` for the pending attempt-policy decision, real judge evidence, two test identities, and public contact details. Provider credentials and project creation are complete. Never paste private keys or passwords into chat.
