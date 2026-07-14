# SOPET Backend

NestJS GraphQL API for the SOPET multi-vendor e-commerce platform.

## Overview

Custom-built backend serving the customer storefront and admin/vendor dashboard through a single GraphQL endpoint at `/graphql`, plus a small REST surface for Omise webhooks, health checks, and the vendor public product API.

**Key capabilities:** multi-vendor stores, phone OTP customer auth, email/password vendor/admin auth (vendor email verification), Omise payments (PromptPay, credit card), smart search, reviews, promotions, payouts, image uploads (S3/MinIO/R2), transactional email (Resend).

## Tech stack

| Layer          | Technology                                                             |
| -------------- | ---------------------------------------------------------------------- |
| Framework      | NestJS 11, TypeScript 5.7                                              |
| API            | GraphQL (Apollo Server 5) + limited REST (webhooks, vendor public API) |
| Database       | PostgreSQL 15, TypeORM 0.3                                             |
| Cache / queues | Redis 7, BullMQ                                                        |
| Auth           | JWT (Passport), bcrypt                                                 |
| Payments       | Omise                                                                  |
| Storage        | AWS S3 SDK (MinIO / R2 compatible)                                     |
| Email          | Resend                                                                 |
| SMS            | ThaiBulkSMS, Twilio fallback                                           |
| Testing        | Jest 30                                                                |

## Architecture

```text
Client → POST /graphql → Resolver → Service → TypeORM → PostgreSQL
                              ↓
                         Redis / S3 / Omise / BullMQ
```

Modular monolith: 28 feature modules under `src/modules/`. See [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 20+ (CI and Dockerfile use Node 22)
- Yarn 1.22+ (`packageManager`: yarn@1.22.22; `preinstall` enforces Yarn)
- Docker (for local Postgres, Redis, MinIO)

## Installation

```bash
yarn install
cp .env.example .env
```

## Environment setup

Key variables (full list in `.env.example`):

| Variable                             | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| `DB_*`                               | PostgreSQL connection                               |
| `JWT_SECRET`                         | Token signing                                       |
| `REDIS_*`                            | Cache and job queues (omit `REDIS_HOST` to disable) |
| `AWS_*` / `STORAGE_PROVIDER`         | Image storage                                       |
| `OMISE_*`                            | Payment gateway                                     |
| `THAIBULKSMS_*` / `TWILIO_*`         | OTP SMS                                             |
| `API_URL`                            | Public API base URL (email logo assets, logs)       |
| `STOREFRONT_URL` / `ADMIN_PANEL_URL` | Links in transactional emails                       |
| `RESEND_API_KEY` / `EMAIL_FROM`      | Email delivery (Resend)                             |
| `CORS_ORIGINS`                       | Allowed browser origins                             |

## Running locally

```bash
yarn docker:up          # Start Postgres, Redis, MinIO
yarn migration:run
yarn db:seed:dev        # Demo data (optional)
yarn start:dev          # http://localhost:3002/graphql
```

**Default credentials** after `db:seed:dev`:

| Role   | Email              | Password   |
| ------ | ------------------ | ---------- |
| Admin  | `admin@sopet.org`  | `P@ssw0rd` |
| Vendor | `vendor@sopet.org` | `P@ssw0rd` |

## Build

```bash
yarn build
yarn start:prod         # node dist/src/main.js (same entry as Dockerfile)
```

## Testing

```bash
yarn test              # Unit tests (src/**/*.spec.ts)
yarn test:cov          # Coverage (threshold on key services)
yarn test:e2e          # E2E (mocked infra, no Docker required)
```

## Linting & formatting

```bash
yarn lint
yarn format            # Prettier write
yarn format:check      # CI check
```

## Project structure

```text
public/                     # Static assets (email brand logo, served at /images/…)
scripts/                    # Utilities (email HTML previews, schema checks)
infra/                      # EC2/ECR deploy scripts and env tooling
src/
├── main.ts                 # Bootstrap + static asset mount
├── app.module.ts           # Root module, global guards
├── schema.gql              # Auto-generated GraphQL schema
├── common/                 # Decorators, filters, pipes, utils
├── config/                 # Environment config factories
├── database/               # Entities, migrations, seeds
├── graphql/                # Apollo module, DataLoaders
└── modules/                # Feature modules (auth, orders, products, …)
```

## Documentation

| Document                                           | Description                |
| -------------------------------------------------- | -------------------------- |
| [Docs index](docs/README.md)                       | Full documentation         |
| [Architecture](docs/architecture.md)               | Module design and patterns |
| [Folder structure](docs/folder-structure.md)       | Where to put code          |
| [API](docs/api.md)                                 | GraphQL and REST endpoints |
| [Database](docs/database.md)                       | TypeORM, migrations, seeds |
| [Authentication](docs/authentication.md)           | OTP, JWT, guards           |
| [Feature development](docs/feature-development.md) | Adding new features        |
| [Coding conventions](docs/coding-conventions.md)   | Naming, errors, tests      |
| [Deployment](docs/deployment.md)                   | Docker, CI, production     |
| [Troubleshooting](docs/troubleshooting.md)         | Common issues              |

## Common commands

| Command                 | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `yarn start:dev`        | Dev server with hot reload                                              |
| `yarn start:prod`       | Run compiled app (`node dist/src/main.js`)                              |
| `yarn migration:run`    | Apply database migrations                                               |
| `yarn db:reset:migrate` | Drop, migrate, no seed (local; prod with `DB_RESET_ALLOW_PRODUCTION=1`) |
| `yarn db:reset:dev`     | Drop, migrate, seed (local only)                                        |
| `yarn db:seed:prod`     | Bootstrap admin (production, idempotent)                                |
| `yarn docker:up`        | Start local infrastructure                                              |
| `yarn docker:check`     | Verify Postgres, Redis, MinIO                                           |
| `yarn graphql:schema`   | Verify schema.gql exists                                                |
| `yarn email:previews`   | Generate HTML previews under `temp/email-previews/`                     |

## Contributing

1. Create a feature branch in this repo
2. Follow [coding conventions](docs/coding-conventions.md)
3. Add tests for service changes
4. Run `yarn format:check && yarn build && yarn test && yarn test:e2e`
5. Coordinate frontend codegen if schema changes
6. Open a pull request (CI runs on PRs to `main` / `uat`)

Schema changes: regenerate `src/schema.gql` here (`yarn start:dev`), then run `yarn graphql:codegen` in sibling repos `../sopet-storefront` and `../sopet-admin`. Commit each repo separately; merge backend before frontends that depend on the new schema.
