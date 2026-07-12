# Database

PostgreSQL 15+ with TypeORM. Database name: `sopet_ecommerce` (from `.env.example`).

## Configuration

| File                | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `ormconfig.ts`      | TypeORM CLI (migrations)                                                               |
| `src/app.module.ts` | Runtime TypeORM config                                                                 |
| `.env.example`      | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`, `DB_POOL_MAX` |

**Critical:** `synchronize: false` everywhere. All schema changes go through migrations.

## Entities

**56 entities** in `src/database/entities/`.

Enums in `src/database/entities/enums/`.

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
- `class-validator` decorators on columns where applicable

### Entity groups

| Group      | Entities                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| Auth       | `user`, `customer`, `otp-code`, `password-reset-token`                                |
| Stores     | `store`, `store-member`, `store-shipping-*`, `vendor-invitation`                      |
| Catalog    | `product`, `product-variant`, `product-image`, `category`, `brand`, `pet-type`, `tag` |
| Orders     | `order`, `order-item`, `order-status-history`, `order-shipping-address`               |
| Cart       | `cart`, `cart-item`                                                                   |
| Payments   | `saved-payment-method`                                                                |
| Promotions | `promotion`, `promotion-usage`                                                        |
| Reviews    | `review`, `review-image`                                                              |
| Search     | `search-synonym`, `product-embedding`, `search-analytics-*`                           |
| System     | `notification`, `admin-log`, `setting`, `api-key`                                     |

## Migrations

**33 migrations** in `src/database/migrations/`.

### Commands

```bash
yarn migration:run          # Apply pending migrations
yarn migration:revert       # Revert last migration
yarn migration:generate src/database/migrations/MyChange  # After entity edits
yarn migration:create src/database/migrations/MyChange    # Empty migration
```

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

| Script         | Command             | Purpose                                  |
| -------------- | ------------------- | ---------------------------------------- |
| Dev seed       | `yarn db:seed:dev`  | Admin, vendor, demo catalog (idempotent) |
| Dev reset      | `yarn db:reset:dev` | Drop schema, migrate, seed               |
| Prod bootstrap | `yarn db:seed:prod` | Admin account only (idempotent)          |

**Safety:** `db:reset:dev` refuses to run on production hosts or `NODE_ENV=production`.

`db:seed:prod` creates **only** the platform admin (`admin@sopet.org` by default). It does not seed vendors, stores, or products. When `NODE_ENV=production` and the admin does not exist yet, set `PROD_ADMIN_INITIAL_PASSWORD` before running.

Default credentials after dev seed:

| Role   | Email              | Password   |
| ------ | ------------------ | ---------- |
| Admin  | `admin@sopet.org`  | `P@ssw0rd` |
| Vendor | `vendor@sopet.org` | `P@ssw0rd` |

Production bootstrap uses the same admin email by default; password comes from `PROD_ADMIN_INITIAL_PASSWORD` (not the dev default).

Seed files: `src/database/seeds/seed-dev.ts`, `seed-prod.ts`, `reset-db.ts`.

## Transactions

Order creation (`orders.service.ts`) demonstrates the pattern:

```typescript
await this.dataSource.transaction(async (manager) => {
  const order = manager.create(Order, { ... });
  await manager.save(order);
  // Pessimistic lock on variants
  await manager.findOne(ProductVariant, {
    where: { id: variantId },
    lock: { mode: 'pessimistic_write' },
  });
  // Decrement stock, create inventory transaction
});
```

## Local infrastructure

```bash
yarn docker:up      # Start Postgres, Redis, MinIO
yarn docker:check   # Health check all services
yarn docker:down    # Stop services
yarn docker:reset   # Stop and remove volumes
```

MinIO console: http://localhost:9001 (minioadmin / minioadmin)

## Connection pooling

Configured in `app.module.ts`:

- `max: 20` connections
- `idleTimeoutMillis: 30000`

## Related docs

- [Folder structure — database](folder-structure.md#srcdatabase)
- [Feature development](feature-development.md)
- Legacy detail: `src/database/README.md` (entity list; migration count may be stale)
