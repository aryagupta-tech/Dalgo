# Dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected and verified

- Cloudflare staging: https://dalgo-staging.dalgo-arya.workers.dev
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. Three versioned migrations are applied, RLS is enabled, the security advisor has no findings, and 30 original problems are loaded (10 per arena).
- Codebox runs on Google Cloud VM `dalgo-codebox` in project `dalgo-508410`. It is reachable only through Cloudflare Tunnel and Workers VPC, with one execution and one match at a time.
- Local and hosted verification passed for Python, C++, Java, and JavaScript across all 30 problems. Wrong answers, compile/runtime failures, timeouts, memory/output limits, network blocking, isolation, idempotency, and service restarts were tested.
- The interface uses React and Material UI with black and charcoal surfaces and a charcoal Monaco editor.

## What you need to do

1. **Perform the visual review you reserved for yourself.** Check the lobby, queue, workspace, and results on desktop and mobile.
2. **Provide an operator name and public support email.** These complete the privacy and data-request contact notice.
3. **Monitor the capped public opening.** Production admits signed-in users while retaining one active match and one execution at a time.

No card details, account passwords, paid plan, additional Cloudflare access, or additional Supabase access are required. The Google Cloud VM uses trial credit and has a fixed deletion action for 14 December 2026. Extending it requires a separate decision.

## Completed staging acceptance

Two Google identities created valid profiles and six ratings each. Tester-only staging passed a real human match and a real bot match through Cloudflare Workers, Durable Objects, Workers VPC, Codebox, and Supabase. The checks covered cancellation, human priority, bot fallback, WebSocket reconnects, shared clocks/problems, hosted Run/Submit, +16/−16 Elo, idempotent replay, opponent-code privacy, busy capacity, resignation, and saved history.

The unused Supabase Email provider is disabled. The production Worker is the Auth Site URL, and the redirect allowlist contains production, staging, and local development origins. Production uses public admission with the one-match and one-execution caps.

## Local commands

```sh
cd /Users/arya/Developer/Dalgo
npm run check:setup
npm run dev:staging
```

The setup check prints missing configuration by name and never prints secret values. Staging is restricted to the two tester UUIDs; production uses capped public admission.
