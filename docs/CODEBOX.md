# Codebox execution hosting

Dalgo uses its pinned Codebox service for Python, C++17, Java, and JavaScript execution. Cloudflare Workers and Supabase remain the web and data services. Codebox has no daily execution-credit counter; admission stays at one active match and one execution globally.

## Migration state (23 September 2026)

- **Staging** uses the AWS host and is restricted to testers. Its Cloudflare Workers VPC service is `01a0cf03-f4bc-7ae3-9537-12639b2fa2cb` through tunnel `89685e0c-8460-4470-ba5d-4aff95da5a25`.
- **Production** still uses the Google Cloud host and VPC service `01a0bdc2-e64f-7b63-8dae-b0c78031a859`. Do not delete the Google host until a production match and settlement pass after the cutover.
- The complete 148-execution suite passed on AWS: all 30 problem references in four languages, expected failure modes, network blocking, and cross-job isolation. Duplicate-job and API/Redis/worker restart checks passed. A Cloudflare remote preview fetched authenticated Codebox health over the AWS Workers VPC service and received `ready=true`, `executor=isolate`, `concurrency=1`.
- The frontend and database were not moved. Current owner review requires a bot match and, if available, a two-human match on staging before production promotion.

## AWS host and cost boundary

AWS account `846296126198` is on the **Free Plan** with USD 100 in promotional credit at provisioning. The running instance is `i-086fe66f4f3fedcf9` in `ap-south-1a` (Mumbai), type `c7i-flex.large` (2 vCPUs, 4 GiB RAM), with a 30 GiB encrypted gp3 root volume that is deleted with the instance. AWS rejected `t4g.medium` because it is not Free Plan eligible; no paid-plan upgrade was made. The instance and Ubuntu 24.04 AMD64 image are Free Plan eligible.

At the AWS Pricing API quote checked on 23 September 2026, compute is USD 0.08479/hour in Mumbai. At 730 hours, compute plus 30 GiB gp3 and one public IPv4 is about USD 68.28/month before tax, transfer, and price changes. The public IPv4 is for SSH administration and outbound updates; Codebox port 3000 is bound only to loopback. The security group `sg-0f9fb71d8769c8796` allows inbound SSH only from the operator's current IP. There is no load balancer or NAT gateway. Monitor Free Plan credits because continuous operation at this size can consume USD 100 in roughly six weeks. Do not upgrade to a paid plan automatically.

The VM's Docker Compose stack includes the authenticated loopback API, persistent Redis queue, and an `isolate` worker. Only the worker is privileged, as required by its sandbox. Cloudflared runs under systemd and reads its tunnel token from root-only `/etc/cloudflared/token`; the token is not in the repository or process arguments. Docker services restart automatically, logs are bounded, and execution records expire within 24 hours.

## Deploy and verify

Use `/Users/arya/Developer/Dalgo` as the repository. The private `services/codebox/.env` and SSH key stay on this Mac. Query the current public IP because it can change when an instance stops:

```sh
aws ec2 describe-instances --region ap-south-1 --instance-ids i-086fe66f4f3fedcf9 \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
npm run deploy:codebox:aws -- PUBLIC_IPV4 /Users/arya/.ssh/dalgo-codebox-aws-2026
ssh -i /Users/arya/.ssh/dalgo-codebox-aws-2026 -N \
  -L 127.0.0.1:3001:127.0.0.1:3000 ubuntu@PUBLIC_IPV4
```

With the port forward running in another terminal:

```sh
CODEBOX_LOCAL_URL=http://127.0.0.1:3001 npm run verify:codebox
CODEBOX_LOCAL_URL=http://127.0.0.1:3001 \
  CODEBOX_RECOVERY_AWS_HOST=PUBLIC_IPV4 \
  CODEBOX_RECOVERY_AWS_KEY=/Users/arya/.ssh/dalgo-codebox-aws-2026 \
  npm run verify:codebox:recovery
```

Do not make port 3000 publicly reachable. The Codebox token is required even across the private tunnel. Dalgo alone compares submitted output with expected answers; Codebox receives no hidden expected answers or rating-write permission.

## Production cutover

After owner staging acceptance, pause public admission in the production Worker while it still points to Google Cloud. Allow up to 35 minutes for the longest existing match and pending judging to finish, then bind production to the AWS VPC service with admission still paused. Verify authenticated edge-to-AWS health and a complete production bot match before reopening admission. Once history and settlement are confirmed, remove the old Google Cloud Codebox VM and its tunnel/service; keep the Cloudflare site and Supabase project. Production source changes are promoted from `develop` to `main` by the owner after staging review.

The old Google Cloud host is `dalgo-codebox` in project `dalgo-508410`, zone `asia-southeast1-b`. Historical Google deployment and verification details are in `CODEBOX-VERIFICATION.md`.
