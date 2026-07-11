export { isPostgresAvailable } from './postgres-availability';
export { createTypeOrmTestOptions } from './typeorm-test.config';
export {
  cleanupSeedRun,
  createSeedRunContext,
  createTestCategory,
  createTestProduct,
  createTestStore,
  createTestTag,
  createTestUser,
  seedListingParityDataset,
  seedRejectedTaxonomyDataset,
} from './seed-factories';
export type {
  ListingParitySeedDataset,
  RejectedTaxonomySeedDataset,
  SeedRunContext,
} from './seed-factories';
export {
  closeSearchTaxonomyGraphqlE2eHarness,
  createSearchTaxonomyGraphqlE2eHarness,
} from './graphql-e2e-harness';
export type { SearchTaxonomyGraphqlE2eHarness } from './graphql-e2e-harness';

/**
 * Promotion path (`.int.test.ts` → `.e2e-spec.ts`):
 * 1. Implement AC assertions in the comment skeleton under `test/*.int.test.ts`.
 * 2. Import helpers from `test/helpers` (`createSearchTaxonomyGraphqlE2eHarness`, seed factories).
 * 3. Rename the file to `test/<name>.e2e-spec.ts` — picked up by `test/jest-e2e.json` (`testRegex: ".e2e-spec.ts$"`).
 * 4. Mirror `test/order-tracking.int.test.ts` → `test/order-tracking.e2e-spec.ts` (promoted harness block).
 * 5. Run locally: `yarn test:e2e --testPathPattern=<name>.e2e-spec.ts` (requires PostgreSQL; CI uses mocked suites only).
 */
