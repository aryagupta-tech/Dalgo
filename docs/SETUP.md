# Dalgo service setup

Work in `/Users/arya/Developer/Dalgo`. The Documents path is obsolete.

The owner-facing steps are in [REQUIREMENTS.md](REQUIREMENTS.md). Use `npm run check:setup` to inspect missing fields without exposing values.

## Safe deployment defaults

`npm run deploy:staging` builds the React/Material UI frontend and deploys `dalgo-staging`. Its Coordinator and MatchRoom Durable Object namespaces are isolated from production. Staging uses `ADMISSION_MODE=staging` with live matchmaking limited by the server-only tester allowlist. `npm run deploy:production` targets the capped public `dalgo` Worker.

## Cloudflare

Staging runs at [https://dalgo-staging.dalgo-arya.workers.dev](https://dalgo-staging.dalgo-arya.workers.dev). Disabled production runs separately at [https://dalgo.dalgo-arya.workers.dev](https://dalgo.dalgo-arya.workers.dev). Both include static assets, isolated SQLite-backed Durable Objects, WebSockets, independent signing secrets, and a daily source-retention cron. URL query strings are redacted from observability logs.

Codebox is connected privately through named Cloudflare Tunnel `dalgo-codebox-staging` and Workers VPC service `01a0bdc2-e64f-7b63-8dae-b0c78031a859`. The Worker binding is `CODEBOX`; the API token is a Worker secret. The execution API has no public hostname.

The full edge-to-executor route returned `ready=true`, `executor=isolate`, and `concurrency=1`. The verified timestamp and private VPC binding are stored in both environments. Production has its Supabase, Codebox, and independent WebSocket secrets configured, while live play stays off until tester acceptance passes.

## Supabase

The dedicated `dalgo-staging` project exists in Mumbai with ref `gtdofekbolymsrrullpb`. Four versioned migrations are applied and 30 immutable problem versions are seeded, 10 per arena. All public tables have RLS. Browser roles have an explicit deny policy for the problem bank because rows include hidden tests and reference solutions; the backend secret role supplies sanitized statements through the Worker.

Database/RLS security checks have no findings. Dalgo uses Google/GitHub only, and the unused Email provider is disabled. The Auth advisor still reports its generic leaked-password warning because the protection is unavailable on the Free plan; Dalgo exposes no password login surface. The Site URL is the production Worker, while the production, staging, and local development origins remain in the redirect allowlist. Both Google redirects and signed-in sessions passed staging acceptance.

Use `npm run seed:problems:staging` to inspect the seed set or append `-- --apply` to insert missing immutable versions. The seeder refuses to overwrite an existing version with changed content.

## Secrets and configuration

Use `.dev.vars.example` for local development. `.dev.vars` and `.dev.vars.staging` are ignored. No second `.env` file is required. Keep these only in local ignored settings and Cloudflare secret bindings:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `WEBSOCKET_SIGNING_SECRET`
- `CODEBOX_AUTH_TOKEN`
- `TESTER_USER_IDS`: comma-separated UUIDs of two real Supabase users

No secret belongs in a `VITE_` variable. The frontend receives only the public Supabase URL and publishable key from `/api/config`.

## Admission and live matches

`GET /api/admission` authenticates the current user and returns `{mode, canJoin, reason}`. Actual eligibility is enforced in the Coordinator; browser state cannot grant access. Unknown modes and malformed allowlists deny admission.

The initial Codebox capacity is one active match and one execution at a time. Each player retains three preview runs and five scored submissions. A busy executor pauses new admission without consuming a daily-credit budget. Active matches continue when fresh admission is paused.

Staging is enabled for two OAuth tester UUIDs and the automated live checklist passed. Production uses public admission with one active match and one execution at a time. Disable both admission variables immediately if executor health or settlement smoke checks fail.
