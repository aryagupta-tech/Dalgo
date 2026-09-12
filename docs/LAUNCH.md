# Capped beta launch record

**Current decision: online play disabled.** Cloudflare staging is deployed at https://dalgo-staging.dalgo-arya.workers.dev with live play disabled. Supabase schema/seeding and enabled OAuth providers are verified. Complete browser OAuth, real JDoodle execution/sandbox evidence, and two-account staging acceptance remain pending. Offline verification is recorded separately from external evidence. Never set `JUDGE_VERIFIED_AT` merely because offline tests pass.

## Verification already performed locally

- React/TypeScript production build and the actual Cloudflare Worker start locally.
- PostgreSQL migration tests cover profile creation, six default ratings, browser RLS, atomic settlement, zero-sum human points, bot isolation, conflicting and duplicate settlement, rollback, and source retention.
- Durable Object tests use durable-storage mocks and controlled asynchronous judging. They exercise submission order, bot races, judging timeout, retries, account ownership, quota reservations, cancellation, source validation, and recovery. They do not prove production WebSocket hibernation or cross-region timing.
- Generated Python, C++, and JavaScript programs for all 30 problems were run against sample and hidden suites locally: 180 harness executions, 822 test cases. Java harnesses and all four JDoodle runtimes still require provider testing. Hard-problem references also received independent small-input oracle checks.
- The redesigned demo has browser acceptance coverage at 375, 768, and 1440 CSS pixels, including a 15-second/5-second sequence advanced with a controlled browser clock, draft restoration, all four language starters, preview verdicts, cancellation, restart, and unavailable problem service. It includes keyboard resizing, mobile Problem/Code tabs, focus states, native modal dialogs, and reduced-motion CSS.
- Runtime HTTP checks confirm preview configuration, unauthenticated rejection, blocked foreign origins, body size limits, and required WebSocket upgrades.

## Latest local run — 12 September 2026

- `npm test`: 140 tests passed across 13 files, using patched Vitest 4.1.11.
- `npm run test:browser`: 17 browser tests passed. Live admission uses mocked account/API responses; these tests do not verify real OAuth or hosted services. A stopped search stays stopped after admissions reopen or another tab cancels it. Active matches/searches can be resumed while admissions are paused; mocked OAuth preserves the match route and sample output remains inspectable.
- `npm run build`: TypeScript and production frontend build passed. Monaco remains a large, lazy-loaded editor chunk.
- Staging and production Worker deployment dry runs passed with separate Durable Objects and live matches disabled.
- Seven fresh HTTP smoke checks passed against local workerd: disabled staging configuration, unauthenticated admission/join, foreign-origin rejection, oversize-body rejection, required WebSocket upgrade and demo asset routing.
- Dependency installation audit reports zero known vulnerabilities after the Vitest patch.

The earlier Cloudflare authentication error `10000` is resolved. The staging Worker, assets, SQLite Durable Object namespaces and retention schedule are deployed at https://dalgo-staging.dalgo-arya.workers.dev. Hosted configuration/demo/problem-bank smoke checks returned 200, and unauthenticated admission returned 401. The saved Supabase and JDoodle credentials are connected in the updated staging deployment. Supabase has 30 seeded problems and zero registered users at the last check. Google/GitHub are enabled; their complete browser redirect journey has not been tested in this run. JDoodle's counter accepted the credentials and returned zero used credits; the owner confirms 20/day. Actual judge execution, reset/concurrency and sandbox verification remain outstanding. The black theme and configurable attempt limits passed all 140 offline regressions; the owner requested to perform browser testing personally.

The setup checker now identifies missing local provider settings without printing values and flags allowances too small to reserve a two-human match. The private staging file is initialized with owner-only permissions and is ignored by Git. An eight-probe dry-run plan was verified (10 estimated credits at an explicitly provisional one-credit cost); no provider requests were made. Partial probe reports identify omitted coverage and cannot certify full verification.

## Verify the actual judge account

Record the provider account, date, reviewer, and evidence separately from committed source. Never include API secrets in reports.

| Required evidence                                                                                                                                        | Configuration / decision                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Recurring free daily credits and reset hour in UTC, including provider timezone behavior                                                                 | `JUDGE_DAILY_QUOTA`, `JUDGE_RESET_HOUR_UTC`                 |
| Cost of one batched test-suite execution, including failed or ambiguous requests                                                                         | `JUDGE_CREDIT_COST`                                         |
| Maximum verified concurrent executions and queue/HTTP behavior                                                                                           | `JUDGE_CONCURRENCY`                                         |
| Python 3, C++17, Java, and Node runtime availability and versions                                                                                        | Adapter runtime map; provider reports                       |
| All reference suites pass in all four runtimes                                                                                                           | Chunked verification reports covering every problem/version |
| Syntax errors, wrong answers, runtime errors, infinite loops, memory exhaustion, excess output, and denied outbound network access are classified safely | Sandbox reports and manual review                           |
| Provider isolation is suitable for arbitrary untrusted code                                                                                              | Provider documentation/confirmation plus sandbox probes     |
| No credentials, expected answers, or hidden results are delivered to the sandbox or players                                                              | Payload and response inspection                             |

