# dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected and verified

- Canonical production: https://dalgo.site
- Tester staging: https://staging.dalgo.site
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. The versioned schema migrations are applied, RLS is enabled, database/RLS checks have no findings, and 30 original problems are loaded (10 per arena). The Auth advisor retains its Free-plan password warning even though password/email sign-in is disabled.
- Production and staging Codebox use AWS VM `i-0dbfb5d512a80c50c` in Mumbai. Both Workers connect through the private Cloudflare Tunnel and VPC service. Production allows one match and one execution at a time; staging admission is paused while sharing that host.
- Local and hosted verification passed for Python, C++, Java, and JavaScript across all 30 problems. Wrong answers, compile/runtime failures, timeouts, memory/output limits, network blocking, isolation, idempotency, and service restarts were tested.
- The interface uses React and Material UI with black and charcoal surfaces and a charcoal Monaco editor.

## What remains

1. Review the social and Glicko changes on `develop`; do not apply their rating migration while old production matches could still settle. Production currently retains the existing Elo rules.
2. Before staging the Glicko cutover, pause and drain production matches, apply the compatible migration, and deploy the updated Worker. Keep staging tester-only and complete a human and bot settlement check before promoting these features to `main`.
3. Monitor AWS Free Plan credit. The 2 GiB t4g.small VM costs about USD 13.65/month at continuous use before tax and traffic at the previously checked quote; the USD 100 credit is temporary. Do not upgrade to a paid plan automatically.

No new card details, passwords, or additional Supabase access are needed. The old Google Cloud execution resources are removed; keep the Google OAuth project.

## Completed staging acceptance

Two Google identities created valid profiles and six ratings each during the acceptance run. Tester-only staging passed a real human match and a real bot match through Cloudflare Workers, Durable Objects, Workers VPC, Codebox, and Supabase. The checks covered cancellation, human priority, bot fallback, WebSocket reconnects, shared clocks/problems, hosted Run/Submit, +16/−16 Elo, idempotent replay, opponent-code privacy, busy capacity, resignation, and saved history. One tester was later hard-deleted at the owner's request, so a fresh second account is needed to repeat live two-player checks after further matchmaking changes.

The unused Supabase Email provider is disabled. The production Worker is the Auth Site URL, and the redirect allowlist contains production, staging, and local development origins. Production uses public admission with the one-match and one-execution caps.

## Local commands

```sh
cd /Users/arya/Developer/Dalgo
npm run check:setup
npm run dev:staging
```

The setup check prints missing configuration by name and never prints secret values. Staging is restricted to the two tester UUIDs; production uses capped public admission.
