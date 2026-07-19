// Unpaid Order Payment Method Switch [integration] Test Skeleton
// Design Doc: unpaid-order-payment-method-switch-backend-design.md
// Frontend Design Doc: unpaid-order-payment-method-switch-frontend-design.md (consumer contracts)
// UI Spec: unpaid-order-payment-method-switch-ui-spec.md | PRD: unpaid-order-payment-method-switch-prd.md
// Generated: 2026-07-19 | Budget Used (feature): integration 3/3 (this file), fixture-e2e 3/3 (storefront), service-e2e 2/2 (see unpaid-order-payment-method-switch.service.e2e.test.ts)
//
// Implement target: promote this comment-only skeleton to executable Jest cases
// (PaymentsService.createCharge in-process; mirror payments.service.spec.ts supersede suite).
// Run (when implemented):
//   yarn jest --config ./test/jest-e2e.json --testRegex='unpaid-order-payment-method-switch.int.test.ts$' --no-coverage
// Alternative colocated transform: extend src/modules/payments/payments.service.spec.ts
// Executable Supersede/Retry Rule describe — invert “PromptPay pending resume → same id”
// and “does not call Omise reverse” assertions per backend Design Doc.
//
// Covers (priority ACs):
//   Always-new paymentId (PromptPay restart) + cancel-before-create attempt
//   Fail-open cancel still creates
//   ORDER_NOT_PAYABLE eligibility (incl. COD)
//   order.paymentMethod sync + payments.omise_charge_id
//   COD clears order.paymentReference + orphan webhook residual
//
// Harness: Nest TestingModule + PaymentsService; mocked TypeORM repos; mocked global.fetch (Omise)
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Omise HTTP (fetch) — expire/timeout/create matrix
// Mock: TypeORM Payment/Order repositories (existing payments.service.spec pattern)
// Mock: InventoryService (assert NOT called on supersede; only on finalize/24h — 24h in service-e2e)
// Mock: Clock — not required in this file (24h job is service-e2e)
// @real-dependency: PaymentsService.createCharge / cancelOmiseChargeBestEffort / handleWebhook logic
//
// Dedup / push-down notes:
//   Existing payments.service.spec.ts supersede suite covers card→new token local supersede and
//   late unmatched webhook — transform those cases; do not duplicate identical assertions.
//   PromptPay soft-resume same-id test MUST be inverted (AC-005 / BE-UPMS-001).
//   GraphQL schema absence of changePaymentMethod → [IMPLEMENTATION_DETAIL] skipped.
//   Concurrency ≤1 pending (AC-023) → lower ROI / complex lock timing; covered conceptually in
//   service-e2e reserved journey re-check under FOR UPDATE; not in this budget.
//   24h unpaid cancel → service-e2e (real stock restore).
//
// Skipped ACs (reason):
//   AC-009 no changePaymentMethod mutation → [IMPLEMENTATION_DETAIL] schema grep / static
//   AC-020 QR ~15m coexistence → asserted as non-replacement note inside 24h service-e2e
//   AC-022 ops alert fields → covered inside fail-open warn assertion (INT-2)
//
// ---------------------------------------------------------------------------
// Integration 1 of 3 — Always-new PromptPay restart + cancel attempt + field sync
// ---------------------------------------------------------------------------
//
// AC (Switch matrix / always-new id): "When eligible and client requests any unpaid method
// (PromptPay / credit_card / COD) including same-method PromptPay restart or new card token,
// then the system shall create a new Payment row and return a new paymentId"
// AC (While PromptPay pending): "While a prior PromptPay payment is still pending, when
// createCharge is called with PromptPay again, the system shall not early-return the prior payment"
// AC (Cancel-before-create): "When a prior unpaid Omise-backed pending payment has a usable
// charge id, then before local supersede completes, the system shall attempt Omise cleanup
// within 4000 ms"
// AC (Persist): "When Omise returns a charge id on create, then payments.omise_charge_id shall
// be persisted"
// AC (Sync): "When a new payment is created, then order.paymentMethod shall equal the new
// payment’s method"
// PRD: unpaid-order-payment-method-switch-prd.md AC-003–AC-008, AC-012, AC-014–AC-015
// ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
// Behavior: createCharge(PromptPay) with prior pending PromptPay → Phase A expire (or reverse)
// attempt → Phase B prior.status=failed → NEW paymentId ≠ prior.id → payment.omiseChargeId and
// order.paymentReference = new charge id → order.paymentMethod = promptpay → no stock restore
// @category: core-functionality
// @lane: integration
// @dependency: PaymentsService.createCharge, cancelOmiseChargeBestEffort, Payment/Order repos (mocked), Omise fetch (mocked)
// @complexity: high
// Primary failure mode: PromptPay soft-resume returns same paymentId; cancel never attempted;
// omise_charge_id not written; order.paymentMethod stale after switch
// Proof obligation: Fixture prior PromptPay pending with omiseChargeId (or single-pending +
// order.paymentReference); mock fetch expire 2xx then create charge with new id; call createCharge
// PromptPay again; assert result.paymentId !== prior.id; prior.status === 'failed'; fetch URLs
// include /charges/{oldId}/expire (or documented cleanup path) AND a new POST /charges; saved
// payment.omiseChargeId === new charge id; order.paymentMethod === 'promptpay';
// inventoryService.restoreOrderStock not called. Boundary path: mid-QR same-method restart must
// not take soft-resume early-return (invert payments.service.spec “PromptPay pending resume”).
// Mock only Omise HTTP + repos; exercise real createCharge supersede path.
// Verification points / expected results / pass criteria:
//   - New paymentId distinct from prior pending id.
//   - Prior pending marked failed; paymentStatusUpdated published for prior.
//   - Omise cleanup attempted for resolved prior charge id within fail-open contract.
//   - New Omise create invoked; omise_charge_id + paymentReference + paymentMethod synced.
//   - Fail if same id returned, cleanup never attempted when charge id resolvable, or fields unsynced.
//
// ---------------------------------------------------------------------------
// Integration 2 of 3 — Cancel-before-create fail-open still creates
// ---------------------------------------------------------------------------
//
// AC (Fail-open): "If cleanup fails, is unsupported, or exceeds 4000 ms, then the system shall
// still local-supersede, create the new payment/charge, and emit ops warn/alert with order id,
// prior payment id, and prior charge id"
// AC (Customer continuity consumer): storefront still receives successful new-payment path
// (prd AC-010, AC-011, AC-022)
// ROI: 89 (BV:10 × Freq:8 + Legal:0 + Defect:9)
// Behavior: Prior pending Omise payment with charge id → mock expire throw / 4xx / AbortTimeout
// → createCharge(card|PromptPay) still returns NEW paymentId → prior failed → warn logged with
// { orderId, paymentId, omiseChargeId, reason } → client success (no throw solely for cancel)
// @category: edge-case
// @lane: integration
// @dependency: PaymentsService.createCharge, cancelOmiseChargeBestEffort, logger.warn, Omise fetch (mocked)
// @complexity: high
// Primary failure mode: cancel failure hard-blocks createCharge for the customer; or fail-open
// creates without ops warn (orphan undetectable)
// Proof obligation: Three cancel-failure classes (HTTP 4xx unsupported, network throw, timeout
// past omiseCancelTimeoutMs/4000ms) each still yield successful create + new paymentId; assert
// logger.warn / structured alert includes orderId + prior paymentId + prior charge id; assert
// createCharge does not throw BadRequest solely due to cancel failure. Boundary path: card
// expire/reverse unsupported is primary fail-open (I004) — treat unsupported as success path
// for customer create, not product defect.
// Verification points / expected results / pass criteria:
//   - New payment created after each fail-open class.
//   - Ops warn/alert identifiable for reconciliation (AC-022).
//   - Fail if any cancel-failure class rejects the customer create solely for cancel.
//
// ---------------------------------------------------------------------------
// Integration 3 of 3 — ORDER_NOT_PAYABLE + Omise→COD clears paymentReference + orphan webhook
// ---------------------------------------------------------------------------
//
// AC (Eligibility reject): "If order is not pending_payment or the latest payment is
// paid / refunded (not pending/failed), then the system shall reject with ORDER_NOT_PAYABLE
// (or equivalent coded BadRequest) and create no new payment — including COD"
// AC (COD clear): "When the new payment is COD (including after superseding Omise-backed
// payments), then order.paymentReference shall be null/cleared"
// AC (Webhook residual): "When Omise→COD succeeds, then order.paymentReference shall be null
// so a late webhook for a prior Omise charge id cannot match and invent paid — order remains
// PENDING_PAYMENT"
// PRD: AC-001–AC-002; backend Design Doc COD + webhook residual
// ROI: 95 (BV:10 × Freq:8 + Legal:0 + Defect:9)
// Behavior: (A) paid order or latest payment paid → createCharge COD/Omise throws ORDER_NOT_PAYABLE,
// no new payment row; (B) eligible Omise pending → createCharge COD → new COD payment →
// order.paymentMethod=cod → order.paymentReference=null → handleWebhook(prior chrg_…) warns +
// returns without marking PAID
// @category: core-functionality
// @lane: integration
// @dependency: PaymentsService.createCharge, handleWebhook, Payment/Order repos (mocked), Omise fetch (mocked)
// @complexity: high
// Primary failure mode: COD skips eligibility (BE-UPMS-008 hole); Omise→COD leaves stale
// paymentReference so orphan webhook invents paid
// Proof obligation: (1) order status PAID or latest payment paid → createCharge with COD and
// with PromptPay both throw BadRequestException({ code: 'ORDER_NOT_PAYABLE' }); paymentRepository.create
// not used for a new row. (2) pending PromptPay with charge id → createCharge COD → prior failed;
// order.paymentReference === null; order.paymentMethod === 'cod'; payment.omiseChargeId absent/null.
// (3) handleWebhook charge.complete for prior chrg_… with paymentReference already null → warn +
// return; order.status remains PENDING_PAYMENT. Boundary path: COD branch must share eligibility
// gate with Omise (hoist before COD early path).
// Verification points / expected results / pass criteria:
//   - Ineligible paths: coded ORDER_NOT_PAYABLE; zero new payments.
//   - Omise→COD: paymentReference cleared; method synced to COD.
//   - Orphan webhook never marks paid after COD clear.
//   - Fail if COD succeeds on non-pending_payment or webhook invents paid via stale reference.
