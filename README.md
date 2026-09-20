# Dalgo

A dark DSA duel arena built with React, TypeScript, Material UI, Vite, Monaco, Supabase, and Cloudflare Durable Objects. Three arenas, shared clocks, separate human/bot Elo ratings, and function-style Python, C++, Java, and JavaScript submissions.

## Current state

The redesigned lobby and full `/demo/:arena` journey are implemented. The demo includes a 15-second search, labelled simulated opponent, five-second preparation, timed workspace, four language starters, preview actions, and illustrative results. Drafts/countdowns survive reload within the browser session. `/preview/:arena` redirects to the demo. Demo actions never execute code or save ratings.

The backend includes Supabase OAuth verification, durable human matchmaking and bot fallback, execution reservations, a private **Codebox** adapter with durable submission polling, receipt-ordered adjudication, and transactional settlement. New admissions support disabled, tester-only staging, and public modes, with a durable request budget. Active matches can finish after admissions close.

Cloudflare staging is deployed at [https://dalgo-staging.dalgo-arya.workers.dev](https://dalgo-staging.dalgo-arya.workers.dev) with live play disabled. A separate disabled production Worker is deployed at [https://dalgo.dalgo-arya.workers.dev](https://dalgo.dalgo-arya.workers.dev) with its private service bindings and secrets prepared. Supabase is provisioned with all 30 problems and explicit row-level access policies. Codebox is running on Google Cloud and its private Cloudflare Tunnel/Workers VPC path has passed an edge-to-executor health check. OAuth browser testing and signed-in multiplayer acceptance remain pending. Public play stays disabled. See [docs/SETUP.md](docs/SETUP.md) for account setup and [docs/LAUNCH.md](docs/LAUNCH.md) for evidence gates.

The private Sites preview hosts only the frontend. Cloudflare staging/production configurations deploy the complete frontend and API with isolated SQLite Durable Objects. All implementation work belongs in `/Users/arya/Developer/Dalgo`.

## Frontend components

Material UI supplies the navigation controls, buttons, dialogs, selection controls, tables, progress indicators, and responsive layout primitives. `src/theme.ts` centralizes the black/charcoal palette, typography, focus styles and reduced-motion behavior. Component layout uses the library's `sx` API; there is no handwritten application stylesheet. Fonts are bundled locally and registered by the theme. Monaco manages its own editor styling.

## Account setup

See [docs/CODEBOX.md](docs/CODEBOX.md) for Google Cloud project details, trial safeguards, server limits, and deployment instructions. `npm run setup:local` creates a private staging settings file without overwriting existing values; `npm run check:setup` reports missing configuration without printing secrets.

## Local development

Use Node.js 22 or newer.

```sh
npm ci
npm run build
npm run dev:worker
```

In a second terminal:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and WebSockets to the local Worker on port 8787. Without service configuration, demo mode works and privileged routes reject unauthenticated requests.

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

The offline tests exercise rating conservation, queue windows, bots, receipt ordering, deadlines, retries, durable recovery, quota ownership, source privacy, launch gates, and the real SQL migration in embedded PostgreSQL. External judge and two-account production tests remain separate launch requirements.

## Connect Supabase

1. Create a Supabase project on the free plan. Apply `supabase/migrations/202609110001_dalgo.sql` using the Supabase SQL editor or a version-controlled Supabase CLI migration workflow.
2. Enable Google and GitHub in Authentication → Providers. Create provider OAuth applications using the callback URL shown by Supabase. Set the Supabase site URL and allowed redirect URLs to your frontend origin; include `http://127.0.0.1:5173` for local development. The frontend redirects OAuth back to its own origin.
3. Copy `.env.example` to an ignored `.env` for setup scripts. Copy the Worker variables to ignored `.dev.vars` for local Workers development. The URL and publishable key can reach the frontend. **The service role and Codebox credentials must never have a `VITE_` prefix.**
4. Seed all immutable problem versions after applying the migration:

```sh
npm run seed:problems
npm run seed:problems -- --apply
```

The dry run makes no network calls. The apply command requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the legacy service-role key); it refuses to change existing problem versions. OAuth creates a profile and six ratings automatically. Browser roles cannot execute settlement, write ratings, or read private tests.

## Codebox execution service

Codebox is the default judge. Run the sandbox locally with Docker:

```sh
npm run setup:codebox
npm run codebox:up
npm run verify:codebox -- --smoke
npm run verify:codebox
npm run verify:codebox:recovery
```

The setup command creates private ignored credentials, preserves Supabase settings, and leaves live play disabled. Codebox runs Python, C++17, Java, and JavaScript inside the pinned isolate sandbox. Dalgo compares outputs on the backend; expected answers are never sent to the execution service. The original JDoodle adapter is retained only for explicit legacy deployments and regression coverage.

There is no Codebox daily credit allowance. The initial free server admits one active match and one execution at a time, with three sample runs and five submissions per player. Interrupted requests reuse a durable job ID. An uncertain outcome that could change the winner voids the match.

See [docs/CODEBOX.md](docs/CODEBOX.md) for Google Cloud provisioning, private Cloudflare Tunnel/VPC setup, and hosted acceptance. Local execution success does not establish hosted launch readiness. Do not enable public play until the hosted and two-account checks pass.

## Cloudflare deployment

The checked-in configuration uses a free Workers subdomain, SQLite-backed Durable Objects, Worker assets, and a daily source-purge trigger. Authenticate Wrangler with your own Cloudflare account. Keep live play disabled until the hosted judge is verified.

Use [docs/SETUP.md](docs/SETUP.md) for modern Supabase keys, a separate WebSocket signing secret, and tester access. Secrets are scoped to the selected environment. `ALLOWED_ORIGINS` controls CORS, not tester eligibility.

```sh
npm run check:staging
npm run deploy:staging
```

Production has a separate `npm run deploy:production` command and starts with admission disabled. Configure the final origin in Supabase Auth after deployment. Keep `LIVE_MATCHES_ENABLED=false` until account-specific judge verification passes; staging must still pass the two-account acceptance before public mode is enabled.

## Source map

| Path                                     | Purpose                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `src/`                                   | Responsive arena, match editor, results, history, leaderboard, authentication |
| `shared/`                                | Public contracts, arena and language definitions                              |
| `worker/coordinator.ts`                  | One-account ownership, matchmaking, match capacity and execution leases       |
| `worker/match.ts`                        | Authoritative clocks, private submissions, adjudication, settlement recovery  |
| `worker/codebox.ts`, `worker/harness.ts` | Private asynchronous Codebox adapter and language wrappers                    |
| `worker/problems.json`                   | Thirty original versioned problems, references, hidden tests; backend only    |
| `public/problems.json`                   | Public statements, examples, and starters only                                |
| `supabase/migrations/`                   | Schema, RLS, atomic Elo settlement, retention                                 |
| `tests/`                                 | Offline application and PostgreSQL regression tests                           |

When changing a problem, add a new version and preserve old versions for active matches. Update the public projection and seed the new version before deploying it. Do not remove versions referenced by match history. The Worker bank is the authoritative source for active problem selection; the database retains the same versions for settlement and auditing.

Disconnecting does not pause a match. Reopening its URL restores the clock and attempts. Settlement failures preserve the result and block a new ranked match until retry succeeds. Private sources are removed after 30 days from Supabase and Durable Objects; compact verdicts and the rating ledger remain.

No tournaments, chat, XP, badges, walkthroughs, or automatic cheating detection are included in this beta.
