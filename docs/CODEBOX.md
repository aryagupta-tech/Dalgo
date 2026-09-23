# Codebox execution hosting

Dalgo uses its pinned Codebox service for Python, C++17, Java, and JavaScript execution. Cloudflare Workers and Supabase remain the web and data services. Codebox has no daily execution-credit counter; admission stays at one active match and one execution globally.

## Migration state (23 September 2026)

- **Staging** uses the AWS host and is restricted to testers. Its Cloudflare Workers VPC service is `01a0cf64-b8d7-7760-8099-4bffab088b05` through tunnel `c52c1164-13e3-457a-a8b1-c8a46d354fb3`.
- **Production** still uses the Google Cloud host and VPC service `01a0bdc2-e64f-7b63-8dae-b0c78031a859`. Do not delete the Google host until a production match and settlement pass after the cutover.
- The complete execution suite passed on the 2 GiB AWS host: all 30 problem references in four languages, expected failure modes, network blocking, and cross-job isolation. Duplicate-job and API/Redis/worker restart checks passed. A Cloudflare remote preview fetched authenticated Codebox health over the AWS Workers VPC service and received `ready=true`, `executor=isolate`, `concurrency=1`. The staging coordinator reported zero active matches before cutover.
- The frontend and database were not moved. Current owner review requires a bot match and, if available, a two-human match on staging before production promotion.

## AWS host and cost boundary

AWS account `846296126198` is on the **Free Plan** with USD 100 in promotional credit at provisioning. The running instance is `i-0dbfb5d512a80c50c` in `ap-south-1a` (Mumbai), type `t4g.small` (2 vCPUs, 2 GiB RAM), with a 20 GiB encrypted gp3 root volume that is deleted with the instance. It uses standard CPU credits, so sustained load can throttle rather than incur surplus CPU-credit charges. The instance and Ubuntu 24.04 ARM64 image are Free Plan eligible. The former 4 GiB `c7i-flex.large` staging VM was terminated after the small host passed verification.

At the AWS Pricing API quote checked on 23 September 2026, compute is USD 0.0112/hour in Mumbai and gp3 storage is USD 0.0912/GiB-month. At 730 hours, compute plus 20 GiB gp3 and one public IPv4 is about USD 13.65/month before tax, transfer, and price changes. The public IPv4 is for SSH administration and outbound updates; Codebox port 3000 is bound only to loopback. The security group `sg-0f9fb71d8769c8796` allows inbound SSH only from the operator's current IP. There is no load balancer or NAT gateway. Monitor Free Plan credits and do not upgrade to a paid plan automatically.

The VM's Docker Compose stack uses `compose.small.yaml` to cap Redis at 128 MiB, the API at 192 MiB, and the worker at 1152 MiB; the `isolate` sandbox remains capped at 512 MiB. It includes the authenticated loopback API, persistent Redis queue, and an `isolate` worker. Only the worker is privileged, as required by its sandbox. Cloudflared runs under systemd and reads its tunnel token from root-only `/etc/cloudflared/token`; the token is not in the repository or process arguments. Docker services restart automatically, logs are bounded, and execution records expire within 24 hours.

## Deploy and verify

Use `/Users/arya/Developer/Dalgo` as the repository. The private `services/codebox/.env` and SSH key stay on this Mac. Query the current public IP because it can change when an instance stops:

```sh
aws ec2 describe-instances --region ap-south-1 --instance-ids i-0dbfb5d512a80c50c \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
npm run deploy:codebox:aws -- PUBLIC_IPV4 /Users/arya/.ssh/dalgo-codebox-aws-2026 small
ssh -i /Users/arya/.ssh/dalgo-codebox-aws-2026 -N \
  -L 127.0.0.1:3001:127.0.0.1:3000 ubuntu@PUBLIC_IPV4
```

With the port forward running in another terminal:

```sh
CODEBOX_LOCAL_URL=http://127.0.0.1:3001 npm run verify:codebox
CODEBOX_LOCAL_URL=http://127.0.0.1:3001 \
  CODEBOX_RECOVERY_AWS_HOST=PUBLIC_IPV4 \
  CODEBOX_RECOVERY_AWS_KEY=/Users/arya/.ssh/dalgo-codebox-aws-2026 \
  CODEBOX_RECOVERY_AWS_SMALL=1 npm run verify:codebox:recovery
```

Do not make port 3000 publicly reachable. The Codebox token is required even across the private tunnel. Dalgo alone compares submitted output with expected answers; Codebox receives no hidden expected answers or rating-write permission.

## Production cutover

After owner staging acceptance, pause public admission in the production Worker while it still points to Google Cloud. Allow up to 35 minutes for the longest existing match and pending judging to finish, then bind production to the AWS VPC service with admission still paused. Verify authenticated edge-to-AWS health and a complete production bot match before reopening admission. Once history and settlement are confirmed, remove the old Google Cloud Codebox VM and its tunnel/service; keep the Cloudflare site and Supabase project. Production source changes are promoted from `develop` to `main` by the owner after staging review.

The old Google Cloud host is `dalgo-codebox` in project `dalgo-508410`, zone `asia-southeast1-b`. Historical Google deployment and verification details are in `CODEBOX-VERIFICATION.md`.
