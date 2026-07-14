# Backend Folder Structure

## Top level

```text
sopet-backend/
├── src/                    # Application source
├── public/                 # Static files mounted at / (email brand assets)
├── test/                   # E2E and integration tests
├── scripts/                # Utilities (email previews, graphql schema check)
├── docs/                   # This documentation
├── ormconfig.ts            # TypeORM CLI configuration
├── docker-compose.yml      # Local Postgres, Redis, MinIO
├── Dockerfile              # Production container (copies public/)
├── .github/workflows/ci.yml
└── .env.example
```

## `src/` overview

```text
src/
├── main.ts                 # Entry point (also mounts public/ static assets)
├── app.module.ts           # Root NestJS module
├── schema.gql              # Auto-generated (do not edit)
├── common/                 # Cross-cutting utilities
├── config/                 # Environment config factories
├── database/               # Persistence layer
├── graphql/                # GraphQL aggregation + loaders
└── modules/                # Feature modules (28 domains)
```

## `public/`

**Purpose:** Static files served at the site root (Nest `useStaticAssets` in `main.ts`).

| Path                                | Purpose                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| `images/email/sopet-logo-white.png` | Brand logo in transactional emails (PNG for client compatibility) |

Referenced as `${API_URL}/images/email/sopet-logo-white.png` from `EmailDeliveryService`. Copied into the production Docker image. Local HTML samples: `yarn email:previews` → `temp/email-previews/`.

---

## `src/common/`

**Purpose:** Shared utilities used across all modules.

| Subfolder       | Add code when                                                    | Do NOT add                             |
| --------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `decorators/`   | New param/route decorators (`@CurrentUser`, `@Public`, `@Roles`) | Feature-specific logic                 |
| `filters/`      | New global exception filters                                     | Per-module error handling              |
| `interceptors/` | Request/response cross-cutting (logging, transform)              | Business logic                         |
| `pipes/`        | Global validation/transformation pipes                           | Input types (use module `*.inputs.ts`) |
| `interfaces/`   | Shared TypeScript interfaces (`JwtPayload`)                      | Entity definitions                     |
| `utils/`        | Pure helper functions (phone, exception mapping)                 | Services with DI                       |

**Key files:**

- `decorators/public.decorator.ts` — marks routes as unauthenticated
- `decorators/roles.decorator.ts` — `@Roles('admin', 'vendor')`
- `filters/http-exception.filter.ts` — REST error envelope
- `pipes/validation.pipe.ts` — global `class-validator` pipe
- `utils/exception-response.util.ts` — GraphQL + REST error mapping

---

## `src/config/`

**Purpose:** `@nestjs/config` `registerAs()` factories.

| File                | Env prefix                                                                          |
| ------------------- | ----------------------------------------------------------------------------------- |
| `app.config.ts`     | `PORT`, `API_URL`, `STOREFRONT_URL`, `ADMIN_PANEL_URL`, `CORS_ORIGINS`, rate limits |
| `jwt.config.ts`     | `JWT_SECRET`, expiry                                                                |
| `omise.config.ts`   | `OMISE_*`                                                                           |
| `storage.config.ts` | `AWS_*`, `CLOUDFLARE_*`, `STORAGE_PROVIDER`                                         |
| `redis.config.ts`   | `REDIS_*`                                                                           |
| `resend.config.ts`  | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`                                   |
| `search.config.ts`  | `SEARCH_SMART_ENABLED`, `OPENAI_API_KEY`                                            |

**Add here:** New environment variable groups. **Do not** read `process.env` directly in services — inject `ConfigService`.

---

## `src/database/`

**Purpose:** TypeORM persistence.

| Subfolder       | Contents                   | When to add                           |
| --------------- | -------------------------- | ------------------------------------- |
| `entities/`     | 59 entity files + `enums/` | New database tables                   |
| `migrations/`   | 38 migration files         | Schema changes (always via migration) |
| `repositories/` | 6 custom repositories      | Complex query patterns needing reuse  |
| `seeds/`        | Dev/prod seed scripts      | Demo data, bootstrap accounts         |

**Conventions:**

- Entity files: `kebab-case.entity.ts` (e.g. `order-item.entity.ts`)
- UUID primary keys: `@PrimaryGeneratedColumn('uuid')`
- Soft deletes: `@DeleteDateColumn() deletedAt`
- `synchronize: false` — never enable in any environment

See [database.md](database.md) for migration workflow.

---

## `src/graphql/`

**Purpose:** GraphQL infrastructure (not feature logic).

| Subfolder           | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `graphql.module.ts` | Apollo setup, imports all resolver modules  |
| `app.resolver.ts`   | Health query                                |
| `loaders/`          | DataLoader factories (N+1 prevention)       |
| `models/`           | Shared GraphQL types and entity→GQL mappers |

**Add feature resolvers in `src/modules/`, not here.** Only add to `graphql/` for cross-cutting GraphQL infrastructure.

---

## `src/modules/<feature>/`

**Purpose:** Feature domain — the primary place for new business logic.

Standard files per module:

| File            | Required    | Purpose                     |
| --------------- | ----------- | --------------------------- |
| `*.module.ts`   | Yes         | NestJS module definition    |
| `*.service.ts`  | Yes         | Business logic              |
| `*.resolver.ts` | Usually     | GraphQL API                 |
| `*.inputs.ts`   | If GraphQL  | `@InputType()` + validators |
| `dto/*.dto.ts`  | If REST     | Swagger DTOs                |
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

Then import `WishlistsModule` in `src/graphql/graphql.module.ts` and `src/app.module.ts`.

**Do NOT:**

- Put entities in modules (use `database/entities/`)
- Access another module's repository directly (inject its service)
- Put presentation logic in services

---

## `test/`

**Purpose:** E2E and integration tests outside `src/`.

| Pattern         | Purpose                       |
| --------------- | ----------------------------- |
| `*.e2e-spec.ts` | Full module bootstrap tests   |
| `*.e2e.test.ts` | Integration scenarios         |
| `*.int.test.ts` | Integration with mocked infra |

CI runs `yarn test:e2e` with mocked repos — no Docker required.

---

## Path aliases (`tsconfig.json`)

```json
"@/*": ["src/*"],
"@database/*": ["src/database/*"],
"@entities/*": ["src/database/entities/*"],
"@repositories/*": ["src/database/repositories/*"],
"@config/*": ["src/config/*"]
```

Relative imports are more common in practice, but aliases are available.

## Related docs

- [Architecture](architecture.md)
- [Feature development](feature-development.md)
