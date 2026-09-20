# Dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected and verified

- Cloudflare staging: https://dalgo-staging.dalgo-arya.workers.dev
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. Three versioned migrations are applied, RLS is enabled, the security advisor has no findings, and 30 original problems are loaded (10 per arena).
- Codebox runs on Google Cloud VM `dalgo-codebox` in project `dalgo-508410`. It is reachable only through Cloudflare Tunnel and Workers VPC, with one execution and one match at a time.
- Local and hosted verification passed for Python, C++, Java, and JavaScript across all 30 problems. Wrong answers, compile/runtime failures, timeouts, memory/output limits, network blocking, isolation, idempotency, and service restarts were tested.
- The interface uses React and Material UI with black and charcoal surfaces and a charcoal Monaco editor.

## What you need to do

1. **Sign in with two test identities.** Open staging in two separate browser profiles and sign in with different Google or GitHub accounts. This creates the two Supabase users needed for the server-side tester allowlist. Do not share passwords.
2. **Tell Codex when both sign-ins are complete.** Their Supabase UUIDs can then be added to staging, live play can be enabled for only those accounts, and the real bot/two-human acceptance checks can run.
3. **Provide an operator name and public support email before a public beta.** These complete the privacy and contact notice in `PRIVACY-DRAFT.md`.
4. **Perform the visual review you reserved for yourself.** Check the lobby, queue, workspace, and results on desktop and mobile before public admission.

No card details, account passwords, paid plan, additional Cloudflare access, or additional Supabase access are required. The Google Cloud VM uses trial credit and has a fixed deletion action for 14 December 2026. Extending it requires a separate decision.

## Sign-in steps

1. Open [Dalgo staging](https://dalgo-staging.dalgo-arya.workers.dev) in a normal browser profile.
2. Choose Google or GitHub sign-in and finish the provider flow.
3. Confirm that Dalgo opens again and shows the signed-in account.
4. Repeat in a private/incognito or second browser profile with another account.
5. Tell Codex: “both tester accounts signed in.”

If the provider redirect is rejected, open [Supabase Auth URL configuration](https://supabase.com/dashboard/project/gtdofekbolymsrrullpb/auth/url-configuration) and use:

- Site URL: `https://dalgo-staging.dalgo-arya.workers.dev`
- Redirect URL: `https://dalgo-staging.dalgo-arya.workers.dev/**`
- Provider callback: `https://gtdofekbolymsrrullpb.supabase.co/auth/v1/callback`

## Local commands

```sh
cd /Users/arya/Developer/Dalgo
npm run check:setup
npm run dev:staging
```

The setup check prints missing configuration by name and never prints secret values. Live play remains disabled until the two tester IDs are configured and signed-in acceptance passes.
