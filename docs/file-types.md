# File Types Guide

What each backend filename suffix means, when to add or edit it, and how NestJS / TypeORM wires it.

Filenames are **kebab-case**. Classes inside are **PascalCase**. GraphQL is **code-first** — there are no `.graphql` operation files in this repo (frontends own those).

## Quick lookup

| Suffix / pattern                | Lives in                             | Role in one line                         |
| ------------------------------- | ------------------------------------ | ---------------------------------------- |
| `.entity.ts`                    | `database/entities/`                 | TypeORM table mapping                    |
| `.enums.ts`                     | `database/entities/enums/`           | Shared DB/domain enums                   |
| Migrations (`*-Name.ts`)        | `database/migrations/`               | Schema DDL (apply with CLI)              |
| Seeds                           | `database/seeds/`                    | Bootstrap / demo data scripts            |
| `.repository.ts`                | `database/repositories/` (or module) | Complex reusable queries                 |
| `.config.ts`                    | `config/`                            | Env config via `registerAs()`            |
| `.module.ts`                    | `modules/`, `graphql/`               | Nest DI wiring                           |
| `.service.ts`                   | `modules/<feature>/`                 | Business logic                           |
| `.resolver.ts`                  | `modules/<feature>/`, `graphql/`     | GraphQL API                              |
| `.inputs.ts`                    | `modules/<feature>/`                 | GraphQL `@InputType()` + validators      |
| `.controller.ts`                | `modules/<feature>/`                 | REST only (webhooks, public API, health) |
| `.dto.ts`                       | `modules/*/dto/`                     | REST body/query DTOs                     |
| `.guard.ts`                     | `modules/*/guards/`                  | Auth / authZ checks                      |
| `.strategy.ts`                  | `modules/auth/strategies/`           | Passport JWT strategy                    |
| `.decorator.ts`                 | `common/decorators/`                 | Shared metadata (`@Public`, `@Roles`)    |
| `.filter.ts`                    | `common/filters/`                    | Global exception shaping                 |
| `.interceptor.ts`               | `common/interceptors/`               | Request/response cross-cutting           |
| `.pipe.ts`                      | `common/pipes/`                      | Global validation/transform              |
| `.util.ts`                      | `common/utils/`, modules, database   | Pure helpers (no DI)                     |
| `.loader.ts`                    | `graphql/loaders/`                   | DataLoader (N+1 batching)                |
| `.model.ts` / `types.ts`        | `graphql/models/`                    | GraphQL `@ObjectType()`                  |
| `mappers.ts` / `.mapper.ts`     | `graphql/models/`, modules           | Entity → GraphQL mapping                 |
| `.processor.ts`                 | feature queues                       | BullMQ job consumer                      |
| `.scheduler.ts`                 | e.g. payments                        | In-process timed jobs                    |
| `.constants.ts`                 | modules / seeds                      | Magic strings, queue names               |
| `.types.ts`                     | modules / graphql                    | TypeScript-only types                    |
| `.spec.ts`                      | colocated under `src/`               | Jest unit tests                          |
| `.e2e-spec.ts` / `.int.test.ts` | `test/`                              | E2E / integration tests                  |

---

## How a request usually flows

```text
HTTP / GraphQL
    → decorator metadata (@Public, @Roles)
    → guard (JwtAuthGuard, RolesGuard, …)
    → pipe (ValidationPipe → *.inputs.ts / *.dto.ts)
    → resolver OR controller
    → service (business rules)
    → repository / @InjectRepository(entity)
    → PostgreSQL (entity + migration)
    → mapper → GraphQL model (for GraphQL responses)
```

Async work: `service` enqueues → `.processor.ts` (BullMQ) when Redis is configured.

---

## Persistence

### `.entity.ts`

**What:** TypeORM class that maps to a PostgreSQL table.

**Where:** `src/database/entities/<name>.entity.ts`

**Example:** `favorite.entity.ts` → table `favorites`

**When to add/edit:**

- New table → new `*.entity.ts`
- New/changed column → edit existing entity, then generate a migration
- Never put entities under `modules/`

**How it works:**

- `@Entity('table_name')`, UUID `@PrimaryGeneratedColumn('uuid')`, snake_case `@Column({ name: '...' })`
- Auto-loaded by glob in `AppModule` and `ormconfig.ts` (`*.entity.ts`)
- Feature modules still list entities in `TypeOrmModule.forFeature([Favorite])` for injection
- Re-export from `entities/index.ts` when adding a new entity

**Always pair with:** a migration. `synchronize` is `false` everywhere.

See [database.md](database.md).

### `.enums.ts`

**What:** Shared string/status enums used by entities and services.

