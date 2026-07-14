# Backend Folder Structure

## Top level

```text
sopet-backend/
├── src/                       # Application source
├── public/                    # Static files mounted at / (email brand assets)
├── test/                      # E2E and integration tests
├── scripts/                   # Utilities (email previews, schema check, SQL audits)
├── docs/                      # Developer docs (+ docs/design/ for design notes)
├── infra/                     # Deploy scripts, env manifest, IAM policies, EC2 bootstrap
├── ecs/                       # Legacy ECS task-definition fragment (not used by current EC2 deploy)
├── ormconfig.ts               # TypeORM CLI DataSource (migrations)
├── docker-compose.yml         # Local Postgres, Redis, MinIO (+ optional api profile)
├── Dockerfile                 # Production image (CMD: node dist/src/main.js)
├── .github/workflows/         # ci.yml, deploy.yml
└── .env.example
```

## `src/` overview

```text
src/
├── main.ts                 # Bootstrap: CORS, static public/, body parsers, listen
├── app.module.ts           # Root Nest module, TypeORM, global guards/pipes/filters
├── schema.gql              # Auto-generated GraphQL schema (do not edit)
├── common/                 # Cross-cutting utilities
├── config/                 # Environment config factories (registerAs)
├── database/               # Entities, migrations, repositories, seeds, SSL/timestamp helpers
├── graphql/                # Apollo module, shared models/mappers, DataLoaders
└── modules/                # 28 feature modules
```

`app.service.ts` exists but is unused (not registered in `AppModule`).

## `public/`

**Purpose:** Static files served at the site root (`useStaticAssets` in `main.ts`).

| Path                                | Purpose                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| `images/email/sopet-logo-white.png` | Brand logo in transactional emails (PNG for client compatibility) |

Referenced as `${API_URL}/images/email/sopet-logo-white.png` from email templates. Copied into the production Docker image. Local HTML samples: `yarn email:previews` → `temp/email-previews/`.

## `scripts/`

| File                          | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `ensure-graphql-schema.mjs`   | `yarn graphql:schema` — fails if `src/schema.gql` missing |
| `generate-email-previews.ts`  | `yarn email:previews` — HTML samples under `temp/`        |
| `audit-category-id-drift.sql` | One-off SQL audit for category ID drift                   |

---

## `src/common/`

**Purpose:** Shared utilities used across modules.

| Subfolder       | Add code when                                                    | Do NOT add                             |
| --------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `decorators/`   | New param/route decorators (`@CurrentUser`, `@Public`, `@Roles`) | Feature-specific logic                 |
| `filters/`      | New global exception filters                                     | Per-module error handling              |
| `interceptors/` | Request/response helpers                                         | Business logic                         |
| `pipes/`        | Global validation/transformation pipes                           | Input types (use module `*.inputs.ts`) |
| `interfaces/`   | Shared TypeScript interfaces (`JwtPayload`)                      | Entity definitions                     |
| `utils/`        | Pure helpers (phone, slug, exception mapping, Redis detect)      | Services with DI                       |

**Key files:**

- `decorators/public.decorator.ts` — marks routes/handlers as unauthenticated
- `decorators/roles.decorator.ts` — `@Roles('admin', 'vendor')` metadata (use with `RolesGuard`)
- `decorators/allow-suspended-store.decorator.ts` — bypass store suspension checks
- `filters/http-exception.filter.ts` — REST error envelope
- `pipes/validation.pipe.ts` — global `class-validator` pipe
- `interceptors/logging.interceptor.ts` — registered as global `APP_INTERCEPTOR`
- `interceptors/request-id.interceptor.ts`, `transform.interceptor.ts` — present but not registered globally
- `utils/exception-response.util.ts` — GraphQL + REST error mapping
- `utils/is-redis-configured.ts` — `REDIS_HOST` gate for cache/queues

---

## `src/config/`

**Purpose:** `@nestjs/config` `registerAs()` factories.

