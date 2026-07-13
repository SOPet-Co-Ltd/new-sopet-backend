# Deployment

## Docker

### Local infrastructure

`docker-compose.yml` provides:

| Service  | Port      | Purpose                       |
| -------- | --------- | ----------------------------- |
| postgres | 5432      | Database                      |
| redis    | 6379      | Cache, BullMQ                 |
| minio    | 9000/9001 | S3-compatible storage         |
| api      | 3002      | Backend (profile `full` only) |

```bash
yarn docker:up       # Start infra
yarn docker:check    # Verify health
yarn docker:down     # Stop
yarn docker:reset    # Remove volumes
```

### Production image

`Dockerfile` — multi-stage Node 20 Alpine:

1. `yarn install`
2. `yarn build`
3. `node dist/main.js`

Exposes port **3002**.

## CI/CD

`.github/workflows/ci.yml` — triggered on pull requests:

```yaml
yarn format:check
yarn build
yarn test
yarn test:e2e
```

E2E tests use mocked repositories — no Postgres/Redis/MinIO in CI.

Dummy env vars: `JWT_SECRET`, `OMISE_*`.

`.github/workflows/deploy.yml` — triggered on push to `deploy/uat` or `deploy/production`:

1. Load GitHub Environment (`DB_*`, secrets, EC2/ECR config)
2. **Run pending TypeORM migrations** (`yarn migration:run`) against the target database
3. Build/push Docker image to ECR (if not already present for this commit)
4. Render runtime `.env` from GitHub Environment
5. **Deploy on EC2** via AWS Systems Manager (`infra/deploy-via-ssm.sh` → `/opt/sopet/deploy.sh`)

Migrations run **before** the new container is started so the schema matches the code being rolled out. The GitHub Actions runner must be able to reach `DB_HOST` (managed Postgres firewall / allowlist). Extensions that require superuser (e.g. `vector`) must be pre-installed on the database once by an admin.

## EC2 + ECR deploy (production / UAT)

### Architecture

```text
GitHub Actions → ECR (push image) → SSM Run Command → EC2 (docker pull + run)
Cloudflare DNS (A record) → EC2 :80 (Caddy) → localhost:3002 (API container)
```

Storefront and admin stay on Vercel; only the backend API runs on EC2.

### One-time AWS setup

1. **ECR repository** — e.g. `sopet/backend-uat` / `sopet/backend-production`

   ```bash
   aws ecr create-repository --repository-name sopet/backend-uat
   bash infra/apply-ecr-lifecycle-policy.sh sopet/backend-uat
   ```

2. **EC2 instance profile** — attach a role with `infra/iam/ec2-instance-ecr-policy.json` (ECR pull + SSM agent).

3. **GitHub OIDC deploy role** — trust GitHub Actions; attach `infra/iam/github-deploy-ec2-policy.json` (ECR push + `ssm:SendCommand`). Store role ARN as GitHub secret `AWS_ROLE_ARN`.

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

| Variable                             | Example                     | Purpose                                   |
| ------------------------------------ | --------------------------- | ----------------------------------------- |
| `AWS_REGION`                         | `ap-southeast-1`            | ECR + SSM region                          |
| `ECR_REPOSITORY`                     | `sopet/backend-uat`         | Image repository name                     |
| `EC2_INSTANCE_ID`                    | `i-0abc123...`              | Target EC2 instance                       |
| `CORS_ORIGINS`                       | `https://uat.sopet.org,...` | Must include Vercel storefront/admin URLs |
| `STOREFRONT_URL` / `ADMIN_PANEL_URL` | `https://...`               | Public frontend URLs                      |

Plus all application vars/secrets listed in `infra/env.manifest.json`.

Remove legacy ECS variables (`ECS_CLUSTER`, `ECS_SERVICE`, etc.) from GitHub Environments if still present.

### Cloudflare DNS

1. Add an **A record** for your API hostname (e.g. `api-uat.sopet.org`) → EC2 **public IPv4**.
2. Enable **Proxied** (orange cloud) so Cloudflare terminates TLS for clients.
3. Origin serves HTTP on port **80** (Caddy from `bootstrap.sh` reverse-proxies to `127.0.0.1:3002`).
4. Set SSL/TLS mode to **Full** (not Strict unless you add a valid origin certificate).
5. Update `CORS_ORIGINS`, Omise webhook URL, and frontend `NEXT_PUBLIC_GRAPHQL_URL` / admin API URL to the Cloudflare hostname.

### Manual deploy test (on EC2)

```bash
export IMAGE_URI=<account>.dkr.ecr.<region>.amazonaws.com/sopet/backend-uat:<tag>
export ENV_FILE=/opt/sopet/.env   # copy from rendered .env.deploy
/opt/sopet/deploy.sh
```

## Environment (production)

Key variables from `.env.example`:

| Group    | Variables                                          |
| -------- | -------------------------------------------------- |
| App      | `NODE_ENV=production`, `PORT=3002`, `CORS_ORIGINS` |
| Database | `DB_*`, `DB_SSL=true` for managed Postgres         |
| JWT      | `JWT_SECRET` (long random string)                  |
| Storage  | Real AWS S3 or Cloudflare R2 (not MinIO)           |
| Payments | `OMISE_*`, `OMISE_WEBHOOK_SECRET` (required)       |
| SMS      | `THAIBULKSMS_*` or `TWILIO_*`                      |
| Email    | `RESEND_API_KEY`                                   |

### Production bootstrap

First-time setup only (migrations run automatically on each deploy after this):

```bash
yarn db:seed:prod
```

Creates `admin@sopet.org` with password `P@ssw0rd` — no vendor, store, or product data. Idempotent: skips if the admin already exists. Change the password after first login.

## Object storage

| Environment | `STORAGE_PROVIDER` | Config                                                    |
| ----------- | ------------------ | --------------------------------------------------------- |
| Local       | `s3`               | MinIO at `localhost:9000`, `AWS_S3_FORCE_PATH_STYLE=true` |
| AWS         | `s3`               | Empty endpoint, `AWS_S3_FORCE_PATH_STYLE=false`           |
| Cloudflare  | `r2`               | `CLOUDFLARE_*` vars, `CDN_URL` for public URLs            |

Images converted to WebP before upload (`StorageService` + `sharp`).

## Health checks

`HealthModule` exists at `src/modules/health/` but is **not wired** into `AppModule`. GraphQL health query available via `src/graphql/app.resolver.ts`.

## Related docs

- [Getting started](../../new-sopet-workspace/docs/developer/getting-started.md)
- [Database — seeds](database.md#seeds)
- [API — Omise webhook](api.md#omise-webhook)
