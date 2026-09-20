# Codebox on Google Cloud

Dalgo uses its pinned Codebox service for code execution. The former JDoodle adapter remains available only when `JUDGE_PROVIDER=jdoodle` is set explicitly for old deployments and regression coverage. Codebox has no daily execution-credit counter.

## Current deployment

The repository contains a private Codebox API, Redis/BullMQ queue, ARM64/AMD64 execution image, Cloudflare adapter, recovery tests, and deployment scripts. The inspected upstream revision is recorded in `services/codebox/UPSTREAM.md`.

Local and hosted execution and restart verification passed; see `CODEBOX-VERIFICATION.md`. Cloudflare staging is deployed with live play disabled. The Codebox VM is running and verified. The Google Cloud project is `dalgo-508410`, authenticated locally as `aryaguptaa.vns@gmail.com`.

## Google Cloud server

Use one dedicated Compute Engine VM:

- Zone: `asia-southeast1-b` (Singapore, the nearest region offering Tau T2A ARM)
- Machine: `t2a-standard-2` (2 ARM vCPUs, 8 GB RAM)
- Image: Ubuntu 24.04 LTS ARM64
- Disk: 30 GB `pd-standard`, deleted with the VM
- Network: dedicated `dalgo-judge` VPC with only SSH from the operator's current IP
- Application ports: none exposed publicly; Codebox listens on `127.0.0.1:3000`
- Service account: none; Codebox does not need Google API credentials
- Expiry: an absolute termination time with `DELETE`, set within the trial period

This VM is covered by available trial credit, not Google Cloud's permanent Free Tier. The always-free `e2-micro` has only 1 GB RAM and cannot safely run Codebox. The deletion deadline prevents the prepared VM from silently continuing after the intended trial window. Confirm remaining trial credit in Cloud Billing before extending or recreating it.

`infra/gcp/bootstrap.sh` installs Docker and cloudflared from their official repositories. The worker requires `isolate`, private cgroups, and privileged namespace/mount access on this dedicated VM. The API and Redis containers remain unprivileged and Redis is private to the Compose network.

Deploy the service from the repository without copying Supabase or OAuth secrets:

```sh
npm run deploy:codebox:gcp -- dalgo-codebox asia-southeast1-b dalgo-508410
```

For hosted verification, forward the private API locally:

```sh
gcloud compute ssh dalgo-codebox \
  --project=dalgo-508410 \
  --zone=asia-southeast1-b \
  -- -N -L 3000:127.0.0.1:3000
```

Then run `npm run verify:codebox` and `npm run verify:codebox:recovery`. A passing local report does not replace this hosted run.

## Connect Cloudflare privately

Create the named tunnel `dalgo-codebox-staging` and run `cloudflared` as a service on the VM. Create an HTTP Workers VPC service that reaches `localhost:3000` through that tunnel; do not create a public hostname for Codebox.

Save the returned service ID in staging:

```sh
node scripts/configure-codebox-binding.mjs staging SERVICE_ID
```

Set the Worker secret `CODEBOX_AUTH_TOKEN` from `services/codebox/.env` using Wrangler secret input. Never store this token in a `VITE_` variable or print it. Deploy with `npm run deploy:staging` while `LIVE_MATCHES_ENABLED=false`.

After hosted verification, set `JUDGE_VERIFIED_AT` to the hosted verification time, retain `MAX_ACTIVE_MATCHES=1` and `JUDGE_CONCURRENCY=1`, configure the two tester user IDs, and enable staging only. Verify real bot and human matches, reconnects, timeouts, judging races, and settlement recovery before considering public admission.

## Operations and recovery

- The Coordinator allows one active match and one execution globally. Other players receive a server-busy state.
- A received attempt gets one deterministic job ID and retains its original 150-second deadline. Retries reuse the same execution.
- Dalgo compares structured outputs and decides verdicts. Codebox never writes ratings or receives hidden expected answers.
- Redis persists job identity and results. A killed worker marks its job as an infrastructure failure rather than executing it twice.
- Execution records are removed within 24 hours. Logs omit source and are capped at three 10 MB files per service.
- Sandbox health failure blocks new admissions. There is no fallback to an unverified executor.
- Before updates, disable admissions, settle active matches, deploy the pinned source, repeat hosted verification, then reopen staging.

Sources: https://docs.cloud.google.com/free/docs/free-cloud-features, https://docs.cloud.google.com/compute/docs/instances/limit-vm-runtime, and https://developers.cloudflare.com/workers-vpc/platform/pricing/.
