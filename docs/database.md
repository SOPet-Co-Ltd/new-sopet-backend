# Database

PostgreSQL 15+ with TypeORM. Database name: `sopet_ecommerce` (from `.env.example` / docker-compose).

## Configuration

| File                              | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `ormconfig.ts`                    | TypeORM CLI DataSource (`yarn migration:run`, `generate`, etc.)                        |
| `src/app.module.ts`               | Runtime TypeORM (`TypeOrmModule.forRootAsync`)                                         |
| `src/config/database.config.ts`   | `registerAs('database')` helpers — **not** loaded by `AppModule`                       |
| `src/database/database.module.ts` | Alternate module with pool `extra` — **not imported**                                  |
| `.env.example`                    | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `DB_POOL_MAX` |

**Critical:** `synchronize: false` everywhere. All schema changes go through migrations.

Runtime SSL helpers: `src/database/postgres-ssl.util.ts`. UTC timestamp parsing for `pg` is applied in `main.ts` via `pg-timestamp.util.ts`.

## Entities

**59 entities** in `src/database/entities/` (excluding `index.ts`).

Enums in `src/database/entities/enums/` (`order.enums.ts`, `taxonomy.enums.ts`).

### Entity conventions

```typescript
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- UUID primary keys
- Soft deletes via `deletedAt` on major entities
- Snake_case column names via `@Column({ name: '...' })`

### Entity groups

| Group      | Entities                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth       | `user`, `customer`, `otp-code`, `password-reset-token`, `email-verification-token`                                                                                                                  |
| Stores     | `store`, `store-member(-invitation)`, `store-request`, `store-shipping-option`, `store-reactivation-request(-image)`, `vendor-invitation`, `admin-invitation`, `store-api-key`, `shipping-provider` |
| Catalog    | `product`, `product-variant`, `product-image`, `category`, `brand`, `pet-type`, `tag`                                                                                                               |
| Orders     | `order`, `order-item`, `order-status-history`, `order-shipping-address`, `order-store-shipping`                                                                                                     |
| Cart       | `cart`, `cart-item`                                                                                                                                                                                 |
| Payments   | `payment`, `saved-payment-method`, `payout`, `payout-item`                                                                                                                                          |
| Promotions | `promotion`, `promotion-usage`                                                                                                                                                                      |
| Reviews    | `review`, `review-image`, `review-reply`                                                                                                                                                            |
| Search     | `search-synonym`, `product-embedding`, `search-event`, `search-suggestion-event`, `user-search-profile`                                                                                             |
| Platform   | `platform-banner`, `platform-sponsor`, `platform-ad`                                                                                                                                                |
| System     | `notification`, `user-notification`, `admin-log`, `audit-log`, `setting`, `favorite`, `saved-address`, `inventory-transaction`                                                                      |

**Reserved (unused):** `dispute`, `dispute-item`, `dispute-message`, `dispute-image` — schema and relations exist, but no module/service/resolver reads or writes them today. See [Architecture](architecture.md#feature-modules).

## Migrations

**38 migrations** in `src/database/migrations/`.

### Commands

```bash
yarn migration:run          # Apply pending migrations
yarn migration:revert       # Revert last migration
yarn migration:generate src/database/migrations/MyChange  # After entity edits
yarn migration:create src/database/migrations/MyChange    # Empty migration
```

All CLI commands use `ormconfig.ts` (entity/migration globs under `src/`).

### Workflow

1. Modify entity in `src/database/entities/`
2. `yarn migration:generate src/database/migrations/DescriptiveName`
3. Review generated SQL
4. `yarn migration:run`
5. Commit entity + migration together

## Custom repositories

6 repositories in `src/database/repositories/`:

- `user.repository.ts`
- `customer.repository.ts`
- `store.repository.ts`
- `product.repository.ts`
- `order.repository.ts`
- `promotion.repository.ts`

Use for complex queries. Most modules inject `@InjectRepository(Entity)` directly.

## Seeds

| Script         | Command                 | Purpose                                  |
| -------------- | ----------------------- | ---------------------------------------- |
| Dev seed       | `yarn db:seed:dev`      | Admin, vendor, demo catalog (idempotent) |
| Alias          | `yarn seed`             | Same as `db:seed:dev`                    |
| Reset (empty)  | `yarn db:reset:migrate` | Drop schema, migrate, **no seed**        |
| Alias          | `yarn db:reset`         | Same as `db:reset:migrate`               |
| Dev reset      | `yarn db:reset:dev`     | Drop schema, migrate, dev seed           |
| Prod bootstrap | `yarn db:seed:prod`     | Admin account only (idempotent)          |

**Safety:** `db:reset:dev` and `db:seed:dev` are local-only. `db:reset:migrate` is local-only unless you set `DB_RESET_ALLOW_PRODUCTION=1` (destructive on UAT/prod). Unrecognized local hosts can use `DB_RESET_ALLOW=1`.

`db:seed:prod` creates **only** the platform admin (`admin@sopet.org` by default). It does not seed vendors, stores, or products. Default password: `P@ssw0rd` — change after first login.

Default credentials after dev seed:

| Role   | Email              | Password   |
| ------ | ------------------ | ---------- |
| Admin  | `admin@sopet.org`  | `P@ssw0rd` |
| Vendor | `vendor@sopet.org` | `P@ssw0rd` |

Seed entrypoints: `src/database/seeds/seed-dev.ts`, `seed-prod.ts`, `reset-db.ts` (helpers in the same folder).

## Transactions

Order creation (`orders.service.ts`) demonstrates the pattern: `DataSource.transaction` + pessimistic write locks on variants while decrementing stock and writing inventory transactions.

## Local infrastructure

```bash
yarn docker:up      # Start Postgres, Redis, MinIO
yarn docker:check   # Health check all services
yarn docker:down    # Stop services
yarn docker:reset   # Stop and remove volumes
yarn docker:ps      # List compose services
yarn docker:logs    # Follow compose logs
```

MinIO console: http://localhost:9001 (minioadmin / minioadmin)

`docker-compose.yml` also defines an `api` service under Compose profile `full` (not started by default `yarn docker:up`).

## Connection pooling

`DB_POOL_MAX` appears in `.env.example` (default 20). The **live** `AppModule` TypeORM factory does not currently set `extra.max` / pool options — Node `pg` driver defaults apply. Pool tuning exists on unused `DatabaseModule` (`extra.max`, idle/connection timeouts) if that module is adopted later.

## Related docs

- [File types](file-types.md) — `.entity`, migrations, repositories, seeds
- [Folder structure — database](folder-structure.md#srcdatabase)
- [Feature development](feature-development.md)
