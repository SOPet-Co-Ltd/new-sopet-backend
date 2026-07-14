# Backend Architecture

## Pattern

**NestJS modular monolith** with code-first GraphQL. Business logic lives in injectable services; API surface is primarily GraphQL resolvers.

```mermaid
flowchart TB
  subgraph presentation [Presentation Layer]
    R[Resolvers<br/>*.resolver.ts]
    C[Controllers<br/>webhooks, public API]
  end

  subgraph application [Application Layer]
    S[Services<br/>*.service.ts]
  end

  subgraph domain [Domain / Data Layer]
    E[Entities<br/>database/entities/]
    REP[Repositories<br/>database/repositories/]
  end

  subgraph infrastructure [Infrastructure]
    PG[(PostgreSQL)]
    RD[(Redis)]
    S3[(S3 / MinIO / R2)]
    MQ[BullMQ]
    EXT[Omise, Resend, SMS]
  end

  R --> S
  C --> S
  S --> E
  S --> REP
  S --> RD
  S --> S3
  S --> MQ
  S --> EXT
  E --> PG
  REP --> PG
```

## Why this organization

- **Modules per domain** — each feature (orders, products, search) is self-contained with its own module, service, and resolver. Teams can work on domains without cross-cutting changes.
- **GraphQL aggregation** — `AppGraphqlModule` imports all feature modules and provides a single `/graphql` endpoint. Frontends need one API.
- **Services own business rules** — resolvers are thin: validate input, call service, map to GraphQL type. Complex logic (transactions, promotion stacking) stays in services.
- **Global guards** — auth and suspension checks apply everywhere unless opted out with `@Public()`.

## Module registration

`src/app.module.ts` imports feature modules and registers globals:

```typescript
// Global providers (from app.module.ts)
{ provide: APP_PIPE, useClass: ValidationPipe },
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: StoreStatusGuard },
{ provide: APP_GUARD, useClass: CustomerStatusGuard },
{ provide: APP_FILTER, useClass: HttpExceptionFilter },
{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
```

## Feature modules

| Module        | Path                     | GraphQL   | REST           | Primary responsibility                                                        |
| ------------- | ------------------------ | --------- | -------------- | ----------------------------------------------------------------------------- |
| auth          | `modules/auth/`          | ✓         | —              | OTP, JWT, login, password reset                                               |
| users         | `modules/users/`         | ✓         | —              | Customer account, addresses, favorites                                        |
| customers     | `modules/customers/`     | ✓         | —              | Admin customer management                                                     |
| stores        | `modules/stores/`        | ✓         | —              | Store CRUD, team, shipping, invitations                                       |
| products      | `modules/products/`      | ✓         | —              | Product catalog, variants, images                                             |
| taxonomy      | `modules/taxonomy/`      | ✓         | —              | Categories, pet types, brands                                                 |
| cart          | `modules/cart/`          | ✓         | —              | Guest + auth carts, merge on login                                            |
| orders        | `modules/orders/`        | ✓         | —              | Order creation, fulfillment, status                                           |
| payments      | `modules/payments/`      | ✓         | ✓ webhook      | Omise charges, subscriptions                                                  |
| payouts       | `modules/payouts/`       | ✓         | —              | Vendor payout scheduling (BullMQ)                                             |
| promotions    | `modules/promotions/`    | ✓         | —              | Platform + store promotions                                                   |
| reviews       | `modules/reviews/`       | ✓         | —              | Product reviews, vendor replies                                               |
| analytics     | `modules/analytics/`     | ✓         | —              | Dashboard metrics                                                             |
| platform      | `modules/platform/`      | ✓         | —              | Banners, sponsors, ads                                                        |
| admin-team    | `modules/admin-team/`    | ✓         | —              | Admin team invitations                                                        |
| notifications | `modules/notifications/` | ✓         | —              | In-app + email notifications                                                  |
| storage       | `modules/storage/`       | ✓         | —              | Image upload (S3/MinIO/R2)                                                    |
| search        | `modules/search/`        | ✓         | —              | Smart search, synonyms, analytics                                             |
| api-keys      | `modules/api-keys/`      | ✓         | —              | Store API key management                                                      |
| audit-logs    | `modules/audit-logs/`    | ✓         | —              | `@Global()` admin action audit trail                                          |
| public-api    | `modules/public-api/`    | —         | ✓              | `POST /api/v1/stores/:id/products`                                            |
| health        | `modules/health/`        | ✓ (query) | ✓ (`/health*`) | Terminus DB/Redis checks; GraphQL `health` query in `graphql/app.resolver.ts` |
| email         | `modules/email/`         | —         | —              | `@Global()` Resend; templates use logo at `${API_URL}/images/email/…`         |
| sms           | `modules/sms/`           | —         | —              | OTP SMS delivery                                                              |
| redis         | `modules/redis/`         | —         | —              | `@Global()` Redis client                                                      |
| omise         | `modules/omise/`         | —         | —              | Omise SDK wrapper                                                             |
| queue         | `modules/queue/`         | —         | —              | `@Global()` BullMQ connection setup (`QueueModule.forRoot()`)                 |
| inventory     | `modules/inventory/`     | —         | —              | Inventory transactions (service only)                                         |

**Reserved, not wired:** `Dispute`, `DisputeItem`, `DisputeMessage`, `DisputeImage` entities and their migrations exist in `src/database/entities/` for a returns/disputes feature, but there is currently no `modules/disputes/` service, resolver, or GraphQL surface — the columns and relations (e.g. `Order.disputes`, `Order.sourceDisputeId`) are unused by any running code path.

## GraphQL module

`src/graphql/graphql.module.ts`:

- `ApolloDriver` with `autoSchemaFile: src/schema.gql`
- Playground enabled when `NODE_ENV !== 'production'`
- `graphql-ws` subscriptions (payment status)
- Context factory attaches DataLoaders (`src/graphql/loaders/`)
- `formatError` uses `exception-response.util.ts`

## Dependency direction

```
Resolver → Service → Repository / Entity / Other Service → Infrastructure
```

Resolvers must not access TypeORM repositories directly — always go through services.

## Transactions

Critical writes use `DataSource.transaction()`:

```typescript
// Pattern in orders.service.ts
await this.dataSource.transaction(async (manager) => {
  // create order, decrement inventory with pessimistic lock, etc.
});
```

## Async side effects

Non-critical work (vendor notifications) uses fire-and-forget:

```typescript
this.notificationsService.notifyVendorsAboutNewOrder(order).catch(() => {});
```

## Related docs

- [Folder structure](folder-structure.md)
- [API](api.md)
- [Feature development](feature-development.md)
