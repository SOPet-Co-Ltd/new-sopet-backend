# Backend environment: Secrets vs Variables

GitHub Environments **`deploy/uat`** and **`deploy/production`** use the **same key names** with different values. On each deploy, Actions renders the app `.env` on EC2 (`/opt/sopet/.env`) from those keys (`infra/github-env.keys`, `infra/env.manifest.json`). Sources: `.env.example`, `infra/github-env.keys`, `infra/env.manifest.json`, [deploy-production.md](deploy-production.md).

★ = production-critical (must be set correctly before a live deploy).

---

## 1. GitHub Environment — Secrets

| Name                             | Purpose                                       | Production notes                                                                                                                               |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_ROLE_ARN` ★                 | IAM role ARN for GitHub OIDC (ECR push + SSM) | Deploy-only; not written into app `.env`. Separate role trust for prod preferred.                                                              |
| `DB_PASSWORD` ★                  | Postgres password                             | Production RDS; never reuse UAT password.                                                                                                      |
| `REDIS_PASSWORD`                 | Redis auth                                    | Optional. Set if your Redis instance requires auth. Redis itself is optional (omit `REDIS_HOST`).                                              |
| `CLOUDFLARE_ACCOUNT_ID` ★        | Cloudflare R2 account id                      | Required when `STORAGE_PROVIDER=r2`.                                                                                                           |
| `CLOUDFLARE_ACCESS_KEY_ID` ★     | R2 access key id                              | R2 API token credentials.                                                                                                                      |
| `CLOUDFLARE_SECRET_ACCESS_KEY` ★ | R2 secret access key                          | Treat as highly sensitive.                                                                                                                     |
| `CLOUDFLARE_R2_BUCKET` ★         | R2 bucket name                                | Production bucket only (not UAT).                                                                                                              |
| `JWT_SECRET` ★                   | JWT signing secret                            | Long random string; **must differ from UAT**.                                                                                                  |
| `THAIBULKSMS_API_KEY` ★          | ThaiBulkSMS API key                           | Live SMS credentials for prod.                                                                                                                 |
| `THAIBULKSMS_API_SECRET` ★       | ThaiBulkSMS API secret                        | Pair with API key.                                                                                                                             |
| `OMISE_PUBLIC_KEY` ★             | Omise public key                              | **Live** keys on production (not test).                                                                                                        |
| `OMISE_SECRET_KEY` ★             | Omise secret key                              | Live secret; never log.                                                                                                                        |
| `OMISE_WEBHOOK_SECRET` ★         | Omise webhook HMAC secret                     | Point live webhook at `https://<API_URL>/webhooks/omise`.                                                                                      |
| `RESEND_API_KEY` ★               | Resend email API key                          | Transactional mail.                                                                                                                            |
| `BANK_DATA_ENCRYPTION_KEY` ★     | Encrypt vendor bank account numbers at rest   | Generate with `openssl rand -base64 32`. **Required** when `NODE_ENV=production`.                                                              |
| `HEALTH_CHECK_TOKEN` ★           | Token for `/health` and `/health/ready`       | Send as `x-health-check-token`. Generate with `openssl rand -base64 32`. **Required** when `NODE_ENV=production`. `/health/live` stays public. |
| `OPENAI_API_KEY`                 | OpenAI embeddings / smart search              | Optional; needed for embedding worker / semantic search.                                                                                       |

**Count: 16 secrets** (15 app/deploy + `AWS_ROLE_ARN`; `OPENAI_API_KEY` and `REDIS_PASSWORD` may be optional. `HEALTH_CHECK_TOKEN` is required at API startup in production. Redis is optional — omit `REDIS_HOST` to disable).

---

## 2. GitHub Environment — Variables

### Deploy / infrastructure

