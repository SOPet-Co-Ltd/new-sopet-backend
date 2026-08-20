# Deployment

## Docker

### Local infrastructure

`docker-compose.yml` provides:

| Service    | Port      | Purpose                                         |
| ---------- | --------- | ----------------------------------------------- |
| postgres   | 5432      | Database                                        |
| redis      | 6379      | Cache, BullMQ                                   |
| minio      | 9000/9001 | S3-compatible storage                           |
| minio-init | —         | Creates bucket + public download policy         |
| api        | 3002      | Backend container (Compose profile `full` only) |

```bash
yarn docker:up       # Start infra (postgres, redis, minio, minio-init)
yarn docker:check    # Verify health
yarn docker:down     # Stop
yarn docker:reset    # Remove volumes
yarn docker:ps       # Service status
yarn docker:logs     # Follow logs
```

### Production image

`Dockerfile` — multi-stage Node **22** Alpine:

1. `yarn install --frozen-lockfile`
2. `yarn build`
3. Copy `dist/`, production `node_modules/`, and `public/` (email/brand static assets)
4. `CMD ["node", "dist/src/main.js"]`

Exposes port **3002**. Local production-equivalent:

```bash
yarn build
yarn start:prod          # node dist/src/main.js
```

Confirm `API_URL` is the public HTTPS API host so transactional emails reference `https://<api>/images/email/sopet-logo-white.png`.

## CI/CD

`.github/workflows/ci.yml` — pull requests to `main` or `uat` (Node 22):

```bash
yarn format:check
yarn build
yarn test
yarn test:e2e
```

E2E tests use mocked repositories — no Postgres/Redis/MinIO in CI.

Dummy env vars: `JWT_SECRET`, `OMISE_*`.

### Install-time supply chain (INF2-008)

`preinstall` runs `npx only-allow yarn` and `prepare` runs `husky`. Both execute unpinned installer scripts during `yarn install`. Acceptable for local/CI developer machines; production images should use `yarn install --frozen-lockfile --ignore-scripts` (or equivalent) so husky/`npx` do not run in deploy.

`.github/workflows/deploy.yml` — push to `deploy/uat` or `deploy/production` (also `workflow_dispatch` with Environment choice):

1. **`resolve-runner`** — reads Environment `DOCKER_PLATFORM`, outputs `ubuntu-24.04-arm` (arm64) or `ubuntu-latest` (amd64)
2. Load GitHub Environment (`DB_*`, secrets, EC2/ECR config) via keys in `infra/github-env.keys`
3. **Run pending TypeORM migrations** (`yarn migration:run`) against the target database
4. Build/push Docker image to ECR on GitHub Actions (if not already present for this commit)
   - `linux/amd64`: `ubuntu-latest` (native amd64)
   - `linux/arm64`: `ubuntu-24.04-arm` (native arm64 — no QEMU, no EC2 build)
   - Escape hatch: set Environment var `BUILD_ON_HOST=true` to build on EC2 via `infra/ec2/build-on-host.sh` instead (**leave unset** for normal UAT/production)
5. Render runtime `.env` from GitHub Environment
6. **Deploy on EC2** via AWS Systems Manager (`infra/deploy-via-ssm.sh` → pull image + `/opt/sopet/deploy.sh`; optional build-on-host if `BUILD_ON_HOST=true`)

Migrations run **before** the new container is started so the schema matches the code being rolled out. The GitHub Actions runner must be able to reach `DB_HOST`. Extensions that require superuser (e.g. `vector`) must be pre-installed on the database once by an admin.

**Production runbook (step-by-step):** [deploy-production.md](deploy-production.md)

### SSM timeouts and empty InProgress output

While Status is `InProgress`, `get-command-invocation` often shows **ResponseCode -1** and **empty stdout/stderr**. That is normal: SSM does not stream output into that API until the command finishes (unless CloudWatch output is enabled).

| Knob                            | Meaning                                 | `BUILD_ON_HOST=true` | pull-only default |
| ------------------------------- | --------------------------------------- | -------------------- | ----------------- |
| `SSM_DELIVERY_TIMEOUT_SECONDS`  | Agent must _start_ the command          | 120                  | 120               |
| `SSM_EXECUTION_TIMEOUT_SECONDS` | Max runtime on EC2 (`executionTimeout`) | 3600                 | 1800              |
| `SSM_TIMEOUT_SECONDS`           | GHA poller wait                         | 3600                 | 1800              |

