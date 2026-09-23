# dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected and verified

- Canonical production: https://dalgo.site
- Tester staging: https://staging.dalgo.site
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. Five versioned migrations are applied, RLS is enabled, database/RLS checks have no findings, and 30 original problems are loaded (10 per arena). The Auth advisor retains its Free-plan password warning even though password/email sign-in is disabled.
- Staging Codebox runs on AWS VM `i-0dbfb5d512a80c50c` in Mumbai; production still uses Google Cloud VM `dalgo-codebox` during migration. Both are reachable only through Cloudflare Tunnel and Workers VPC, with one execution and one match at a time.
- Local and hosted verification passed for Python, C++, Java, and JavaScript across all 30 problems. Wrong answers, compile/runtime failures, timeouts, memory/output limits, network blocking, isolation, idempotency, and service restarts were tested.
- The interface uses React and Material UI with black and charcoal surfaces and a charcoal Monaco editor.

## What you need to do

1. Test a complete bot match on [staging](https://staging.dalgo.site), including Run, Submit, result, rating, and history. If a second tester is available, complete a two-human match too.
2. After staging acceptance, promote the verified change through `develop` to `main` using the existing pull-request workflow. The production Codebox cutover must pause admission and drain existing matches before switching the private binding.
3. Monitor AWS Free Plan credit. The 2 GiB t4g.small VM costs about USD 13.65/month at continuous use before tax and traffic; the USD 100 credit is temporary. Do not upgrade to a paid plan automatically.

No new card details, passwords, or additional Supabase access are needed. The old Google Cloud VM stays running until production execution, history, and settlement pass on AWS.

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
