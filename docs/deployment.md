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

1. Load GitHub Environment (`DB_*`, secrets, ECS config)
2. **Run pending TypeORM migrations** (`yarn migration:run`) against the target database
3. Build/push Docker image (if not already in ECR for this commit)
4. Deploy to ECS

Migrations run **before** the new task is deployed so the schema matches the code being rolled out. The GitHub Actions runner must be able to reach `DB_HOST` (managed Postgres firewall / allowlist). Extensions that require superuser (e.g. `vector`) must be pre-installed on the database once by an admin.

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
