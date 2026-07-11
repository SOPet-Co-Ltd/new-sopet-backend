# Database Layer Implementation

Complete TypeORM database layer for the multi-vendor e-commerce platform.

## Overview

This implementation provides a production-ready database layer with:

- **27 TypeORM entities** with proper relations, validations, and soft deletes
- **2 database migrations** (schema creation and indexes)
- **6 custom repositories** with optimized queries
- **Full-text search** support for products (Thai/English)
- **Transaction management** for critical operations (orders, inventory)
- **Soft deletes** with `deleted_at` for data recovery
- **UUID primary keys** for distributed system compatibility

## Directory Structure

```
src/database/
├── entities/               # TypeORM entities (27 files)
│   ├── user.entity.ts
│   ├── customer.entity.ts
│   ├── store.entity.ts
│   ├── product.entity.ts
│   ├── order.entity.ts
│   └── ... (22 more)
├── repositories/           # Custom repositories (6 files)
│   ├── user.repository.ts
│   ├── customer.repository.ts
│   ├── store.repository.ts
│   ├── product.repository.ts
│   ├── order.repository.ts
│   └── promotion.repository.ts
├── migrations/             # TypeORM migrations (2 files)
│   ├── 1700000000001-InitialSchema.ts
│   └── 1700000000002-AddIndexes.ts
└── database.module.ts      # NestJS database module

src/config/
└── database.config.ts      # Database configuration

ormconfig.ts               # TypeORM CLI configuration
```

## Entities

### Authentication & Users

- **User** - Vendors and admins (email-based auth)
- **Customer** - Customers (phone-based auth)
- **OtpCode** - OTP verification for phone login

### Store Management

- **Store** - Vendor stores with approval workflow
- **StoreMember** - Team management for stores

### Product Catalog

- **Product** - Base product information
- **ProductImage** - Multiple images per product
- **ProductVariant** - Size/color/SKU combinations
- **InventoryTransaction** - Stock movement audit trail

### Orders & Payments

- **Order** - Multi-vendor orders with guest support
- **OrderItem** - Line items per store
- **OrderStatusHistory** - Order status change tracking

### Promotions & Payouts

- **Promotion** - Platform and vendor-level promotions
- **PromotionUsage** - Promotion usage tracking
- **Payout** - Vendor payout management
- **PayoutItem** - Orders included in payout

### Customer Features

- **SavedAddress** - Customer shipping addresses
- **SavedPaymentMethod** - Omise card tokens
- **Cart** - Guest and authenticated shopping carts
- **CartItem** - Cart line items

### Reviews & Disputes

- **Review** - Product reviews with moderation
- **ReviewImage** - Review photos
- **Dispute** - Order dispute management
- **DisputeMessage** - Dispute conversation thread

### System

- **Notification** - Email/SMS notification log
- **AdminLog** - Admin activity audit trail
- **Setting** - Platform configuration

## Database Setup

### 1. Install Dependencies

```bash
yarn install
```

### 2. Configure Database

Copy `.env.example` to `.env` and update database credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-password
DB_NAME=sopet_ecommerce
```

### 3. Create Database

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE sopet_ecommerce;"
```

### 4. Run Migrations

```bash
# Run all pending migrations
yarn migration:run

# Revert last migration
yarn migration:revert
```

## Repository Usage

### OrderRepository

```typescript
import { OrderRepository } from '@repositories/order.repository';

// Create order with inventory update (transaction)
const order = await orderRepository.create({
  customerId: 'customer-uuid',
  subtotal: 1000,
  total: 1050,
  paymentMethod: PaymentMethod.PROMPTPAY,
  shippingAddress: {/* address data */},
  items: [
    {
      storeId: 'store-uuid',
      variantId: 'variant-uuid',
      productName: 'Product Name',
      variantOptions: { size: 'M', color: 'Red' },
      unitPrice: 500,
      quantity: 2,
    },
  ],
});

// Find orders by customer
const orders = await orderRepository.findByCustomer(
  'customer-uuid',
  { status: OrderStatus.DELIVERED },
  20,
  0,
);

// Update order status
await orderRepository.updateStatus(
  'order-uuid',
  OrderStatus.SHIPPED,
  'user-uuid',
  'Shipped via Kerry Express',
);
```

### ProductRepository