**Where:** `src/database/entities/enums/` (e.g. `order.enums.ts`, `taxonomy.enums.ts`)

**When:** Enum is reused by more than one entity/module, or is part of the persisted domain model.

**Note:** Simple enums sometimes live on the entity file itself (`UserRole` in `user.entity.ts`). Prefer `entities/enums/` when sharing.

### Migrations (`<timestamp>-DescriptiveName.ts`)

**What:** Versioned SQL schema changes.

**Where:** `src/database/migrations/`

**When:** Every schema change (new table, column, index, FK).

```bash
yarn migration:generate src/database/migrations/AddFavoriteNote
# review generated SQL
yarn migration:run
```

Wired through root `ormconfig.ts` (CLI). Commit entity + migration together.

### Seeds

**What:** Scripts that insert bootstrap/demo data (not Nest providers).

**Where:** `src/database/seeds/` (`seed-dev.ts`, `seed-prod.ts`, `reset-db.ts`, helpers)

**When:** New demo fixtures or prod bootstrap accounts.

```bash
yarn db:seed:dev
yarn db:seed:prod
```

### `.repository.ts`

**What:** Custom query layer for complex or reused SQL/QueryBuilder logic.

**Where:** Usually `src/database/repositories/`; occasionally module-local (e.g. search).

**When to add:**

- Substantial query logic reused across services, or worth unit-testing alone
- **Default otherwise:** inject `@InjectRepository(Entity)` in the service

**How it works:** Register in the feature module `providers` / `exports`. Do not reach another module’s repository directly — inject that module’s service.

---

## Configuration

### `.config.ts`

**What:** `@nestjs/config` factory via `registerAs('namespace', ...)`.

**Where:** `src/config/`

**Examples:** `app.config.ts`, `jwt.config.ts`, `omise.config.ts`

**When:** New group of env vars.

**How it works:**

- Most factories load in `AppModule` → `ConfigModule.forRoot({ load: [...] })`
- Feature-only configs use `ConfigModule.forFeature` in that module (e.g. payout)
- Services inject `ConfigService` — avoid reading `process.env` in business code
- Also update `.env.example`

---

## Nest feature modules

### `.module.ts`

**What:** NestJS wiring: `imports`, `providers`, `controllers`, `exports`.

**Where:** `src/modules/<feature>/<feature>.module.ts` (also `graphql.module.ts`)

**When:** Always for a new feature domain.

**How it works:** Import into:

