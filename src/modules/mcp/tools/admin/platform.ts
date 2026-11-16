import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

export const adminPlatformTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'admin_list_pending_imported_reviews',
    description: 'List imported reviews awaiting moderation.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query PendingImportedReviews($page: Int, $limit: Int) {
        pendingImportedReviews(page: $page, limit: $limit) {
          items { id rating status comment productId productName source createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'pendingImportedReviews',
  }),
  gqlTool({
    name: 'admin_approve_review',
    description: 'Approve a review.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveReview(id: $id) { id status } }`,
    pick: 'approveReview',
  }),
  gqlTool({
    name: 'admin_reject_review',
    description: 'Reject a review.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { rejectReview(id: $id) { id status } }`,
    pick: 'rejectReview',
  }),
  gqlTool({
    name: 'admin_list_pending_manual_payouts',
    description: 'List pending manual payouts awaiting admin settlement.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query PendingManualPayouts($page: Int, $limit: Int) {
        pendingManualPayouts(page: $page, limit: $limit) {
          items { id storeId amount status createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'pendingManualPayouts',
  }),
  gqlTool({
    name: 'admin_settle_manual_payout',
    description: 'Settle (pay) a pending manual payout. Moves money state.',
    role: 'admin',
    writes: true,
    inputSchema: {
      storeId: z.string().uuid(),
      payoutId: z.string().uuid().optional(),
      notes: z.string().optional(),
    },
    query: `
      mutation SettleManualPayout($input: SettleManualPayoutInput!) {
        settleManualPayout(input: $input) { id status amount }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'settleManualPayout',
  }),
  gqlTool({
    name: 'admin_reject_manual_payout',
    description: 'Reject a pending manual payout.',
    role: 'admin',
    writes: true,
    inputSchema: {
      storeId: z.string().uuid(),
      payoutId: z.string().uuid().optional(),
      notes: z.string().optional(),
    },
    query: `
      mutation RejectManualPayout($input: RejectManualPayoutInput!) {
        rejectManualPayout(input: $input) { id status }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'rejectManualPayout',
  }),
  gqlTool({
    name: 'admin_get_store_payout_summary',
    description: 'Get payout summary for a store.',
    role: 'admin',
    inputSchema: { storeId: z.string().uuid() },
    query: `
      query AdminStorePayoutSummary($storeId: String!) {
        adminStorePayoutSummary(storeId: $storeId) {
          storeId availableBalance pendingPayoutAmount totalPaidOut canRequestPayout
        }
      }
    `,
    pick: 'adminStorePayoutSummary',
  }),
  gqlTool({
    name: 'admin_list_promotions',
    description: 'List platform promotions.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query PlatformPromotions($page: Int, $limit: Int) {
        platformPromotions(page: $page, limit: $limit) {
          items { id name type isActive startsAt endsAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'platformPromotions',
  }),
  gqlTool({
    name: 'admin_create_promotion',
    description:
      'Create a promotion. Omit storeId for platform scope; set storeId for a store-scoped promo.',
    role: 'admin',
    writes: true,
    inputSchema: {
      name: z.string(),
      code: z.string(),
      type: z.string(),
      discountValue: z.number(),
      storeId: z.string().uuid().optional(),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
      isActive: z.boolean().optional(),
      autoApply: z.boolean().optional(),
    },
    query: `
      mutation CreatePromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) { id name type isActive storeId code }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createPromotion',
  }),
  gqlTool({
    name: 'admin_update_storefront_maintenance',
    description: 'Toggle storefront maintenance mode.',
    role: 'admin',
    writes: true,
    inputSchema: {
      enabled: z.boolean(),
      customMessage: z.string().optional(),
      reason: z.string().optional(),
      untilAt: z.string().optional(),
    },
    query: `
      mutation UpdateStorefrontMaintenance($input: UpdateStorefrontMaintenanceInput!) {
        updateStorefrontMaintenance(input: $input) { enabled customMessage }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'updateStorefrontMaintenance',
  }),
  gqlTool({
    name: 'admin_list_platform_banners',
    description: 'List platform banners.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        platformBanners { id title imageUrl linkUrl isActive sortOrder }
      }
    `,
    pick: 'platformBanners',
  }),
  gqlTool({
    name: 'admin_create_platform_banner',
    description: 'Create a platform banner.',
    role: 'admin',
    writes: true,
    inputSchema: {
      title: z.string(),
      imageUrl: z.string().url(),
      linkUrl: z.string().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    },
    query: `
      mutation CreatePlatformBanner($input: CreatePlatformBannerInput!) {
        createPlatformBanner(input: $input) { id title imageUrl isActive }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createPlatformBanner',
  }),
  gqlTool({
    name: 'admin_delete_platform_banner',
    description: 'Delete a platform banner.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { deletePlatformBanner(id: $id) }`,
    pick: 'deletePlatformBanner',
  }),
  gqlTool({
    name: 'admin_list_audit_logs',
    description: 'List admin audit logs.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query AdminAuditLogs($page: Int, $limit: Int) {
        adminAuditLogs(page: $page, limit: $limit) {
          items { id action resourceType resourceId actorEmail createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'adminAuditLogs',
  }),
  gqlTool({
    name: 'admin_list_search_synonyms',
    description: 'List search synonyms.',
    role: 'admin',
    inputSchema: {},
    query: `query { searchSynonyms { id terms expansion isActive } }`,
    pick: 'searchSynonyms',
  }),
  gqlTool({
    name: 'admin_create_search_synonym',
    description: 'Create a search synonym mapping.',
    role: 'admin',
    writes: true,
    inputSchema: {
      terms: z.array(z.string()).min(1),
      expansion: z.string(),
      isActive: z.boolean().optional(),
    },
    query: `
      mutation CreateSearchSynonym($input: CreateSearchSynonymInput!) {
        createSearchSynonym(input: $input) { id terms expansion }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createSearchSynonym',
  }),
];