| Name                       | Purpose                                         | Production notes / example                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_REGION` ★             | AWS region for ECR + EC2 (+ SSM)                | e.g. `ap-southeast-7` — must match ECR and instance.                                                                                                                                                                   |
| `ECR_REPOSITORY` ★         | ECR repository name                             | **Recommended:** exact same string as UAT (e.g. both `sopet/backend-uat`, or both `sopet/backend`) so prod can reuse the UAT-built `:github.sha` image. Separate `sopet/backend-production` is optional, not required. |
| `EC2_INSTANCE_ID` ★        | Target EC2 instance id                          | Production instance only (`i-…`).                                                                                                                                                                                      |
| `DOCKER_PLATFORM` ★        | Image / runner architecture                     | `linux/arm64` for Graviton → `ubuntu-24.04-arm`. Use `linux/amd64` only for x86 EC2.                                                                                                                                   |
| `BUILD_ON_HOST`            | Escape hatch: build image on EC2                | Leave **unset** on UAT/prod (default OFF — GHA build, pull-only). Set `true` only when intentionally using `infra/ec2/build-on-host.sh`.                                                                               |
| `SSM_CLOUDWATCH_LOG_GROUP` | CloudWatch log group for live SSM stdout/stderr | Optional, e.g. `/sopet/ssm/deploy`. Read in `deploy.yml`; **not** exported via `GITHUB_ENV` / app `.env`.                                                                                                              |

### Caddy reverse proxy

| Name                  | Purpose                       | Production notes / example                         |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| `CADDY_HOSTNAME` ★    | Public API hostname for Caddy | e.g. `api.sopet.org`.                              |
| `CADDY_ADMIN_EMAIL` ★ | ACME / Caddy admin email      | Ops contact for certs.                             |
| `CADDY_TLS_CERT`      | Path or material for TLS cert | Often unused if Cloudflare terminates TLS.         |
| `CADDY_TLS_KEY`       | Path or material for TLS key  | Pair with `CADDY_TLS_CERT`.                        |
| `CADDY_TLS_ENABLED`   | Enable origin TLS in Caddy    | Often `false` / off when Cloudflare handles HTTPS. |

### Application (written into `/opt/sopet/.env`)

| Name                               | Purpose                            | Production notes / example                                                                                   |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV` ★                       | Runtime mode                       | `production`                                                                                                 |
| `PORT`                             | HTTP listen port                   | `3002` (container; Caddy proxies).                                                                           |
| `DB_HOST` ★                        | Postgres host                      | Production RDS hostname.                                                                                     |
| `DB_PORT`                          | Postgres port                      | `5432` (or RDS port).                                                                                        |
| `DB_USERNAME` ★                    | Postgres user                      | Production DB user.                                                                                          |
| `DB_NAME` ★                        | Database name                      | Production database.                                                                                         |
| `DB_SSL` ★                         | Require SSL to Postgres            | `true` on RDS. Deploy supplies Amazon RDS CA via `infra/certs/rds-global-bundle.pem` (`DB_SSL_CA`).          |
| `DB_POOL_MAX`                      | TypeORM/pg pool size               | e.g. `20`.                                                                                                   |
| `REDIS_HOST`                       | Redis host                         | Optional. Omit to disable cache/queues/refresh rotation store. `REDIS_PASSWORD` optional if auth needed.     |
| `REDIS_PORT`                       | Redis port                         | `6379`                                                                                                       |
| `REDIS_DB`                         | Redis logical DB index             | `0`                                                                                                          |
| `STORAGE_PROVIDER` ★               | Object storage backend             | `r2` (or `s3`).                                                                                              |
| `CDN_URL` ★                        | Public base URL for stored objects | Production CDN / R2 public domain.                                                                           |
| `JWT_ACCESS_EXPIRES_IN`            | Access token TTL                   | e.g. `1h`                                                                                                    |
| `JWT_REFRESH_EXPIRES_IN`           | Refresh token TTL                  | e.g. `7d`                                                                                                    |
| `THAIBULKSMS_SENDER`               | SMS sender name                    | e.g. `SOPet`                                                                                                 |
| `THAIBULKSMS_FORCE`                | ThaiBulkSMS force mode             | e.g. `corporate`                                                                                             |
| `THAIBULKSMS_SHORTEN_URL`          | Shorten URLs in SMS                | `false` typical.                                                                                             |
| `PAYMENT_QR_EXPIRY_MINUTES`        | PromptPay QR validity (minutes)    | Default `15`.                                                                                                |
| `PAYMENT_EXPIRY_CHECK_INTERVAL_MS` | Background expiry poll interval    | Default `30000`.                                                                                             |
| `EMAIL_FROM` ★                     | From address for Resend            | e.g. `noreply@sopet.co.th`                                                                                   |
| `EMAIL_FROM_NAME`                  | From display name                  | e.g. `Sopet Marketplace`                                                                                     |
| `API_URL` ★                        | Public absolute API base URL       | e.g. `https://api.sopet.org` (emails, assets, logs).                                                         |
| `STOREFRONT_URL` ★                 | Customer storefront origin         | Production Vercel URL.                                                                                       |
| `ADMIN_PANEL_URL` ★                | Admin/vendor panel origin          | Production Vercel URL.                                                                                       |
| `CORS_ORIGINS` ★                   | Allowed CORS origins               | Comma-separated production frontends.                                                                        |
| `RATE_LIMIT_TTL`                   | Rate-limit window (seconds)        | e.g. `60`                                                                                                    |
| `RATE_LIMIT_MAX`                   | Max requests per window            | e.g. `100`                                                                                                   |
| `SEARCH_SMART_ENABLED`             | Enable smart search path           | `true` only when Phase wiring is ready; else `false`.                                                        |
| `REVIEW_AUTO_APPROVE`              | Deprecated / ignored               | Reviews always approved; kept for env parity.                                                                |
| `REVIEW_WINDOW_DAYS`               | Days after delivery to review      | Default `30`.                                                                                                |
| `PAYOUT_CRON_SCHEDULE`             | Payout BullMQ cron                 | Default `0 2 * * *`.                                                                                         |
| `PAYOUT_CRON_TIMEZONE`             | Payout cron timezone               | Default `Asia/Bangkok`.                                                                                      |
| `COMMISSION_GO_LIVE_AT` ★          | Platform commission cutoff instant | ISO-8601 UTC, e.g. `2026-01-01T00:00:00.000Z`. Required when `NODE_ENV=production` or the API will not boot. |