- `src/app.module.ts` — app boot, REST, DI graph
- `src/graphql/graphql.module.ts` — GraphQL-facing features

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([MyEntity])],
  providers: [MyFeatureService, MyFeatureResolver],
  exports: [MyFeatureService],
})
export class MyFeatureModule {}
```

### `.service.ts`

**What:** Business logic — the main place for rules, transactions, and orchestration.

**Where:** `src/modules/<feature>/`

**When:** Almost always for a feature. Prefer thin resolvers/controllers that call services.

**How it works:** Listed in module `providers` (and `exports` if other modules need it). Inject repositories and peer services via constructor.

### `.resolver.ts`

**What:** GraphQL Query / Mutation / Field resolvers.

**Where:** Feature modules under `src/modules/`; infra only in `src/graphql/app.resolver.ts`

**When:** Exposing or changing the GraphQL API.

**How it works:**

- Register as a module `provider`
- Use `@Query` / `@Mutation` / `@ResolveField`, guards, `@CurrentUser`, `@Args('input')`
- Map entities with mappers before returning GraphQL types
- After changes: `yarn start:dev` regenerates `src/schema.gql` → frontends run `yarn graphql:codegen`

### `.inputs.ts`

**What:** GraphQL `@InputType()` classes with `class-validator` decorators.

**Where:** `src/modules/<feature>/<feature>.inputs.ts` (rarely singular `*.input.ts`)

**When:** New mutation/query arguments.

**How it works:** Global `ValidationPipe` validates instances. Prefer one `*.inputs.ts` per module that groups related inputs. **Do not** use `.dto.ts` for GraphQL.

### `.controller.ts`

**What:** REST HTTP endpoints.

**Where:** Feature modules that need REST (not the primary API surface).

**Examples:**

- `public-api.controller.ts` — vendor product REST API
- `payments-webhook.controller.ts` — Omise webhooks
- `health.controller.ts` — health checks

**When:** Webhooks, public REST, ops endpoints — not for normal storefront/admin traffic (those use GraphQL).

**How it works:** Listed in module `controllers: [...]`. Pair with `.dto.ts` for body/query validation.

### `.dto.ts`

**What:** REST request/response DTO classes (+ validators).

**Where:** `src/modules/<feature>/dto/`

**When:** Controllers need typed bodies/queries. **Never** for GraphQL (use `.inputs.ts`).

### `.guard.ts`

**What:** CanActivate checks for authN/authZ, status, API keys, rate limits.

**Where:** `src/modules/auth/guards/`, `api-keys/guards/`, etc.

**When:** New authorization rule that must run before the handler.

**How it works:**

- Global: registered as `APP_GUARD` in `AppModule` (e.g. `JwtAuthGuard`)
- Local: `@UseGuards(SomeGuard)` on resolver/controller/method
- Often reads decorator metadata (`@Public()`, `@Roles()`)

See [authentication.md](authentication.md).

### `.strategy.ts`

**What:** Passport strategy (JWT extract + validate).

**Where:** `src/modules/auth/strategies/`

**When:** Rare — only when changing how tokens are validated.

**How it works:** Provided by `AuthModule`; used by `JwtAuthGuard`.

### `.processor.ts`

**What:** BullMQ queue consumer (`@Processor`).

**Where:** Feature folders that own async jobs (payouts, search embeddings).

**When:** Work that retries, runs in background, or must not block the request.

**How it works:** `BullModule.registerQueue` + processor in `providers`, typically only when Redis is configured. Often paired with `.constants.ts` for queue names.

### `.scheduler.ts`

**What:** In-process timed/cron-like runner (not necessarily Bull).

**Example:** `payment-expiry.scheduler.ts`

**When:** Periodic cleanup/expiry inside the API process.

---

## Cross-cutting (`src/common/`)

### `.decorator.ts`

**What:** Reusable metadata / param decorators.

**Examples:** `@Public()`, `@Roles()`, `@CurrentUser()`, `@AllowSuspendedStore()`

**When:** Shared route metadata used by more than one module. Feature-specific one-offs can stay local, but auth metadata belongs here.

**How it works:** Usually `SetMetadata` + a guard that reads the key.

### `.filter.ts`

**What:** Exception filter that shapes error responses.

**Where:** `src/common/filters/`

**When:** Rare — changing global error envelope for REST/GraphQL.

**How it works:** Registered as `APP_FILTER` in `AppModule`.

### `.interceptor.ts`

**What:** Cross-cutting request/response hooks (logging, request id, transform).

**Where:** `src/common/interceptors/`

**When:** Global observability or response wrapping — **not** business logic.

**How it works:** `LoggingInterceptor` is registered as `APP_INTERCEPTOR`. Others may exist without being global.

### `.pipe.ts`

**What:** Transform/validate incoming args before handlers.

**Where:** `src/common/pipes/`

**When:** Shared validation behavior for the whole app.

**How it works:** `ValidationPipe` is `APP_PIPE` — runs `class-validator` on inputs/DTOs.

### `.util.ts`

**What:** Pure helper functions (no Nest DI).

**Where:** `src/common/utils/`, `src/database/*.util.ts`, or feature-local helpers.

**When:** Reusable logic with no injected dependencies (phone normalize, slug, SSL options, exception mapping).

**Note:** This repo uses **`.util.ts`** (singular), not `.utils.ts`. If it needs repositories or other services, make a `.service.ts` instead.

---

## GraphQL infrastructure (`src/graphql/`)

### `.loader.ts`

**What:** DataLoader factory to batch per-request field loads and avoid N+1 queries.

**Where:** `src/graphql/loaders/`

**Example:** `product-sold-count.loader.ts`

**When:** A GraphQL field repeatedly loads related data by ID across a list.

**How it works:** Factory builds a `DataLoader`; `GraphqlContextFactory` attaches loaders to each request context.

### `.model.ts` and `models/types.ts`

**What:** GraphQL `@ObjectType()` output shapes.

**Where:** Mostly `src/graphql/models/types.ts`; small standalone files like `health-status.model.ts` exist.

**When:** New shared GraphQL return types. Prefer extending `types.ts` unless the type is truly independent infrastructure.

### Mappers (`mappers.ts` / `.mapper.ts`)

**What:** Pure functions mapping entities → GraphQL types.

**Where:** Shared `src/graphql/models/mappers.ts`; rare module-local `order.mapper.ts`

**When:** Entity fields diverge from GraphQL shape, or mapping is reused across resolvers.

**Rule:** Keep mapping out of services when a mapper already exists; resolvers call mappers.

### `schema.gql`

**What:** Generated GraphQL SDL — the API contract for frontends.

**Do not edit by hand.** Regenerates when the API boots (`yarn start:dev` / schema generation). Frontends then run `yarn graphql:codegen`.

---

## Tests

| Pattern                                     | Location                    | Purpose                        | Command           |
| ------------------------------------------- | --------------------------- | ------------------------------ | ----------------- |
| `*.service.spec.ts` (and other `*.spec.ts`) | Next to source under `src/` | Unit tests, mocked deps        | `yarn test`       |
| `*.test-providers.ts`                       | Module folder               | Shared Nest testing stubs      | Imported by specs |
| `*.e2e-spec.ts`                             | `test/`                     | Full Nest bootstrap E2E        | `yarn test:e2e`   |
| `*.e2e.test.ts`                             | `test/`                     | Service-level e2e scenarios    | `yarn test:e2e`   |
| `*.int.test.ts`                             | `test/`                     | Integration with infra helpers | `yarn test:e2e`   |

**When:** Add/update a `*.spec.ts` when service behavior changes. Prefer colocated unit tests; put cross-module journeys under `test/`.

---

## Other suffixes you may see

| Pattern                        | Purpose                                        | When                                            |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| `.constants.ts`                | Queue names, fixed IDs, magic strings          | Avoid hardcoding in processors/services         |
| `.types.ts`                    | TypeScript-only interfaces (not GraphQL types) | Shared typing inside a feature                  |
| `.factory.ts`                  | Builds request-scoped GraphQL context          | Extending loaders/context                       |
| `.engine.ts`                   | Algorithm cores (search ranking)               | Heavy compute kept out of the main service file |
| `.rules.ts` / `.validation.ts` | Policy / publish gates                         | Deterministic rule checks used by a service     |
| `.support.ts`                  | Feature support helpers (e.g. vector search)   | Non-DI or module helpers tied to one feature    |
| `index.ts`                     | Barrel re-exports                              | Optional convenience                            |

---

## Special bootstrap files

| File                              | Edit?                     | Role                                                   |
| --------------------------------- | ------------------------- | ------------------------------------------------------ |
| `src/main.ts`                     | Yes (boot concerns)       | Nest bootstrap, CORS, static assets, body parser       |
| `src/app.module.ts`               | Yes (new modules/globals) | Root DI, TypeORM, global guard/pipe/filter/interceptor |
| `src/graphql/graphql.module.ts`   | Yes (GraphQL modules)     | Apollo + GraphQL feature imports                       |
| `src/schema.gql`                  | **No**                    | Auto-generated SDL                                     |
| `ormconfig.ts` (repo root)        | Rarely                    | TypeORM CLI DataSource for migrations                  |
| `src/database/database.module.ts` | No (unused)               | Alternate TypeORM module — runtime uses `AppModule`    |

---

## Decision cheatsheet

| I need to…                      | Add / edit                                                     |
| ------------------------------- | -------------------------------------------------------------- |
| Persist a new table or column   | `.entity.ts` + migration (+ `entities/index.ts` if new entity) |
| Add a shared status enum        | `.enums.ts` (or on entity if tiny/local)                       |
| Expose GraphQL mutation/query   | `.resolver.ts` + `.inputs.ts` + `.service.ts` + mapper/types   |
| Change business rules           | `.service.ts` (+ `.spec.ts`)                                   |
| Add REST webhook / public HTTP  | `.controller.ts` + `dto/*.dto.ts`                              |
| Restrict who can call something | `.guard.ts` and/or `.decorator.ts` + `@Roles` / `@Public`      |
| Read new env vars               | `.config.ts` + `.env.example`                                  |
| Fix N+1 on a GraphQL field      | `.loader.ts` + wire in context factory                         |
| Run work in the background      | `.processor.ts` (+ queue constants) when Redis is available    |
| Complex reusable SQL            | `.repository.ts` (else `@InjectRepository` in service)         |
| Pure helper without DI          | `.util.ts`                                                     |
| Wire a new feature together     | `.module.ts` → import in `app.module.ts` / `graphql.module.ts` |

Typical new GraphQL feature kit:

```text
src/database/entities/my-thing.entity.ts
src/database/migrations/<ts>-AddMyThing.ts
src/modules/my-feature/
├── my-feature.module.ts
├── my-feature.service.ts
├── my-feature.resolver.ts
├── my-feature.inputs.ts
└── my-feature.service.spec.ts
```

Then update shared GraphQL types/mappers if needed, boot to refresh `schema.gql`, and run frontend codegen.

---

## Related docs

- [Folder structure](folder-structure.md) — where directories live
- [Feature development](feature-development.md) — end-to-end checklist
- [Database](database.md) — migrations, entities, seeds
- [API](api.md) — GraphQL vs REST surfaces
- [Coding conventions](coding-conventions.md) — naming, validation, errors
- [Authentication](authentication.md) — JWT, OTP, guards, decorators
