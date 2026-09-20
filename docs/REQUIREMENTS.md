> **Codebox migration:** The current judge and hosting instructions are in [CODEBOX.md](CODEBOX.md). The JDoodle quota/setup details below are historical and do not apply to the Codebox deployment.

# Dalgo: current status and remaining requirements

Work only in `/Users/arya/Developer/Dalgo`.

## Connected

- Cloudflare staging: https://dalgo-staging.dalgo-arya.workers.dev
- Supabase project: **dalgo-staging**, ref `gtdofekbolymsrrullpb`, Mumbai. The schema and permissions migration are applied; all 30 original problems are loaded.
- Google and GitHub are enabled in Supabase Auth. The owner will test the complete sign-in journey.
- Supabase public/server keys and JDoodle credentials are saved in private `.dev.vars.staging`. The blank Supabase URL was filled from the actual project. No second `.env` file is required.
- JDoodle's credit counter accepted the credentials and reported zero used credits on 12 September 2026. The owner confirmed **20 credits per day**. No judge executions were consumed for this setup check.
- The interface uses black and charcoal surfaces, neutral controls, and a charcoal Monaco editor.

## What is still needed

1. **Choose the attempt allowance.** At one credit per execution, the agreed 3 runs + 5 submissions + 2 retry executions reserve 10 credits per person. Two humans need 20, above the 16-credit admission cap. The optional 2 runs + 4 submissions + 2 retries reserve 8 per person and fit two humans. This reduction awaits owner approval; defaults remain 3/5. Unused reservations are released after matches settle.
2. **Verify JDoodle's runtime and sandbox behavior.** Actual reset time, execution cost and concurrency remain unverified. Provider probes must cover Python, C++, Java and JavaScript, including resource limits and network isolation. Browser testing by the owner does not establish sandbox isolation. Public play stays disabled until this evidence exists.
3. **Sign in with two test identities.** Use different emails. The agent can then retrieve their Supabase UUIDs and add them to the server-side staging allowlist. There were zero registered users at the last check; no passwords need to be shared.
4. **Provide the operator name and a public support email.** These complete the privacy/contact notice. Review `PRIVACY-DRAFT.md` before public registration launches.

No more Cloudflare or Supabase access is currently required. No paid billing is enabled automatically.

## Sign-in URLs in simple steps

Open [Supabase Auth URL configuration](https://supabase.com/dashboard/project/gtdofekbolymsrrullpb/auth/url-configuration).

- Set **Site URL** to `https://dalgo-staging.dalgo-arya.workers.dev`.
- In **Redirect URLs**, include `https://dalgo-staging.dalgo-arya.workers.dev/**`, `http://127.0.0.1:5173/**` and `http://localhost:5173/**` for this isolated staging project.
- Both Google and GitHub OAuth applications must use this callback: `https://gtdofekbolymsrrullpb.supabase.co/auth/v1/callback`.
- Visit Dalgo, sign in, and confirm that you return to Dalgo. Enabled provider flags have been checked; the full login still needs your browser test.

## Local commands

```sh
cd /Users/arya/Developer/Dalgo
npm run check:setup
npm run dev:staging
```

The Vite frontend runs separately with `npm run dev`. The staging Worker listens on port 8787. Setup reports do not print secret values.

The opt-in judge runner supports small, credit-bounded batches. First inspect an estimate with no execution:

```sh
JUDGE_CREDIT_COST=1 npm run verify:judge:staging -- --problem-limit 0 --probe-offset 0 --probe-limit 8
```

Only use `--execute --max-credits N` for an intentional real provider run. Partial reports do not certify the entire problem bank. The full sample/hidden reference matrix and probes exceed one day's free allocation.

## Judge0 / Sulu

The examples README still mentions 20K free Sulu submissions, but Judge0's official [SDK v0.0.5 release](https://github.com/judge0/judge0-python/releases/tag/v0.0.5), dated 8 November 2025, removed Sulu clients because the service shut down. This is not a verified current free allowance. JDoodle remains selected; a provider change requires a working account with verified terms and a compatible adapter.