**Count: 45 variables** (6 deploy/infra including optional `BUILD_ON_HOST` + `SSM_CLOUDWATCH_LOG_GROUP`, 5 Caddy, 34 application from `env.manifest.json`).

---

## 3. App runtime only (not in GitHub deploy keys)

Present in `.env.example` and/or app config, but **not** listed in `infra/github-env.keys` / `infra/env.manifest.json` (local Docker, alternate SMS, S3/MinIO, or app defaults).

### Secrets (local / alternate providers)

| Name                    | Purpose               | Notes                                                                           |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | S3 / MinIO access key | Local MinIO (`minioadmin`) or real AWS S3; prod R2 uses `CLOUDFLARE_*` instead. |
| `AWS_SECRET_ACCESS_KEY` | S3 / MinIO secret key | Same as above.                                                                  |
| `TWILIO_ACCOUNT_SID`    | Twilio SMS fallback   | Optional; ThaiBulkSMS is primary per PRD.                                       |
| `TWILIO_AUTH_TOKEN`     | Twilio auth token     | Optional.                                                                       |
| `TWILIO_PHONE_NUMBER`   | Twilio from-number    | Optional.                                                                       |

### Variables / flags (local, S3 shape, payment extras)

| Name                                   | Purpose                        | Notes                                                                                                                                    |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `MINIO_API_PORT`                       | Local MinIO API port           | Docker Compose only (`9000`).                                                                                                            |
| `MINIO_CONSOLE_PORT`                   | Local MinIO console port       | Docker Compose only (`9001`).                                                                                                            |
| `AWS_REGION`                           | S3 client region (app `.env`)  | Also a **GitHub deploy variable** for ECR/EC2; in local `.env` used for MinIO/S3 client.                                                 |
| `AWS_S3_BUCKET`                        | S3/MinIO bucket name           | Local / AWS S3 path; R2 uses `CLOUDFLARE_R2_BUCKET`.                                                                                     |
| `AWS_S3_ENDPOINT`                      | S3-compatible endpoint         | e.g. `http://localhost:9000`; empty for real AWS S3.                                                                                     |
| `AWS_S3_FORCE_PATH_STYLE`              | Path-style S3 requests         | `true` for MinIO; `false` for real S3.                                                                                                   |
| `AWS_S3_PUBLIC_URL`                    | Public object URL base         | Local MinIO or CDN-style base when not using `CDN_URL` alone.                                                                            |
| `AWS_S3_OBJECT_ACL`                    | Optional per-object ACL        | e.g. `public-read`; often empty (bucket policy).                                                                                         |
| `SMS_OTP_LOG_ONLY`                     | Log OTP instead of sending SMS | UAT/testing only; **rejected at startup** when `NODE_ENV=production`.                                                                    |
| `BANK_DATA_ENCRYPTION_KEY` ★           | Encrypt bank account numbers   | **Required** in production (startup fails if unset). Also a GitHub Environment **secret** for deploy. Local may leave unset (plaintext). |
| `ALLOW_UNSET_NODE_ENV`                 | Allow boot without NODE_ENV    | Local tooling only (`true`). Deploy must set `NODE_ENV` explicitly.                                                                      |
| `PAYMENT_OMISE_CANCEL_TIMEOUT_MS`      | Omise cancel/expire timeout    | Default `4000`; fail-open behavior.                                                                                                      |
| `PAYMENT_UNPAID_ORDER_CANCEL_AFTER_MS` | Auto-cancel unpaid orders      | Default `86400000` (24h).                                                                                                                |
| `PAYOUT_MIN_AMOUNT`                    | Minimum payout amount          | Default `100` (THB).                                                                                                                     |
| `PROD_ADMIN_EMAIL`                     | Prod seed admin email          | Bootstrap/`yarn db:seed:prod` only (commented in `.env.example`).                                                                        |
| `DB_RESET_ALLOW_PRODUCTION`            | Gate destructive DB reset      | Must be `1` to allow `yarn db:reset:*` against non-dev; ops only.                                                                        |

