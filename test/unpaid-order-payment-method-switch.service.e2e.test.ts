// Unpaid Order Payment Method Switch [service-integration-e2e] Test Skeleton
// Design Doc: unpaid-order-payment-method-switch-backend-design.md
// PRD: unpaid-order-payment-method-switch-prd.md | UI Spec: unpaid-order-payment-method-switch-ui-spec.md
// Generated: 2026-07-19 | Budget Used (feature): integration 3/3, fixture-e2e 3/3 (storefront), service-e2e 2/2 (this file)
//
// Implement target: test/unpaid-order-payment-method-switch.service.e2e-spec.ts
// (Promote skeleton to `.e2e-spec.ts` under test/jest-e2e.json with real local Postgres +
// Nest app; Omise HTTP stubbed/mocked — not live Omise.)
//
// Reserved slot: unpaid switch journey whose correctness requires real DB persistence
// (new payment row, order.paymentMethod, omise_charge_id, paymentReference move/clear) that
// fixture-level / mocked-repo integration cannot fully prove end-to-end through GraphQL.
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// @real-dependency: PostgreSQL (orders, payments, inventory stock restore for 24h case)
// @real-dependency: GraphQL createPayment → PaymentsResolver → createCharge hot path
// Mock: Omise HTTP (fetch / nock) for expire + create — never live Omise in CI
// Mock: Clock injectable / jest fake timers for 24h eligibility
//
// ---------------------------------------------------------------------------
// Journey 1 (RESERVED service-integration-e2e): GraphQL createPayment supersede persists
// ---------------------------------------------------------------------------
//
// Journey AC: Mid-QR / unpaid switch via existing createPayment → cancel-best-effort →
// local supersede → NEW paymentId persisted with omise_charge_id + order.paymentMethod sync
// (prd AC-003–AC-012, AC-014; storefront resolveNewPaymentId contract)
// Screen / API transition: GraphQL createPayment(orderId, promptpay|credit_card) against
// seeded PENDING_PAYMENT order with prior pending PromptPay payment → HTTP 200 with new
// payment id → DB rows reflect supersede
// ROI: 98 (BV:10 × Freq:9 + Legal:0 + Defect:8) — RESERVED (real DB write + field sync)
// Behavior: Seed order pending_payment + pending PromptPay with known charge id; stub Omise
// expire ok + create new charge; POST GraphQL createPayment same order PromptPay (or card);
// assert response paymentId ≠ prior; DB: prior payment status failed; new payment row with
// omise_charge_id; order.payment_method matches; order.payment_reference = new charge id
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (local Nest + real Postgres), GraphQL createPayment, Omise HTTP stub
// @complexity: high
// Primary failure mode: GraphQL returns new id but DB retains soft-resumed prior row / missing
// omise_charge_id / stale order.paymentMethod — storefront navigates while admin labels wrong
// Proof obligation: Against real test DB — (1) seed unpaid order + pending PromptPay payment;
// (2) stub Omise expire + create; (3) authenticated/guest-owned createPayment; (4) assert GraphQL
// payload new id; (5) query payments/orders tables for prior.failed, new.omise_charge_id,
// order.payment_method, payment_reference. Boundary: PromptPay→PromptPay restart must mint new
// row (no soft-resume). Fail-open variant optional same suite: stub expire 4xx still persists new row.
// Verification points / expected results / pass criteria:
//   - GraphQL success with paymentId !== prior payment id.
//   - DB prior payment status failed; at most one active pending payment for order.
//   - New payment.omise_charge_id and order.payment_method/payment_reference consistent.
//   - Fail if soft-resume same id or DB fields diverge from GraphQL payload.
//
// ---------------------------------------------------------------------------
// Journey 2 (additional ROI > 50): 24h unpaid auto-cancel + stock restore
// ---------------------------------------------------------------------------
//
// AC (24h unpaid): "When an order remains pending_payment with no paid payment and
// order.createdAt is older than 24 hours, then the unpaid job shall cancel the order and
// restore stock using the same transactional pattern as finalizeExpiredPayment"
// AC (paid skip): "Given an order that becomes paid before 24 hours, when the job evaluates
// it, then it is not auto-cancelled"
// AC (QR coexistence note): "While QR ~15m expiry remains enabled, the 24h job shall not
// replace it" — asserted as separate job/path existence, not replacing finalizeExpiredPayment
// PRD: AC-019–AC-021
// ROI: 56 (BV:8 × Freq:6 + Legal:0 + Defect:8) — additional service-e2e (ROI > 50)
// Behavior: Seed PENDING_PAYMENT order createdAt = now-25h with unpaid payments + reserved
// stock; run cancelStaleUnpaidOrders / scheduler tick with frozen clock; assert order CANCELLED
// and InventoryService.restoreOrderStock (real inventory rows) applied once; seed sibling paid
// or young unpaid order → job skips; re-run idempotent on already CANCELLED
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (Postgres + unpaid job / PaymentExpiryScheduler sibling), Inventory stock rows
// @complexity: high
// Primary failure mode: job no-ops leaving stale unpaid orders; cancels paid orders; double
// stock restore; or replaces/disables QR finalizeExpiredPayment path
// Proof obligation: Real DB seed for stale unpaid + in-window unpaid + paid; invoke job once;
// assert only stale unpaid cancelled with stock qty restored; paid/young untouched; second tick
// idempotent; QR finalizeExpiredPayment still callable for pending PromptPay past expiresAt on
// a separate fixture (coexistence AC-020). Mock Omise if finalize touches provider; do not mock
// order/payment persistence.
// Verification points / expected results / pass criteria:
//   - Stale unpaid → CANCELLED + stock restored once.
//   - Paid / <24h unpaid → not cancelled by this job.
//   - Idempotent on re-run; QR ~15m path still independently functional.
//   - Fail if inventory unrestored, paid cancelled, or QR path removed.
