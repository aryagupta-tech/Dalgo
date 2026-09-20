# Dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected and verified

- Cloudflare staging: https://dalgo-staging.dalgo-arya.workers.dev
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. Three versioned migrations are applied, RLS is enabled, the security advisor has no findings, and 30 original problems are loaded (10 per arena).
- Codebox runs on Google Cloud VM `dalgo-codebox` in project `dalgo-508410`. It is reachable only through Cloudflare Tunnel and Workers VPC, with one execution and one match at a time.
- Local and hosted verification passed for Python, C++, Java, and JavaScript across all 30 problems. Wrong answers, compile/runtime failures, timeouts, memory/output limits, network blocking, isolation, idempotency, and service restarts were tested.
- The interface uses React and Material UI with black and charcoal surfaces and a charcoal Monaco editor.

## What you need to do

1. **Perform the visual review you reserved for yourself.** Tester-only staging is live. Check the lobby, queue, workspace, and results on desktop and mobile.
2. **Provide an operator name and public support email.** These complete the privacy and data-request contact notice before public registration.
3. **Disable the unused Email provider in Supabase Auth.** Dalgo exposes Google/GitHub sign-in only. The Free plan cannot enable the Pro-only leaked-password check, so disabling password/email sign-in keeps the public authentication surface aligned with the product.
4. **Confirm the capped public opening.** Production is deployed but remains disabled until the preceding items are complete.

No card details, account passwords, paid plan, additional Cloudflare access, or additional Supabase access are required. The Google Cloud VM uses trial credit and has a fixed deletion action for 14 December 2026. Extending it requires a separate decision.

## Completed staging acceptance

Two Google identities created valid profiles and six ratings each. Tester-only staging passed a real human match and a real bot match through Cloudflare Workers, Durable Objects, Workers VPC, Codebox, and Supabase. The checks covered cancellation, human priority, bot fallback, WebSocket reconnects, shared clocks/problems, hosted Run/Submit, +16/−16 Elo, idempotent replay, opponent-code privacy, busy capacity, resignation, and saved history.

## Local commands

```sh
cd /Users/arya/Developer/Dalgo
npm run check:setup
npm run dev:staging
```

The setup check prints missing configuration by name and never prints secret values. Staging is restricted to the two tester UUIDs; production remains disabled.