Default arm64 deploys are **pull-only** on EC2 (image already in ECR from GHA). The longer timeouts apply only when `BUILD_ON_HOST=true`.

**Optional live logs:** create a CloudWatch log group, attach `infra/iam/ec2-instance-ecr-policy.json` (includes `logs:*` for SSM output), set GitHub Environment variable `SSM_CLOUDWATCH_LOG_GROUP` (e.g. `/sopet/ssm/deploy`), and re-apply the GitHub deploy role with `ssm:CancelCommand` from `infra/iam/github-deploy-ec2-policy.json`.

```bash
aws logs create-log-group --log-group-name /sopet/ssm/deploy --region ap-southeast-7
```

### Inspect a stuck / timed-out SSM command

```bash
REGION=ap-southeast-7
INSTANCE=i-0551151d36003420c
CMD=6793bbdc-5bb1-465d-a272-8bea8689f6e1

aws ssm get-command-invocation \
  --command-id "$CMD" --instance-id "$INSTANCE" --region "$REGION"

aws ssm list-command-invocations \
  --command-id "$CMD" --details --region "$REGION"

aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$INSTANCE" --region "$REGION"

# If CloudWatch output was enabled:
aws logs tail /sopet/ssm/deploy --since 2h --region "$REGION"

# Session Manager — disk / docker / agent
aws ssm start-session --target "$INSTANCE" --region "$REGION"
# then on the host:
#   df -h; free -h; docker ps -a; docker system df
#   ps aux | grep -E 'docker|build-on-host' | grep -v grep
#   sudo tail -n 200 /var/log/amazon/ssm/amazon-ssm-agent.log
```

## EC2 + ECR deploy (production / UAT)

### Architecture

```text
GitHub Actions → ECR (push image) → SSM Run Command → EC2 (docker pull + run)
Cloudflare DNS (A record) → EC2 :80 (Caddy) → localhost:3002 (API container)
```

Storefront and admin stay on Vercel; only the backend API runs on EC2.

### One-time AWS setup

1. **ECR repository** — **one shared repo for UAT and production** (recommended). Set both GitHub Environments’ `ECR_REPOSITORY` to the same string (e.g. `sopet/backend-uat` or `sopet/backend`). A separate production-only repo is optional.

   ```bash
   aws ecr create-repository --repository-name sopet/backend-uat
   bash infra/apply-ecr-lifecycle-policy.sh sopet/backend-uat
   ```

2. **EC2 instance profile** — attach a role with `infra/iam/ec2-instance-ecr-policy.json` (ECR pull + SSM agent). Both UAT and production instances need pull access to the shared repo.

3. **GitHub OIDC deploy role** — trust GitHub Actions; attach `infra/iam/github-deploy-ec2-policy.json` (ECR push/pull/describe + `ssm:SendCommand`). Store role ARN as GitHub secret `AWS_ROLE_ARN`. Must cover the shared repo for both Environments.

