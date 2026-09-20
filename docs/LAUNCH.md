# Capped beta launch record

**Current decision: tester-only staging enabled; public play disabled.** Staging at https://dalgo-staging.dalgo-arya.workers.dev reports `playEnabled=true` for two server-side allowlisted accounts. Production at https://dalgo.dalgo-arya.workers.dev reports `playEnabled=false` with `ADMISSION_MODE=disabled`. OAuth and signed-in human/bot staging acceptance passed; owner visual/privacy review remains before public admission.

## Verified evidence

- The React/TypeScript production build passes and the interface is implemented with React, Material UI, and Monaco.
- All 167 backend regressions pass, covering SQL settlement, submission receipt ordering, bot races, reconnect behavior, capacity ownership, launch gates, and Codebox recovery.
- The complete 148-execution suite passed on the hosted ARM64 Google Cloud VM: reference solutions for 30 problems in Python, C++, Java, and JavaScript, plus wrong-answer, compile/runtime, timeout, memory, output, network, isolation, and output-file probes.
- Hosted recovery passed for parallel idempotent requests, conflicting payloads, API/Redis restarts, worker failure without duplicate execution, authentication, expiry, and forbidden options.
- Codebox reports isolate 2.7, Python 3.12.3, GCC 13.3.0 with C++17, OpenJDK 17.0.20, and Node 24.21.0.
- The Cloudflare edge → Workers VPC → named tunnel → Google VM → Codebox route passed a private health request. No execution port or hostname is public.
- Supabase has three applied migrations, seven RLS-protected public tables, 30 distinct problem versions, and no security-advisor findings. Hidden tests and reference solutions are denied to browser roles.
- The initial cap is one match and one execution at a time. Codebox uses server capacity instead of daily execution credits.

The detailed executor record is in [CODEBOX-VERIFICATION.md](CODEBOX-VERIFICATION.md). Machine-readable reports stay in ignored `artifacts/` files because they include operational detail.

## Two-account staging acceptance — passed 20 September 2026

Two Google users are stored in the server-only `TESTER_USER_IDS` list and staging is enabled only for those accounts. The live acceptance created one human match and one labelled bot match and verified the complete Worker → Codebox → settlement path.

- Verify Google and GitHub sign-in, six ratings, sign-out, expired tokens, and redirect URLs.
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

## Opening the public beta

Before public admission:

1. Publish the operator name, support email, privacy notice, and data-request instructions.
2. Confirm remaining Google Cloud trial credit and the VM deletion deadline. Do not extend or create paid resources without a separate decision.
3. Review execution latency, infrastructure errors, settlement retries, database growth, queue time, bot win rate, and capacity saturation from staging.
4. Deploy production with its own secrets and private Codebox binding.
5. Set `ADMISSION_MODE=public` and `LIVE_MATCHES_ENABLED=true` only after production smoke checks pass.

The Google Cloud VM has a fixed deletion action for 14 December 2026. Cloudflare, Supabase, or Google billing upgrades are never automatic.
