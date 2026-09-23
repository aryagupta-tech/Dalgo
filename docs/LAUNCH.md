# Capped beta launch record

This is the original launch record. Codebox moved fully to AWS on 24 September 2026; see [CODEBOX.md](CODEBOX.md) for the current production setup. The Google Cloud references below describe historical verification only.

**Current decision: capped public play enabled.** Staging at https://staging.dalgo.site is protected by Cloudflare Access and remains limited to approved tester emails plus the server-side tester allowlist. Production at https://dalgo.site uses `ADMISSION_MODE=public` with `playEnabled=true`. The `workers.dev` routes are disabled. The one-match and one-execution capacity caps remain enforced.

## Verified evidence

- The React/TypeScript production build passes and the interface is implemented with React, Material UI, and Monaco.
- All 163 backend regressions pass, covering SQL settlement, submission receipt ordering, username onboarding, friend challenges, bot races, reconnect behavior, capacity ownership, launch gates, and Codebox recovery.
- The complete 148-execution suite passed on the hosted ARM64 Google Cloud VM: reference solutions for 30 problems in Python, C++, Java, and JavaScript, plus wrong-answer, compile/runtime, timeout, memory, output, network, isolation, and output-file probes.
- Hosted recovery passed for parallel idempotent requests, conflicting payloads, API/Redis restarts, worker failure without duplicate execution, authentication, expiry, and forbidden options.
- Codebox reports isolate 2.7, Python 3.12.3, GCC 13.3.0 with C++17, OpenJDK 17.0.20, and Node 24.21.0.
- The Cloudflare edge → Workers VPC → named tunnel → Google VM → Codebox route passed a private health request. No execution port or hostname is public.
- Supabase has five applied migrations, eight RLS-protected public tables, 30 distinct problem versions, and no database/RLS security findings. Hidden tests and reference solutions are denied to browser roles. The Auth advisor retains the Free plan’s generic leaked-password warning, but dalgo exposes no password login surface.
- Dalgo presents Google sign-in only. Email sign-in is disabled; disable the legacy GitHub provider in hosted Supabase Auth settings during rollout. The production Worker is the Site URL, and production, staging, and local development origins are allowlisted redirects.
- The initial cap is one match and one execution at a time. Codebox uses server capacity instead of daily execution credits.
- One-time unique username onboarding and participant-only friend challenge storage are migrated. Direct challenge acceptance reuses the authoritative human MatchRoom, Codebox, Elo, and settlement path.

The detailed executor record is in [CODEBOX-VERIFICATION.md](CODEBOX-VERIFICATION.md). Machine-readable reports stay in ignored `artifacts/` files because they include operational detail.

## Two-account staging acceptance — passed 20 September 2026

Two Google identities were stored in the server-only `TESTER_USER_IDS` list for this acceptance run. The live acceptance created one human match and one labelled bot match and verified the complete Worker → Codebox → settlement path. One tester account was later hard-deleted at the owner's request; a fresh second account is required before repeating two-player staging checks.

- Verify Google sign-in, six ratings, sign-out, expired tokens, and redirect URLs.
- Queue both testers in the same arena. Confirm identical problem versions and clocks, widening rating windows, human priority, 15-second bot fallback, and permanently fixed opponents.
- Repeat join/cancel from two tabs and reconnect around assignment. Confirm one queue or active match per account and no duplicate match.
- Verify WebSocket upgrades, hibernation, alarms, reconnects, and polling recovery. Disconnecting must not pause the clock.
- Submit correct solutions with deliberately reversed completion order. Test bot races, pending submissions at expiry, draws, resignation, and late infrastructure failures.
- Exhaust three runs and five submissions. Confirm one pending execution per player and a clear server-busy state while capacity is occupied.
- Interrupt and recover Supabase settlement. Repeating the settlement key must not duplicate points or partially update ratings.
- Try to access another player’s code, private problem rows, settlement RPC, rating writes, and forged WebSocket tickets from a client. All must be rejected.
- Review the lobby, queue, workspace, results, all four starters, draft restoration, keyboard controls, reduced motion, focus visibility, and mobile layouts.
- Run the retention cron and confirm private submission sources disappear after the retention window while compact match history remains.

The automated live checks passed. Keep staging tester-only during the owner’s visual review; any new failure closes live staging before production changes.

## Public beta operation

Public admission was enabled after the automated, hosted, and two-account acceptance checks above passed. During the beta:

1. Keep the published [privacy and data-request notice](PRIVACY.md) current. Dalgo is operated by Arya Gupta and uses `aryaguptaa.vns@gmail.com` for public support and data requests.
2. Monitor remaining AWS Free Plan credit and VM health. Do not upgrade to a paid plan without a separate decision.
3. Review execution latency, infrastructure errors, settlement retries, database growth, queue time, bot win rate, and capacity saturation.
4. Keep production secrets and the private Codebox binding isolated from staging.
5. If a production smoke check or executor health check fails, set `ADMISSION_MODE=disabled` and `LIVE_MATCHES_ENABLED=false` before investigating.

The old Google Cloud Codebox VM and its dedicated resources were deleted on 24 September 2026. Cloudflare, Supabase, and AWS billing upgrades are never automatic.