`scripts/verify-judge.mjs` is an opt-in account probe. Review its dry-run estimate first. A full sample+hidden matrix needs 240 executions plus 32 probes (including wrong-answer and bounded-memory checks), so split reports across free-quota days as necessary. Never enable paid billing to finish verification. A passing script alone does not establish provider concurrency, recurring allowance, reset behavior, or complete sandbox isolation.

Current official references:

- [JDoodle REST API](https://www.jdoodle.com/docs/compiler-apis/jdoodle-api-quickstart/rest-apis/)
- [Languages and runtime indexes](https://www.jdoodle.com/docs/compiler-apis/supported-languages-versions/)
- [API credits](https://www.jdoodle.com/docs/compiler-apis/api-credits/)
- [Timeout behavior](https://www.jdoodle.com/docs/compiler-apis/api-timeout-errors)
- [API FAQs / network access](https://www.jdoodle.com/docs/compiler-apis/api-faqs/)
- [Supabase pricing and free-plan limits](https://supabase.com/pricing)

The adapter sends `internetEnabled: false`. Expected outputs remain in the Worker; only inputs and wrappers enter execution. Request aborts and provider errors produce uncertainty, not a manufactured verdict. A relevant unresolved submission at 150 seconds voids the match.

## Two-account staging acceptance

After the account checks pass, use two test accounts in separate browser profiles against `dalgo-staging`. Set `ADMISSION_MODE=staging`, configure server-only `TESTER_USER_IDS`, then set the verified date, positive integer limits and `LIVE_MATCHES_ENABLED=true` only with recorded judge evidence. This enables invited staging tests while the separate production deployment remains disabled. Empty or malformed tester lists deny admission.

- Verify Google and GitHub sign-in, six ratings, sign-out, expired tokens, and redirect URLs.
- Queue suitable humans in the same arena. Confirm identical problem versions and clocks, widening rating windows, human priority, 15-second bot fallback, and permanently fixed opponents.
- Repeat join/cancel from two tabs and reconnect around bot assignment. Verify one queue or active match per account across all arenas, with no duplicate reservation or match.
- Check real Worker WebSocket upgrades, hibernation, alarms, disconnection/reconnection, and polling recovery. Confirm inactive clients do not stop match clocks.
- Submit earlier/later correct solutions with deliberately reversed judge completion. Test pending human submissions before bot completion and at clock expiry, exact-time draws, neither solving, resignation, and late judging failures.
- Exhaust each player's three runs and five submissions. Verify one execution pending per player and no cross-player use of reserved retry credits. Saturate global concurrency and daily capacity; active match reservations must survive restart and reset.
- Interrupt Supabase during settlement, recover it, and repeat the same settlement. Confirm ratings never partially apply, no points duplicate, and the account stays unavailable for another match until cleanup completes.
- Test browser access to another player's code, private problem data, settlement RPC, rating writes, and forged WebSocket tickets. Confirm all are rejected.
- Review long problem statements, all four starter signatures, editable drafts, editor keyboard escape/resizing, focus visibility, reduced motion, and touch controls on actual devices.
- Run and observe the source-purge cron. Verify Supabase and Durable Object sources disappear after retention while compact match and ledger history remain.

Supabase Free may pause after inactivity. Confirm explicit unavailable states and durable settlement retries before opening the beta. Avoid deploying a problem-bank change that removes versions still needed by active matches.

## Monitoring and opening the cap

The Worker emits structured `judge_result`, `match_settled`, `settlement_pending`, `database_error`, `api_error`, `coordinator_alarm_failed`, and `retention_failed`, `queue_assigned`, and `quota_reconciled` logs without submission source. Monitor judge latency/errors, pending settlements, database growth, and account credit usage. Match history supports human frequency and bot-win analysis. Queue assignment timing tracks queue wait distributions.

Only after the preceding evidence is recorded, set both `ADMISSION_MODE=public` and `LIVE_MATCHES_ENABLED=true` on the intended production beta deployment. Publish the operator contact/privacy information and verify the documented data-request process before opening registration. The coordinator admits reservations within 80% of the configured daily allowance and reconciles usage with JDoodle. Existing reservations remain protected when capacity is exhausted. Leave billing and paid upgrades under deliberate account-owner control.

If any gate fails, retain demo mode and resolve it before ranked play. Changing to Judge0 or another provider requires repeating the runtime, credit/concurrency, and sandbox verification with the replacement adapter.
