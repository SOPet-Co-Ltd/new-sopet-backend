# Feature Development Guide

How to implement a new backend feature following existing patterns.

## Checklist

```
1. Planning doc (`docs/design/` if large feature)
2. Database entity + migration
3. Service (business logic)
4. GraphQL input types + resolver
5. Register module in graphql.module.ts + app.module.ts
6. Unit tests (*.spec.ts)
7. schema.gql regenerated (yarn start:dev)
8. Frontend codegen in affected repos
9. Integration/E2E tests if needed
```

## Example: adding a "wishlist note" field

### 1. Entity change

```typescript
// src/database/entities/favorite.entity.ts (hypothetical)
@Column({ name: 'note', nullable: true })
note?: string;
```

### 2. Migration

```bash
yarn migration:generate src/database/migrations/AddFavoriteNote
yarn migration:run
```

### 3. Input type

```typescript
// src/modules/users/account.inputs.ts
@InputType()
export class UpdateFavoriteNoteInput {
  @Field()
  @IsUUID()
  favoriteId: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(200)
  note?: string;
}
```

### 4. Service method

```typescript
// src/modules/users/users.service.ts
async updateFavoriteNote(customerId: string, input: UpdateFavoriteNoteInput) {
  const favorite = await this.favoriteRepository.findOne({
    where: { id: input.favoriteId, customerId },
  });
  if (!favorite) {
    throw new NotFoundException({ code: 'FAVORITE_NOT_FOUND', message: '...' });
  }
  favorite.note = input.note;
  return this.favoriteRepository.save(favorite);
}
```

### 5. Resolver

```typescript
// src/modules/users/account.resolver.ts
@Mutation(() => FavoriteType)
@Roles('customer')
async updateFavoriteNote(
  @CurrentUser('sub') customerId: string,
  @Args('input') input: UpdateFavoriteNoteInput,
): Promise<FavoriteType> {
  const favorite = await this.usersService.updateFavoriteNote(customerId, input);
  return mapFavorite(favorite);
}
```

### 6. Register module

Ensure `UsersModule` is in `graphql.module.ts` and `app.module.ts` (already is for existing features).

### 7. Test

```typescript
// src/modules/users/users.service.spec.ts
describe('updateFavoriteNote', () => {
  it('throws FAVORITE_NOT_FOUND when missing', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.updateFavoriteNote('cust-id', { favoriteId: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

### 8. Frontend coordination

```bash
# In storefront
yarn graphql:codegen
# Add operation to src/lib/graphql/operations/favorites.graphql
# Update hook in src/lib/hooks/useFavorites.ts
```

## New module from scratch

For entirely new domains:

```text
src/modules/my-feature/
├── my-feature.module.ts
├── my-feature.service.ts
├── my-feature.resolver.ts
├── my-feature.inputs.ts
└── my-feature.service.spec.ts

src/database/entities/my-entity.entity.ts
src/database/migrations/<timestamp>-AddMyEntity.ts
```

**Module file:**

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([MyEntity])],
  providers: [MyFeatureService, MyFeatureResolver],
  exports: [MyFeatureService],
})
export class MyFeatureModule {}
```

**Register in:**

- `src/app.module.ts` → `imports: [MyFeatureModule, ...]`
- `src/graphql/graphql.module.ts` → `imports: [MyFeatureModule, ...]`

## When to use transactions

Use `DataSource.transaction()` when:

- Multiple tables must update atomically (orders + inventory)
- Pessimistic locks are needed (stock decrement)
- Partial failure would leave inconsistent state

## When to use BullMQ

Use queues (`@nestjs/bullmq`) for:

- Background processing (search embeddings)
- Scheduled jobs (payouts, payment expiry)
- Work that can be retried asynchronously

See `src/modules/search/` and `src/modules/payouts/` for examples.

## When to add a custom repository

Prefer `@InjectRepository(Entity)` in services. Add `database/repositories/` only when:

- Complex queries are reused across services
- Query logic is substantial enough to test independently

## Authorization checklist

- [ ] `@Public()` for guest-accessible operations
- [ ] `@Roles('customer')` / `@Roles('vendor', 'admin')` as needed
- [ ] Verify ownership in service (customer can only access own data)
- [ ] `@AllowSuspendedStore()` only when intentionally allowing suspended stores

## Related docs

- [File types](file-types.md)
- [API](api.md)
- [Database](database.md)
- [Coding conventions](coding-conventions.md)

After schema changes, regenerate `src/schema.gql`, then run `yarn graphql:codegen` in `../sopet-storefront` and/or `../sopet-admin`. Commit each repo separately.
