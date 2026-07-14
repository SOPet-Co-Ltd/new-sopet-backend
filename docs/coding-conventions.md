# Coding Conventions

Conventions observed in the `sopet-backend` codebase.

## Naming

| Artifact    | Convention                | Example              |
| ----------- | ------------------------- | -------------------- |
| Files       | kebab-case                | `orders.service.ts`  |
| Classes     | PascalCase                | `OrdersService`      |
| Methods     | camelCase                 | `createOrder`        |
| Entities    | PascalCase + `.entity.ts` | `order.entity.ts`    |
| DB columns  | snake_case                | `created_at`         |
| Error codes | SCREAMING_SNAKE           | `INSUFFICIENT_STOCK` |

For every suffix (`.entity`, `.inputs`, `.resolver`, `.guard`, …) — what it is, when to edit, and how it is wired — see [file-types.md](file-types.md).

## Module structure

Typical feature module layout:

```
modules/<feature>/
├── <feature>.module.ts
├── <feature>.service.ts
├── <feature>.resolver.ts      # if GraphQL
├── <feature>.inputs.ts        # GraphQL inputs
├── dto/                       # REST DTOs only
├── guards/                    # module-specific (e.g. auth, api-keys)
└── <feature>.service.spec.ts
```

Infrastructure-only modules (`email`, `sms`, `redis`, `queue`, `omise`, `inventory`, `health`) may omit resolvers/inputs.

## Imports

- Relative paths dominate: `../../database/entities/order.entity.ts`
- Path aliases available but less common: `@entities/order.entity`
- NestJS DI: constructor injection with `private readonly`

```typescript
constructor(
  @InjectRepository(Order)
  private readonly orderRepository: Repository<Order>,
  private readonly promotionsService: PromotionsService,
) {}
```

## Validation

### GraphQL inputs

```typescript
@InputType()
export class CreateOrderInput {
  @Field(() => [OrderItemInput])
  @ValidateNested({ each: true })
  @Type(() => OrderItemInput)
  items: OrderItemInput[];
}
```

### Global pipe

`ValidationPipe` in `app.module.ts` transforms plain objects to class instances and validates.

Skips `type === 'custom'` arguments (GraphQL parent/context).

### Error shape

```typescript
throw new BadRequestException({
  code: 'GUEST_PHONE_REQUIRED',
  message: 'Guest checkout requires guestPhone',
});
```

Never throw raw strings for business errors.

## GraphQL mapping

Entities are mapped to GraphQL types in `src/graphql/models/mappers.ts`:

```typescript
export function mapOrder(order: Order): OrderType {
  return { id: order.id, status: order.status, ... };
}
```

Resolvers return mapped types, not raw entities.

## Error handling

| Context | Handler                                              |
| ------- | ---------------------------------------------------- |
| GraphQL | `graphql.module.ts` `formatError`                    |
| REST    | `HttpExceptionFilter`                                |
| Unknown | `mapUnknownException()` — TypeORM `23505` → CONFLICT |

## Logging

```typescript
private readonly logger = new Logger(OrdersService.name);
this.logger.log('Order created', { orderId });
```

`LoggingInterceptor` logs HTTP requests only (skips GraphQL path).

## Testing

| Type | Location             | Pattern                                 |
| ---- | -------------------- | --------------------------------------- |
| Unit | `src/**/*.spec.ts`   | Mock `@InjectRepository`, mock services |
| E2E  | `test/*.e2e-spec.ts` | Bootstrap module with mocks             |

```bash
yarn test              # Unit (jest, rootDir: src)
yarn test:cov          # Coverage (80% threshold on key services)
yarn test:e2e          # E2E (mocked infra)
```

Coverage scoped to: orders, auth, products, stores, payouts, cart, payments, promotions services.

## Formatting and lint

```bash
yarn format            # Prettier write
yarn format:check      # Prettier check (CI)
yarn lint              # ESLint with fix
```

- Husky pre-commit → lint-staged → Prettier on `*.{ts,tsx,js,jsx,json,md,yml,yaml}`
- Husky pre-push → `yarn test` (unit tests; e2e stays in CI)
- ESLint flat config: `eslint.config.mjs`
- `@typescript-eslint/no-explicit-any`: off

## Authorization

- Global: `JwtAuthGuard`, `StoreStatusGuard`, `CustomerStatusGuard`
- `@Public()` skips required auth (token still parsed when present)
- Role checks: `@UseGuards(RolesGuard)` + `@Roles(...)` (RolesGuard is not global)

## Git

- Yarn only (`preinstall: npx only-allow yarn`)
- CI on PR to `main` / `uat`: format → build → test → e2e (Node 22)

## Related docs

- [Feature development](feature-development.md)
- [Folder structure](folder-structure.md)
