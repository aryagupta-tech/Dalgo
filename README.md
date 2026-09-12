# Dalgo

A dark DSA duel arena built with React, TypeScript, Material UI, Vite, Monaco, Supabase, and Cloudflare Durable Objects. Three arenas, shared clocks, separate human/bot Elo ratings, and function-style Python, C++, Java, and JavaScript submissions.

## Current state

The redesigned lobby and full `/demo/:arena` journey are implemented. The demo includes a 15-second search, labelled simulated opponent, five-second preparation, timed workspace, four language starters, preview actions, and illustrative results. Drafts/countdowns survive reload within the browser session. `/preview/:arena` redirects to the demo. Demo actions never execute code or save ratings.

The backend includes Supabase OAuth verification, durable human matchmaking and bot fallback, quota reservations, a server-only **JDoodle** adapter, receipt-ordered adjudication, and transactional settlement. New admissions support disabled, tester-only staging, and public modes, with a durable request budget. Active matches can finish after admissions close.

Cloudflare staging is deployed at [https://dalgo-staging.dalgo-arya.workers.dev](https://dalgo-staging.dalgo-arya.workers.dev) with live play disabled. Supabase is provisioned with all 30 problems, and the saved service credentials are connected. Complete OAuth browser testing, judge verification and multiplayer acceptance remain pending. Public play stays disabled. See [docs/SETUP.md](docs/SETUP.md) for account setup and [docs/LAUNCH.md](docs/LAUNCH.md) for evidence gates.

The private Sites preview hosts only the frontend. Cloudflare staging/production configurations deploy the complete frontend and API with isolated SQLite Durable Objects. All implementation work belongs in `/Users/arya/Developer/Dalgo`.

## Frontend components

Material UI supplies the navigation controls, buttons, dialogs, selection controls, tables, progress indicators, and responsive layout primitives. `src/theme.ts` centralizes the black/charcoal palette, typography, focus styles and reduced-motion behavior. Component layout uses the library's `sx` API; there is no handwritten application stylesheet. Fonts are bundled locally and registered by the theme. Monaco manages its own editor styling.

## Account setup

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the exact owner actions, credential locations and free-judge capacity constraint. `npm run setup:local` creates a private staging settings file without overwriting existing values; `npm run check:setup` reports missing configuration without printing secrets.

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
3. Copy `.env.example` to an ignored `.env` for setup scripts. Copy the Worker variables to ignored `.dev.vars` for local Workers development. The URL and publishable key can reach the frontend. **The service role and JDoodle credentials must never have a `VITE_` prefix.**
4. Seed all immutable problem versions after applying the migration:

```sh
npm run seed:problems
npm run seed:problems -- --apply
```

The dry run makes no network calls. The apply command requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the legacy service-role key); it refuses to change existing problem versions. OAuth creates a profile and six ratings automatically. Browser roles cannot execute settlement, write ratings, or read private tests.

## Judge and launch configuration

See [docs/LAUNCH.md](docs/LAUNCH.md) before providing a verified date or enabling online play. Do not infer account capacity from a marketing allowance. The verification script is opt-in and does not enable play:

```sh
npm run verify:judge -- --help
```

Use a dedicated judge application/account so reconciliation includes all consumption. Execution credits are reserved per human: three sample runs, five submissions, and two operational retries. Ambiguous dispatches count as spent. Bots consume no judge credits.

## Cloudflare deployment

The checked-in configuration uses a free Workers subdomain, SQLite-backed Durable Objects, Worker assets, and a daily source-purge trigger. Authenticate Wrangler with your own Cloudflare account. Keep all numeric launch settings at their disabled defaults until verified.

Use [docs/SETUP.md](docs/SETUP.md) for modern Supabase keys, a separate WebSocket signing secret, and tester access. Secrets are scoped to the selected environment. `ALLOWED_ORIGINS` controls CORS, not tester eligibility.

```sh
npm run check:staging
npm run deploy:staging
```

Production has a separate `npm run deploy:production` command and starts with admission disabled. Configure the final origin in Supabase Auth after deployment. Keep `LIVE_MATCHES_ENABLED=false` until account-specific judge verification passes; staging must still pass the two-account acceptance before public mode is enabled.

## Source map

| Path                                   | Purpose                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `src/`                                 | Responsive arena, match editor, results, history, leaderboard, authentication |
| `shared/`                              | Public contracts, arena and language definitions                              |
| `worker/coordinator.ts`                | One-account ownership, matchmaking, quota and concurrency reservations        |
| `worker/match.ts`                      | Authoritative clocks, private submissions, adjudication, settlement recovery  |
| `worker/judge.ts`, `worker/harness.ts` | Replaceable JDoodle adapter and language wrappers                             |
| `worker/problems.json`                 | Thirty original versioned problems, references, hidden tests; backend only    |
| `public/problems.json`                 | Public statements, examples, and starters only                                |
| `supabase/migrations/`                 | Schema, RLS, atomic Elo settlement, retention                                 |
| `tests/`                               | Offline application and PostgreSQL regression tests                           |

When changing a problem, add a new version and preserve old versions for active matches. Update the public projection and seed the new version before deploying it. Do not remove versions referenced by match history. The Worker bank is the authoritative source for active problem selection; the database retains the same versions for settlement and auditing.

Disconnecting does not pause a match. Reopening its URL restores the clock and attempts. Settlement failures preserve the result and block a new ranked match until retry succeeds. Private sources are removed after 30 days from Supabase and Durable Objects; compact verdicts and the rating ledger remain.

No tournaments, chat, XP, badges, walkthroughs, or automatic cheating detection are included in this beta.
