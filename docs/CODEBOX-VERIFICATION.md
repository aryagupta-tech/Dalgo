# Codebox verification — 20 September 2026

## Completed locally

- Frontend build and TypeScript checks passed.
- All 167 offline regressions passed, including SQL settlement, receipt ordering, bot races, Codebox recovery, capacity ownership, and launch gates.
- All 148 execution checks passed on local ARM64 Docker: 30 original problems in each of four languages, 24 wrong-answer/compiler/runtime/resource probes, two cross-job isolation checks, and two output-file tampering checks.
- The local Redis/API/worker recovery run passed: concurrent duplicate requests returned one job; conflicting payloads were rejected; API and Redis restarts preserved the result; a killed worker produced an infrastructure error without rerunning the attempt; unauthenticated, expired, and unsupported requests were rejected.

## Completed on Google Cloud

- Project `dalgo-508410` now has a dedicated `t2a-standard-2` ARM64 VM named `dalgo-codebox` in `asia-southeast1-b` with 2 vCPUs, 8 GB RAM, and a 30 GB standard disk.
- The VM uses a dedicated `dalgo-judge` network. The only inbound firewall rule is TCP 22 from the operator's recorded public IP. Codebox binds to `127.0.0.1:3000`; Redis has no host port and the VM has no service account.
- Shielded VM Secure Boot, vTPM, and integrity monitoring are enabled. The VM and auto-delete disk have an absolute deletion action scheduled for 14 December 2026 so this trial deployment cannot silently continue indefinitely.
- Docker, Compose, and cloudflared were installed from their official repositories. Codebox built natively on ARM64 and reported `ready=true`, `executor=isolate`, and `concurrency=1`.
- The complete 148-execution suite passed again through an SSH port forward to the hosted loopback API. Python, C++, Java, and JavaScript reference solutions passed for all 30 problems. Wrong answers, compile/runtime errors, timeouts, memory pressure, excessive output, cross-job isolation, output symlinks, and FIFO output were handled as expected.
- Hosted recovery checks passed: parallel duplicates executed once; conflicting payloads were rejected; API and Redis restarts preserved the job; a killed worker returned an infrastructure error without rerunning; missing authentication, expired jobs, and forbidden options were rejected.
- Python 3.12.3, GCC 13.3.0 with C++17, OpenJDK 17.0.20, Node 24.21.0, and isolate 2.7 were verified.

The machine-readable report is in the ignored `artifacts/codebox-verification.json`. The hosted API remains private and the temporary SSH forward was closed after verification. The verified timestamp recorded in staging is `2026-09-20T07:49:07.429Z`.

## Completed on Cloudflare and Supabase

- Cloudflare is authorized as `aryaguptaa.vns@gmail.com`. The named tunnel `dalgo-codebox-staging` is healthy and runs as a system service on the VM.
- Workers VPC service `01a0bdc2-e64f-7b63-8dae-b0c78031a859` reaches Codebox at `127.0.0.1:3000`; no public Codebox hostname exists.
- Staging has the `CODEBOX` VPC binding and private `CODEBOX_AUTH_TOKEN` secret. A short-lived edge Worker verified the complete Cloudflare edge → Workers VPC → tunnel → Google VM → Codebox path and received `ready=true`, `executor=isolate`, and `concurrency=1`.
- Supabase project `gtdofekbolymsrrullpb` is restored. Five versioned migrations are applied, 30 distinct problems are seeded (10 per arena), all public tables use RLS, and hidden problem data has an explicit deny policy for browser roles. Database/RLS checks have no findings; the Auth advisor retains its Free-plan password warning even though password/email sign-in is disabled.

## Completed on live staging

Two real Google users were added to the server-only allowlist. A live human match verified cancellation, human priority, identical problems/clocks, WebSocket reconnect, hosted sample/scored execution, opponent submission privacy, idempotent replay, +16/−16 Elo settlement, and saved history. A separate live bot match verified the 15-second fallback, explicit bot label, capacity rejection while busy, resignation, bot-only rating update, and persistence. Production uses capped public admission after the hosted and two-account checks passed.
