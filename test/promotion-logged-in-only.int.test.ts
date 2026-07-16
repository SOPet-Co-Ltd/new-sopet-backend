// Promotion Logged-In Only integration Test
// Design Doc: promotion-logged-in-only-backend-design.md
// PRD: promotion-logged-in-only-prd.md (FR-1, FR-2, FR-3, FR-5; AC-001–AC-014, AC-018, AC-021)
// Parent pattern: test/promotion-universal-conditions.int.test.ts (case-1 new-customer)
// Generated: 2026-07-16 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// Comment-only skeleton — implement alongside evaluateLoggedInOnlyGate + assertValidConditions.
// Run target (when executable):
//   yarn jest --config ./test/jest-e2e.json --testRegex='promotion-logged-in-only.int.test.ts$' --no-coverage
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Promotion / Usage / Customer / Order / Product repositories
// @real-dependency: none (in-process PromotionsService + mocked repos)
// Note: loggedInOnly gate itself needs no Customer/Order queries; keep Customer/Order mocks
// for composition cases that also enable newCustomer.
//
// ---------------------------------------------------------------------------
// Integration test 1 of 3 — Guest soft GUEST / hard GUEST for loggedInOnly-only
// ---------------------------------------------------------------------------
//
// AC-003 / AC-018: "When a guest (no customerId) evaluates a loggedInOnly.enabled === true
// promotion in preview, then discountAmount=0 and ineligibilityReason=GUEST."
// AC-005: "When createOrder / apply mode evaluates the same guest case, then the system
// hard-throws GUEST and the promotion does not discount."
// AC-002 / AC-014 (boundary): "If loggedInOnly is absent or enabled !== true, then evaluation
// skips this gate."
// ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
// Behavior: Guest identity + promo with only loggedInOnly:{enabled:true} → preview soft GUEST;
// apply hard-throws GUEST via resolveEligibilityFailure; absent / enabled!==true → no GUEST
// from this gate
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validateCode, evaluateLoggedInOnlyGate,
// resolveEligibilityFailure (mocked repos)
// @complexity: medium
// Primary failure mode: guest preview returns positive discount; apply does not throw GUEST;
// or a new reason code is invented instead of reusing GUEST
// Proof obligation: in-process validateCode with promotion.conditions =
// { loggedInOnly: { enabled: true } } and customer undefined → preview
// { discountAmount: 0, ineligibilityReason: 'GUEST' }; apply rejects with
// { response: { code: 'GUEST' } }. Boundary path: same fixtures with key absent or
// enabled:false → gate off (no GUEST from loggedInOnly). Do not fold into
// evaluateNewCustomerGates. Mock repos only; no live DB.
// Verification points / expected results / pass criteria:
// - Preview guest + loggedInOnly on: discountAmount=0, freeUnits=0, ineligibilityReason=GUEST
// - Apply guest + loggedInOnly on: BadRequestException code GUEST
// - Absent loggedInOnly: guest may be eligible on this gate (subject to other rules)
// - enabled !== true (e.g. false / missing enabled): gate off for guest
// - No Customer/Order repository calls for loggedInOnly-only evaluation
//
// ---------------------------------------------------------------------------
// Integration test 2 of 3 — Returning authenticated customer eligible when only loggedInOnly
// ---------------------------------------------------------------------------
//
// AC-006: "When a logged-in customer has prior paid-path orders and/or age beyond any N, and
// only loggedInOnly is enabled (not newCustomer), and other promo rules pass, then the
// customer may be eligible."
// AC-007: "When a logged-in customer has no paid-path orders and a young account, and only
// loggedInOnly is enabled, then they remain eligible on this gate."
// Security boundary: guestPhone-only identity must NOT satisfy the gate (Design Doc § Algorithms).
// ROI: 89 (BV:10 × Freq:8 + Legal:0 + Defect:9)
// Behavior: customerId present + only loggedInOnly on → pass gate and type math (discount > 0);
// paid-path / old-account fixtures still eligible when newCustomer is off; guestPhone-only → GUEST
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validateCode, evaluateLoggedInOnlyGate (mocked repos)
// @complexity: medium
// Primary failure mode: returning member blocked by order-history/account-age because
// loggedInOnly was folded into evaluateNewCustomerGates; or guestPhone treated as authenticated
// Proof obligation: percentage promo with only loggedInOnly:{enabled:true}; customerId of
// paid-path / old-account fixture → preview discountAmount > 0 and ineligibilityReason null;
// young new customerId also eligible on this gate. Boundary: identity { guestPhone } without
// customerId + mode apply → throws GUEST. Assert Customer/Order query builders are NOT
// invoked for loggedInOnly-only path. Mock repos only.
// Verification points / expected results / pass criteria:
// - Returning paid-path customerId + only loggedInOnly: discount applies (e.g. 10% of 1000 = 100)
// - Young / zero paid-path customerId + only loggedInOnly: discount applies
// - guestPhone-only + loggedInOnly on + apply: throws GUEST
// - Order/Customer repos unused when newCustomer key absent
//
// ---------------------------------------------------------------------------
// Integration test 3 of 3 — Composition with newCustomer + Rule L5 write normalize
// ---------------------------------------------------------------------------
//
// AC-010: "When only newCustomer.enabled === true (no loggedInOnly), then a guest is ineligible
// via existing new-customer GUEST path without requiring loggedInOnly."
// AC-011: "When both keys are enabled, then a guest fails with GUEST."
// AC-012: "When both keys are enabled and a logged-in customer fails order-history or
// account-age, then existing new-customer reasons apply; when they pass both new-customer
// gates and other rules, they may be eligible."
// AC-001 / AC-013 / Rule L5: "When create/update persists loggedInOnly ON, then conditions
// include exactly loggedInOnly:{enabled:true} (unknown nested keys stripped)."
// Write: non-plain-object loggedInOnly → INVALID_LOGGED_IN_ONLY_CONDITIONS.
// ROI: 72 (BV:9 × Freq:7 + Legal:0 + Defect:9)
// Behavior: AND composition; newCustomer-only regression; write normalize / reject shape
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validateCode, evaluateLoggedInOnlyGate,
// evaluateNewCustomerGates, assertValidConditions, create (mocked repos)
// @complexity: high
// Primary failure mode: both-on guest gets a new reason; paid-path logged-in with both on
// skips ORDER_HISTORY; write keeps unknown nested keys under loggedInOnly; newCustomer-only
// guest path regresses
// Proof obligation: (1) newCustomer-only guest → GUEST without loggedInOnly key (AC-010
// regression vs case-1); (2) both keys on + guest → GUEST; (3) both keys on + paid-path
// customerId → ORDER_HISTORY (not silent pass); (4) both on + eligible new customer →
// discount > 0; (5) create with loggedInOnly:{enabled:true, extra:'x'} → persisted exactly
// { enabled: true }; (6) create with loggedInOnly:null/array → INVALID_LOGGED_IN_ONLY_CONDITIONS
// and save not called. Evaluation order: loggedInOnly before newCustomer (short-circuit guests).
// Boundary: write validation vs evaluate path; composition AND.
// Verification points / expected results / pass criteria:
// - newCustomer-only guest: soft/hard GUEST unchanged
// - both on + guest: GUEST (preview soft / apply hard)
// - both on + paid-path: ORDER_HISTORY soft/hard
// - both on + eligible new customer: discount applies
// - Rule L5 write: ON normalizes to exactly { enabled: true }; OFF omit key on admin create
// - INVALID_LOGGED_IN_ONLY_CONDITIONS when loggedInOnly present but not a plain object
