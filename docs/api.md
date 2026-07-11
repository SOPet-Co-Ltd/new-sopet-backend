# API Layer

## GraphQL (primary API)

**Endpoint:** `POST /graphql` (port 3002)

**Playground:** Available at the same URL when `NODE_ENV !== 'production'`.

### Schema

Auto-generated code-first schema at `src/schema.gql`. Regenerated on `yarn start:dev`.

Root types:

| Type           | Line in schema.gql (approx) | Contents                                        |
| -------------- | --------------------------- | ----------------------------------------------- |
| `Query`        | ~900                        | Catalog, cart, orders, search, admin, analytics |
| `Mutation`     | ~484                        | Auth, CRUD, checkout, taxonomy, reviews         |
| `Subscription` | ~1376                       | `paymentStatusUpdated`                          |

Do not edit `schema.gql` manually. Change resolvers/entities and restart the server.

### Resolver pattern

From `src/modules/orders/orders.resolver.ts` (typical structure):

```typescript
@Resolver(() => OrderType)
export class OrdersResolver {
  constructor(private readonly ordersService: OrdersService) {}

  @Mutation(() => OrderType)
  @Public() // or @Roles('customer') for protected
  async createOrder(
    @Args('input') input: CreateOrderInput,
    @CurrentUser() user?: JwtPayload,
  ): Promise<OrderType> {
    const order = await this.ordersService.create(/* map input */);
    return mapOrder(order);
  }
}
```

### Input validation

GraphQL inputs use `@InputType()` classes with `class-validator`:

```typescript
// src/modules/auth/auth.inputs.ts
@InputType()
export class SendCustomerOtpInput {
  @Field()
  @IsPhoneNumber('TH')
  phone: string;
}
```

Global `ValidationPipe` (`src/common/pipes/validation.pipe.ts`) validates before the resolver runs.

### GraphQL context

`src/graphql/loaders/graphql-context.factory.ts` provides:

- `req`, `res` — Express request/response
- DataLoaders — e.g. `productSoldCountLoader`

Access in resolvers via `@Context()`.

### Error format

GraphQL errors are formatted in `graphql.module.ts`:

```typescript
formatError: (formattedError, error) => {
  // Uses exception-response.util.ts
};
```

Client receives:

```json
{
  "errors": [
    {
      "message": "...",
      "extensions": { "code": "INSUFFICIENT_STOCK" }
    }
  ]
}
```

### Subscriptions

WebSocket endpoint: same `/graphql` path via `graphql-ws`.

Used by: `PaymentsResolver.paymentStatusUpdated`, `DisputesResolver.disputeMessageAdded`

Storefront connects via `getGraphqlWsUrl()` in `sopet-storefront/src/lib/config.ts`.

### Disputes module (returns)

| Operation                 | Role          | Notes                                                               |
| ------------------------- | ------------- | ------------------------------------------------------------------- |
| `createDisputes`          | customer      | Per-store split; does **not** change `orders.status`                |
| `myDisputes`              | customer      | List with `items`, `resolution`                                     |
| `openDisputes`            | admin         | Queue                                                               |
| `vendorDisputes(storeId)` | vendor        | Store-scoped                                                        |
| `resolveDispute`          | admin         | Sets `resolved`; may sync order to `refunded` if all items refunded |
| `sendDisputeMessage`      | admin, vendor | Blocked when dispute resolved                                       |

Order sync on resolve: `src/modules/disputes/dispute-order-sync.util.ts`. Cancel guard: `ORDER_HAS_ACTIVE_DISPUTE`.

Runtime reference: [workspace returns-and-disputes](../../new-sopet-workspace/docs/developer/returns-and-disputes.md).

## REST endpoints (limited)

| Method | Path                               | Auth                          | Module                           |
| ------ | ---------------------------------- | ----------------------------- | -------------------------------- |
| `POST` | `/webhooks/omise`                  | HMAC (`OMISE_WEBHOOK_SECRET`) | `payments-webhook.controller.ts` |
| `POST` | `/api/v1/stores/:storeId/products` | API key (`ApiKeyGuard`)       | `public-api.controller.ts`       |

There are **no** `/v1/*` REST routes for application features. Admin and storefront use GraphQL exclusively.

### Omise webhook

1. Configure URL in Omise dashboard: `https://<host>/webhooks/omise`
2. Set `OMISE_WEBHOOK_SECRET` in `.env`
3. Verifies `Omise-Signature` + `Omise-Signature-Timestamp` headers
4. When secret is empty (local dev), verification is skipped with a warning

`main.ts` enables `rawBody: true` for HMAC verification.

## GraphQL module registration

New resolvers must be:

1. Declared in the feature `*.module.ts`
2. Feature module imported in `src/graphql/graphql.module.ts`
3. Feature module imported in `src/app.module.ts` (if not already)

## Frontend consumption

| Frontend   | Operations location                                     | Generated types        |
| ---------- | ------------------------------------------------------- | ---------------------- |
| Storefront | `src/lib/graphql/operations/*.graphql`                  | `generated/graphql.ts` |
| Admin      | `src/lib/graphql/documents.ts` + `operations/*.graphql` | `generated/graphql.ts` |

After schema changes, frontends run `yarn graphql:codegen`.

## Related docs

- [Authentication](authentication.md)
- [Feature development](feature-development.md)
- [Workspace data flow](../../new-sopet-workspace/docs/developer/data-flow.md)