4. **Security group** (minimum):
   - TCP **80** from `0.0.0.0/0` (or [Cloudflare IP ranges](https://www.cloudflare.com/ips/) if restricting origin)
   - TCP **22** from your admin IP only (optional if you use SSM Session Manager exclusively)
   - Outbound **all** (ECR, RDS, Redis, external APIs)

5. **Bootstrap the instance** (SSH or SSM Session Manager):
   ```bash
   git clone <repo> && cd sopet-backend
   sudo AWS_REGION=ap-southeast-1 bash infra/ec2/bootstrap.sh
   ```
   Confirm the instance is **Online** in AWS Console → Systems Manager → Fleet Manager.

### GitHub Environment variables

| Variable                             | Example                     | Purpose                                          |
| ------------------------------------ | --------------------------- | ------------------------------------------------ |
| `AWS_REGION`                         | `ap-southeast-1`            | ECR + SSM region                                 |
| `ECR_REPOSITORY`                     | `sopet/backend-uat`         | Image repository name (same value on UAT + prod) |
| `EC2_INSTANCE_ID`                    | `i-0abc123...`              | Target EC2 instance                              |
| `CORS_ORIGINS`                       | `https://uat.sopet.org,...` | Must include Vercel storefront/admin URLs        |
| `API_URL`                            | `https://api-uat.sopet.org` | Public API base (email logo absolute URL)        |
| `STOREFRONT_URL` / `ADMIN_PANEL_URL` | `https://...`               | Public frontend URLs (links in emails)           |

Plus all application vars/secrets listed in `infra/env.manifest.json`.

Remove legacy ECS variables (`ECS_CLUSTER`, `ECS_SERVICE`, etc.) from GitHub Environments if still present. The `ecs/` folder retains a historical task-definition fragment; deploy.yml targets EC2.

### Cloudflare DNS

1. Add an **A record** for your API hostname (e.g. `api-uat.sopet.org`) → EC2 **public IPv4**.
2. Enable **Proxied** (orange cloud) so Cloudflare terminates TLS for clients.
3. Origin serves HTTP on port **80** (Caddy from `bootstrap.sh` reverse-proxies to `127.0.0.1:3002`).
4. Set SSL/TLS mode to **Full** (not Strict unless you add a valid origin certificate).
5. Update `API_URL`, `CORS_ORIGINS`, Omise webhook URL, and frontend GraphQL base URLs to the Cloudflare hostname.

### Manual deploy test (on EC2)

```bash
export IMAGE_URI=<account>.dkr.ecr.<region>.amazonaws.com/sopet/backend-uat:<tag>
export ENV_FILE=/opt/sopet/.env   # copy from rendered .env.deploy
/opt/sopet/deploy.sh
```

## Environment (production)

Key variables from `.env.example`:

| Group    | Variables                                                           |
| -------- | ------------------------------------------------------------------- |
| App      | `NODE_ENV=production`, `PORT=3002`, `API_URL`, `CORS_ORIGINS`       |
| Database | `DB_*`, `DB_SSL=true` for managed Postgres                          |
| JWT      | `JWT_SECRET` (long random string)                                   |
| Storage  | Real AWS S3 or Cloudflare R2 (not MinIO)                            |
| Payments | `OMISE_*`, `OMISE_WEBHOOK_SECRET` (required)                        |
| SMS      | `THAIBULKSMS_*` or `TWILIO_*`                                       |
| Email    | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`                   |
| Redis    | `REDIS_HOST` (omit to disable cache and BullMQ queues)              |
| Search   | `SEARCH_SMART_ENABLED`, `OPENAI_API_KEY` (embeddings worker)        |
| Payouts  | `PAYOUT_CRON_SCHEDULE`, `PAYOUT_CRON_TIMEZONE`, `PAYOUT_MIN_AMOUNT` |

### Production bootstrap

First-time setup only (migrations run automatically on each deploy after this):

```bash
yarn db:seed:prod
```

Creates `admin@sopet.org` with a temporary default password and `mustChangePassword=true` — no vendor, store, or product data. Idempotent: skips if the admin already exists. Admin mutations remain blocked until the password is changed. Never leave the seed password in production.

## Object storage

| Environment | `STORAGE_PROVIDER` | Config                                                    |
| ----------- | ------------------ | --------------------------------------------------------- |
| Local       | `s3`               | MinIO at `localhost:9000`, `AWS_S3_FORCE_PATH_STYLE=true` |
| AWS         | `s3`               | Empty endpoint, `AWS_S3_FORCE_PATH_STYLE=false`           |
| Cloudflare  | `r2`               | `CLOUDFLARE_*` vars, `CDN_URL` for public URLs            |

Images converted to WebP before upload (`StorageService` + `sharp`).

## Health checks

`HealthModule` (`src/modules/health/`) is wired into `AppModule` and exposes REST checks at `GET /health`, `/health/ready` (Postgres ping, plus Redis when configured), and `/health/live` (static liveness). A separate GraphQL `health` query is available via `src/graphql/app.resolver.ts`.

## Related docs

- [Database — seeds](database.md#seeds)
- [API — Omise webhook](api.md#omise-webhook)
- Root [README](../README.md) for local setup