---

## Checklist

### Secret names (copy-paste)

```
AWS_ROLE_ARN
DB_PASSWORD
REDIS_PASSWORD
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_ACCESS_KEY_ID
CLOUDFLARE_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET
JWT_SECRET
THAIBULKSMS_API_KEY
THAIBULKSMS_API_SECRET
OMISE_PUBLIC_KEY
OMISE_SECRET_KEY
OMISE_WEBHOOK_SECRET
RESEND_API_KEY
BANK_DATA_ENCRYPTION_KEY
OPENAI_API_KEY
```

### Variable names (copy-paste)

```
AWS_REGION
ECR_REPOSITORY
EC2_INSTANCE_ID
DOCKER_PLATFORM
BUILD_ON_HOST
SSM_CLOUDWATCH_LOG_GROUP
CADDY_HOSTNAME
CADDY_ADMIN_EMAIL
CADDY_TLS_CERT
CADDY_TLS_KEY
CADDY_TLS_ENABLED
NODE_ENV
PORT
DB_HOST
DB_PORT
DB_USERNAME
DB_NAME
DB_SSL
DB_POOL_MAX
REDIS_HOST
REDIS_PORT
REDIS_DB
STORAGE_PROVIDER
CDN_URL
JWT_ACCESS_EXPIRES_IN
JWT_REFRESH_EXPIRES_IN
THAIBULKSMS_SENDER
THAIBULKSMS_FORCE
THAIBULKSMS_SHORTEN_URL
PAYMENT_QR_EXPIRY_MINUTES
PAYMENT_EXPIRY_CHECK_INTERVAL_MS
EMAIL_FROM
EMAIL_FROM_NAME
API_URL
STOREFRONT_URL
ADMIN_PANEL_URL
CORS_ORIGINS
RATE_LIMIT_TTL
RATE_LIMIT_MAX
SEARCH_SMART_ENABLED
REVIEW_AUTO_APPROVE
REVIEW_WINDOW_DAYS
PAYOUT_CRON_SCHEDULE
PAYOUT_CRON_TIMEZONE
```

### Before production

- [ ] All ★ secrets set on `deploy/production` (live Omise, unique `JWT_SECRET`, prod R2 + DB)
- [ ] All ★ variables set (`DOCKER_PLATFORM`, ECR, EC2, Caddy host, API/CORS/CDN URLs, `STORAGE_PROVIDER=r2`)
- [ ] `ECR_REPOSITORY` matches UAT (shared repo); OIDC + both EC2 instance roles can pull/push that repo
- [ ] `BUILD_ON_HOST` left unset; `SMS_OTP_LOG_ONLY` not enabled in rendered `.env`
- [ ] Cross-check [deploy-production.md](deploy-production.md) (UAT first, then promote same SHA)