| File                    | Env keys (primary)                                                                  | Loaded where                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `app.config.ts`         | `PORT`, `API_URL`, `CORS_ORIGINS`, `STOREFRONT_URL`, `ADMIN_PANEL_URL`, rate limits | `AppModule` `ConfigModule.load`                                              |
| `jwt.config.ts`         | `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`                     | `AppModule`                                                                  |
| `omise.config.ts`       | `OMISE_*`                                                                           | `AppModule`                                                                  |
| `storage.config.ts`     | `AWS_*`, `CLOUDFLARE_*`, `STORAGE_PROVIDER`, `CDN_URL`                              | `AppModule`                                                                  |
| `redis.config.ts`       | `REDIS_*`                                                                           | `AppModule`                                                                  |
| `resend.config.ts`      | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`                                   | `AppModule`                                                                  |
| `thaibulksms.config.ts` | `THAIBULKSMS_*`, `SMS_OTP_LOG_ONLY`                                                 | `AppModule`                                                                  |
| `twilio.config.ts`      | `TWILIO_*`                                                                          | `AppModule`                                                                  |
| `search.config.ts`      | `SEARCH_SMART_ENABLED`, `OPENAI_API_KEY`                                            | `AppModule`                                                                  |
| `payment.config.ts`     | `PAYMENT_QR_EXPIRY_MINUTES`, `PAYMENT_EXPIRY_CHECK_INTERVAL_MS`                     | `AppModule`                                                                  |
| `payout.config.ts`      | `PAYOUT_CRON_*`, `PAYOUT_MIN_AMOUNT`                                                | `PayoutsModule` via `ConfigModule.forFeature`                                |
| `database.config.ts`    | `DB_*` namespace helpers                                                            | Not loaded by `AppModule` (TypeORM reads `process.env` / CLI `ormconfig.ts`) |

**Add here:** New environment variable groups. Prefer `ConfigService` in services over reading `process.env` directly (some legacy paths still use `process.env`).

---

## `src/database/`

**Purpose:** TypeORM persistence and seed tooling.

| Path                   | Contents                                            | When to add                                                              |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `entities/`            | 59 entity files + `enums/` (`order`, `taxonomy`)    | New database tables                                                      |
| `migrations/`          | 38 migration files                                  | Schema changes (always via migration)                                    |
| `repositories/`        | 6 custom repositories (+ `index.ts`, one unit spec) | Complex reusable queries                                                 |
| `seeds/`               | Dev/prod seed + reset scripts                       | Demo data, bootstrap accounts                                            |
| `postgres-ssl.util.ts` | SSL options for managed Postgres                    | Shared by `AppModule` + `ormconfig`                                      |
| `pg-timestamp.util.ts` | UTC timestamp parsing for `pg`                      | Called from `main.ts` / CLI                                              |
| `database.module.ts`   | Alternate TypeORM module with pool `extra`          | **Not imported** — runtime uses `AppModule` `TypeOrmModule.forRootAsync` |

**Conventions:**

- Entity files: `kebab-case.entity.ts` (e.g. `order-item.entity.ts`)
- UUID primary keys: `@PrimaryGeneratedColumn('uuid')`
- Soft deletes: `@DeleteDateColumn() deletedAt` on major entities
- `synchronize: false` — never enable in any environment

See [database.md](database.md) for migration workflow.

---

## `src/graphql/`

**Purpose:** GraphQL infrastructure (not feature business logic).

| Path                            | Purpose                                        |
| ------------------------------- | ---------------------------------------------- |
| `graphql.module.ts`             | Apollo setup; imports GraphQL feature modules  |
| `app.resolver.ts`               | GraphQL `health` query                         |
| `loaders/`                      | DataLoader factories (e.g. product sold-count) |
| `models/types.ts`               | Shared GraphQL object types                    |
| `models/mappers.ts`             | Entity → GraphQL mappers                       |
| `models/health-status.model.ts` | Health GraphQL type                            |

**Add feature resolvers in `src/modules/`, not here.** Only add to `graphql/` for cross-cutting GraphQL infrastructure.

Feature modules that are primarily GraphQL-facing are registered by importing them into `AppGraphqlModule` (and often also into `AppModule` when they own REST controllers or must boot independently — see [architecture.md](architecture.md)).

---

## `src/modules/<feature>/`

**Purpose:** Feature domain — primary place for new business logic.

There are **28** modules under `src/modules/`:

`admin-team`, `analytics`, `api-keys`, `audit-logs`, `auth`, `cart`, `customers`, `email`, `health`, `inventory`, `notifications`, `omise`, `orders`, `payments`, `payouts`, `platform`, `products`, `promotions`, `public-api`, `queue`, `redis`, `reviews`, `search`, `sms`, `storage`, `stores`, `taxonomy`, `users`.

Standard files per module:

| File            | Required    | Purpose                     |
| --------------- | ----------- | --------------------------- |
| `*.module.ts`   | Yes         | NestJS module definition    |
| `*.service.ts`  | Usually     | Business logic              |
| `*.resolver.ts` | If GraphQL  | GraphQL API                 |
| `*.inputs.ts`   | If GraphQL  | `@InputType()` + validators |
| `dto/*.dto.ts`  | If REST     | REST/Swagger-style DTOs     |
| `guards/*.ts`   | If needed   | Module-specific guards      |
| `*.spec.ts`     | Recommended | Unit tests                  |

**Example — adding a new feature `wishlists`:**

```text
src/modules/wishlists/
├── wishlists.module.ts
├── wishlists.service.ts
├── wishlists.resolver.ts
├── wishlists.inputs.ts
└── wishlists.service.spec.ts
```

Then import `WishlistsModule` in `src/graphql/graphql.module.ts` and `src/app.module.ts` as appropriate for GraphQL vs REST lifetime.

**Do NOT:**

- Put entities in modules (use `database/entities/`)
- Access another module's repository directly (inject its service)
- Put presentation/mapping logic in services when mappers already exist

---

## `test/`

**Purpose:** E2E and integration tests outside `src/`.

| Pattern         | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `*.e2e-spec.ts` | Full Nest bootstrap tests                            |
| `*.e2e.test.ts` | Service-level e2e scenarios                          |
| `*.int.test.ts` | Integration with real/mocked infra helpers           |
| `helpers/`      | GraphQL harness, seed factories, TypeORM test config |

CI runs `yarn test:e2e` with mocked repos — no Docker required for the default suite.

---

## `infra/` and `ecs/`

| Path     | Purpose                                                                |
| -------- | ---------------------------------------------------------------------- |
| `infra/` | EC2 bootstrap, SSM deploy scripts, env rendering, IAM JSON, validation |
| `ecs/`   | Older ECS task-definition base JSON; current deploy path is EC2 + ECR  |

See [deployment.md](deployment.md).

---

## Path aliases (`tsconfig.json`)

```json
"@/*": ["src/*"],
"@database/*": ["src/database/*"],
"@entities/*": ["src/database/entities/*"],
"@repositories/*": ["src/database/repositories/*"],
"@config/*": ["src/config/*"]
```

Relative imports are more common in practice; aliases are available.

## Related docs

- [File types](file-types.md) — what each suffix means and when to add/edit it
- [Architecture](architecture.md)
- [Feature development](feature-development.md)
