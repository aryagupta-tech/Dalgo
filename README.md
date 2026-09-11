# Dalgo

A dark DSA duel arena built with React, TypeScript, Vite, Monaco, Supabase, and Cloudflare Durable Objects. Three arenas, shared clocks, separate human/bot Elo ratings, and function-style Python, C++, Java, and JavaScript submissions.

## Current state

The interface and backend implementation are present. The site opens in **arena preview mode** until the launch gate is explicitly configured. Preview supports browsing problem statements, switching languages, editing local drafts, and resizing the editor. It does not execute code or award points.

The backend includes OAuth session verification, durable human matchmaking and bot fallback, execution reservations, a server-only **JDoodle** adapter, receipt-ordered adjudication, WebSockets with polling recovery, and transactional Supabase settlement. JDoodle credentials, an actual Supabase project, and Cloudflare deployment are still required for online matches. Public play is intentionally disabled pending the checks in [docs/LAUNCH.md](docs/LAUNCH.md).

The private Sites preview hosts the frontend only. The supplied `wrangler.jsonc` deploys the complete frontend and API together on Cloudflare Workers, with the required Durable Object bindings. Do not enable ranked matches on an unverified provider.

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

Open `http://127.0.0.1:5173`. Vite proxies `/api` and WebSockets to the local Worker on port 8787. Without service configuration, preview mode works and privileged routes reject unauthenticated requests.

```sh
npm test
npm run typecheck
npm run build
```

The offline tests exercise rating conservation, queue windows, bots, receipt ordering, deadlines, retries, durable recovery, quota ownership, source privacy, launch gates, and the real SQL migration in embedded PostgreSQL. External judge and two-account production tests remain separate launch requirements.

## Connect Supabase

1. Create a Supabase project on the free plan. Apply `supabase/migrations/202609110001_dalgo.sql` using the Supabase SQL editor or a version-controlled Supabase CLI migration workflow.
2. Enable Google and GitHub in Authentication → Providers. Create provider OAuth applications using the callback URL shown by Supabase. Set the Supabase site URL and allowed redirect URLs to your frontend origin; include `http://127.0.0.1:5173` for local development. The frontend redirects OAuth back to its own origin.
3. Copy `.env.example` to an ignored `.env` for setup scripts. Copy the Worker variables to ignored `.dev.vars` for local Workers development. The URL and anonymous/publishable key can reach the frontend. **The service role and JDoodle credentials must never have a `VITE_` prefix.**
4. Seed all immutable problem versions after applying the migration:

```sh
npm run seed:problems
npm run seed:problems -- --apply
```

The dry run makes no network calls. The apply command requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it refuses to change existing problem versions. OAuth creates a profile and six ratings automatically. Browser roles cannot execute settlement, write ratings, or read private tests.

## Judge and launch configuration

See [docs/LAUNCH.md](docs/LAUNCH.md) before providing a verified date or enabling online play. Do not infer account capacity from a marketing allowance. The verification script is opt-in and does not enable play:

```sh
npm run verify:judge -- --help
```

Use a dedicated judge application/account so reconciliation includes all consumption. Execution credits are reserved per human: three sample runs, five submissions, and two operational retries. Ambiguous dispatches count as spent. Bots consume no judge credits.

## Cloudflare deployment

The checked-in configuration uses a free Workers subdomain, SQLite-backed Durable Objects, Worker assets, and a daily source-purge trigger. Authenticate Wrangler with your own Cloudflare account. Keep all numeric launch settings at their disabled defaults until verified.

Set these as Worker secrets using `npx wrangler secret put NAME`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JDOODLE_CLIENT_ID`, and `JDOODLE_CLIENT_SECRET`. Set non-secret limits and allowed frontend origins in `wrangler.jsonc`. Do not paste secrets into configuration committed to Git.

```sh
npm run deploy:cloudflare
```

Add the resulting Workers origin to Supabase's allowed redirect URLs. A separate frontend deployment can use `VITE_API_BASE` at build time; add that frontend origin to the Worker's `ALLOWED_ORIGINS`. The default same-origin deployment needs no Vite credentials.

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
