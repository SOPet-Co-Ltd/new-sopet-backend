// Public Order Tracking [integration] Test Skeleton - Design Doc: order-tracking-backend.md
// Frontend Design Doc: order-tracking-frontend.md | UI Spec: order-tracking-page.md | PRD: order-tracking-page.md
// Generated: 2026-07-11 | Budget Used (feature): integration 3/3 (this file 2/3; storefront hook 1/3), fixture-e2e n/a (backend), service-e2e 0/2
//
// Implement target: test/order-tracking.e2e-spec.ts
// (Promote comment-only skeleton to `.e2e-spec.ts` under `test/jest-e2e.json`, mirroring
// test/product-sold-count-batching.int.test.ts → test/product-sold-count-batching.e2e-spec.ts.)
//
// Covers:
//   src/modules/orders/orders.resolver.ts (orderTracking query + @Public())
//   src/modules/orders/orders.service.ts (findByOrderNumber)
//   src/modules/orders/order.mapper.ts (mapOrderTracking, resolveOrderItemImageUrl)
//   src/graphql/models/types.ts (OrderTrackingType family)
//
// Harness: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST; seeded PostgreSQL
// test database with orders, order_items, order_store_shippings, product_variants, product_images.
//
// Test Boundaries compliance (Backend Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (orders, order_items, order_store_shippings, product_variants, product_images)
// @real-dependency: mapOrderTracking (real mapper in resolver path — not mocked)
// Mock: none on hot path — prefer seeded order row over mocked orderRepository
//
// Skipped ACs (covered elsewhere):
//   @Public() reflection metadata → orders.resolver.spec.ts unit test (payments.resolver.spec.ts pattern)
//   mapOrder not invoked → orders.resolver.spec.ts unit test [IMPLEMENTATION_DETAIL]
//   GraphQL schema PII field absence → schema.gql contract + codegen; introspection optional in CI
//   Storefront error UI routing → useOrderTracking.int.test.skeleton.ts + order-tracking.fixture.e2e.test.skeleton.tsx
//
// ---------------------------------------------------------------------------
// AC (Public GraphQL API): "WHEN `orderTracking(orderNumber)` is called without JWT and
// `orderNumber` matches an existing order, the system shall return `OrderTrackingType`
// containing only fields defined in the Data Contracts section and shall not include
// `shippingAddress`, `guestPhone`, `guestName`, `guestEmail`, or `customerId`."
// AC (Data completeness): "WHEN an order has line items with `productVariant.product.images`,
// the system shall populate `productImageUrl` on each `OrderTrackingItemType` using the same
// resolution logic as `resolveOrderItemImageUrl`."
// AC (Data completeness): "WHEN an order has `storeShippings` rows, the system shall return
// `optionName` and `shippingFee` per store on `OrderTrackingStoreShippingType`."
// AC (Data completeness): "WHEN line items have fulfillment data, the system shall return
// `trackingNumber`, `fulfillmentProvider`, `trackingUrl`, and `fulfillmentStatus` on each item."
// AC (Authorization): "WHEN `orderTracking` is inspected via reflection metadata, the system
// shall have `@Public()` set" — exercised here as behavioral proof: query succeeds without JWT.
// ROI: 100 (BV:10 × Freq:9 + Legal:0 + Defect:10)
// Behavior: unauthenticated GraphQL `orderTracking(orderNumber: <seeded>)` returns allowlisted
// fields with correct monetary aggregates, items (image URL resolved), storeShippings, and
// fulfillment metadata; response object and GraphQL data contain zero PII keys even when seeded
// entity row includes shippingAddress and guest* columns.
// @category: core-functionality
// @lane: integration
// @dependency: real GraphQLModule + OrdersResolver + OrdersService + mapOrderTracking, real PostgreSQL test DB (order with images + storeShippings + fulfillment)
// @complexity: high
// Primary failure mode: mapOrder or OrderType reused leaking PII; productImageUrl null from missing
// relations; storeShippings or fulfillment fields dropped in mapper.
// Proof obligation: seed order with known orderNumber, guestPhone/shippingAddress on DB row,
// items linked to variant with product.images, storeShippings rows, and fulfillment fields;
// POST GraphQL without Authorization header; assert HTTP 200 with orderTracking payload matching
// expected literals for totals and item fields; assert response JSON string does not contain
// guestPhone, guestName, guestEmail, shippingAddress, customerId, paymentReference, or internal
// order id; assert items[0].productImageUrl equals independently computed URL from seeded image.
// Boundary path: entity carries PII in DB but public mapper path must exclude it (privacy boundary).
// Verification points / expected results / pass criteria:
//   - Query succeeds without Authorization header.
//   - orderNumber, status, createdAt, subtotal, shippingFee, discountAmount, total match seed.
//   - items include productName, quantity, unitPrice, subtotal, fulfillment fields when seeded.
//   - storeShippings include optionName and shippingFee per store.
//   - No PII keys anywhere in GraphQL data payload.
//   - Fail if mapOrder path used, PII present, or productImageUrl null when images seeded.
//
// ---------------------------------------------------------------------------
// AC (Public GraphQL API): "WHEN `orderTracking(orderNumber)` is called with an unknown
// `orderNumber`, the system shall throw `NotFoundException` with `code: 'ORDER_NOT_FOUND'` and
// shall return no order data in the GraphQL response."
// AC (Public GraphQL API): "WHEN `orderTracking(orderNumber)` is called with a malformed or empty
// `orderNumber` string that does not match any row, the system shall return the same
// `ORDER_NOT_FOUND` error as for a well-formed but missing number (no distinct error code for
// format validation)."
// ROI: 80 (BV:9 × Freq:8 + Legal:0 + Defect:8)
// Behavior: unauthenticated `orderTracking` for non-existent well-formed number, garbage string,
// and whitespace-only trimmed input all return GraphQL error with extensions.code ORDER_NOT_FOUND
// and null orderTracking data — identical error shape across cases (anti-enumeration at API).
// @category: core-functionality
// @lane: integration
// @dependency: real GraphQLModule + OrdersResolver + OrdersService, real PostgreSQL test DB (no matching rows for lookup keys)
// @complexity: medium
// Primary failure mode: distinct error codes for malformed vs missing; empty array instead of
// error; or order data leaked alongside error.
// Proof obligation: issue three GraphQL calls without JWT: (1) `ORD-NOTEXIST-XXXX`, (2) `!!!garbage`,
// (3) `   ` (whitespace trimmed to empty lookup); assert each returns errors[0].extensions.code
// === 'ORDER_NOT_FOUND'; assert data.orderTracking is null/undefined; assert error messages do
// not differ in a way that reveals format vs existence.
// Boundary path: malformed and empty inputs must hit same not-found branch as unknown well-formed number.
// Verification points / expected results / pass criteria:
//   - extensions.code is ORDER_NOT_FOUND for all three inputs.
//   - No orderTracking data in response body.
//   - No distinct validation error code for malformed strings.
//   - Fail if 200 success, different codes, or hint text distinguishing format from existence.