```typescript
import { ProductRepository } from '@repositories/product.repository';

// Find products by store with optional filters
const products = await productRepository.findByStore(
  'store-uuid',
  { category: 'pet-food', minPrice: 100, maxPrice: 500 },
  20,
  0,
);

// Update inventory with transaction
await productRepository.updateInventory(
  'variant-uuid',
  10, // quantity change
  InventoryTransactionType.PURCHASE,
  'purchase-order-uuid',
  'purchase_order',
  'user-uuid',
  'Received shipment from supplier',
);
```

### StoreRepository

```typescript
import { StoreRepository } from '@repositories/store.repository';

// Find stores pending approval
const pendingStores = await storeRepository.findPendingApproval();

// Approve store
await storeRepository.approve('store-uuid', 'admin-uuid');

// Reject store
await storeRepository.reject('store-uuid', 'admin-uuid', 'Incomplete business documents');
```

### PromotionRepository

```typescript
import { PromotionRepository } from '@repositories/promotion.repository';

// Validate promotion code
const result = await promotionRepository.validate(
  'WELCOME10',
  1000, // cart total
  'customer-uuid',
);

if (result.valid) {
  const discount = await promotionRepository.calculateDiscount(result.promotion, 1000);

  // Record usage after order creation
  await promotionRepository.recordUsage(result.promotion.id, 'order-uuid', discount);
}
```

## Key Features

### 1. Soft Deletes

All major entities support soft deletes:

```typescript
// Soft delete (sets deleted_at)
await productRepository.softDelete('product-uuid');

// Queries automatically exclude soft-deleted records
const product = await productRepository.findById('product-uuid'); // null if soft-deleted
```

### 2. Full-Text Search

Products have automatic full-text search indexing:

```typescript
// Search is automatically triggered on insert/update
const product = await productRepository.create({
  storeId: 'store-uuid',
  name: 'อาหารสุนัข Royal Canin',
  description: 'อาหารสุนัขคุณภาพสูง',
  basePrice: 500,
});

// Inventory updates use transactions (see updateInventory below)
```

### 3. Transaction Management

Critical operations use database transactions:

```typescript
// Order creation updates inventory atomically
const order = await orderRepository.create({
  // If any step fails, entire transaction rolls back:
  // 1. Create order
  // 2. Create order items
  // 3. Decrement inventory
  // 4. Create inventory transactions
  // 5. Create status history
});
```

### 4. Indexing Strategy

Optimized indexes for common queries:

- Unique indexes with soft delete support
- Composite indexes for filtered queries
- GIN indexes for JSONB and array columns
- Partial indexes for active records only

## Migration Management

### Generate Migration

```bash
# After entity changes
yarn migration:generate src/database/migrations/MyMigration
```

### Create Empty Migration

```bash
yarn migration:create src/database/migrations/MyMigration
```

### Migration Commands

```bash
# Run migrations
yarn migration:run

# Revert last migration
yarn migration:revert

# Show migration status
yarn typeorm migration:show -d ormconfig.ts
```

## Performance Considerations

### Connection Pooling

Configured for 20 max connections with automatic cleanup:

```typescript
// In database.module.ts
extra: {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
}
```

### Query Optimization

- Use `relations` for eager loading
- Avoid N+1 queries with proper joins
- Limit result sets with pagination
- Use covering indexes where possible

### Caching Strategy

Recommended Redis caching:

- Product catalog: 15min TTL
- Promotion rules: 5min TTL
- Store data: 30min TTL
- User sessions: 30min sliding expiration

## Testing

```bash
# Run unit tests
yarn test

# Run with coverage
yarn test:cov

# Run specific test file
yarn test user.repository.spec.ts
```

## Security

- Passwords hashed with bcrypt (cost 12)
- SQL injection prevention via parameterized queries
- Input validation with class-validator decorators
- Audit trails for admin actions
- Row-level security enforced in repositories

## Next Steps

1. **Install dependencies**: `yarn install`
2. **Configure database**: Update `.env` file
3. **Run migrations**: `yarn migration:run`
4. **Seed data** (optional): Create seed scripts for development
5. **Build services**: Implement business logic using repositories
6. **Add caching**: Integrate Redis for performance
7. **Set up monitoring**: Track slow queries and connection pool

## Support

For issues or questions about the database layer, refer to:

- [Backend README](../../README.md)
- [Workspace design docs](../../../new-sopet-workspace/docs/design/)
