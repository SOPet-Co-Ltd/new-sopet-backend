import { z } from 'zod';
import { gqlTool, storeIdField } from '../helpers';
import type { SopetToolDefinition } from '../types';

export const storeOpsTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'store_get_settings',
    description: 'Get store profile/settings for a store.',
    role: 'store',
    inputSchema: { storeId: storeIdField.optional() },
    query: `
      query MyStore($storeId: String) {
        myStore(storeId: $storeId) {
          id name slug description status contactPhone contactEmail address
        }
      }
    `,
    pick: 'myStore',
  }),
  gqlTool({
    name: 'store_update_settings',
    description: 'Update store profile settings (name, description, contacts, address).',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      contactPhone: z.string().optional(),
      contactEmail: z.string().optional(),
      address: z.string().optional(),
    },
    query: `
      mutation UpdateStore($storeId: String, $input: UpdateStoreSettingsInput!) {
        updateStore(storeId: $storeId, input: $input) {
          id name slug description contactPhone contactEmail address
        }
      }
    `,
    variables: (args) => {
      const { storeId, ...input } = args;
      return { storeId, input };
    },
    pick: 'updateStore',
  }),
  gqlTool({
    name: 'store_list_orders',
    description: 'List orders for a store.',
    role: 'store',
    inputSchema: {
      storeId: storeIdField,
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    },
    query: `
      query VendorOrders($storeId: String!, $page: Int, $limit: Int, $status: String, $search: String) {
        vendorOrders(storeId: $storeId, page: $page, limit: $limit, status: $status, search: $search) {
          items { id orderNumber status paymentStatus totalAmount createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      storeId: args.storeId,
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      status: args.status,
      search: args.search,
    }),
    pick: 'vendorOrders',
  }),
  gqlTool({
    name: 'store_get_order',
    description: 'Get one store order.',
    role: 'store',
    inputSchema: {
      storeId: storeIdField,
      id: z.string().uuid().describe('Order id'),
    },
    query: `
      query VendorOrder($storeId: String!, $id: String!) {
        vendorOrder(storeId: $storeId, id: $id) {
          id orderNumber status paymentStatus totalAmount createdAt
        }
      }
    `,
    pick: 'vendorOrder',
  }),
  gqlTool({
    name: 'store_acknowledge_order',
    description: 'Acknowledge a vendor order (accept for fulfillment).',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      orderId: z.string().uuid(),
    },
    query: `
      mutation AcknowledgeVendorOrder($storeId: String, $orderId: String!) {
        acknowledgeVendorOrder(storeId: $storeId, orderId: $orderId) { id status }
      }
    `,
    pick: 'acknowledgeVendorOrder',
  }),
  gqlTool({
    name: 'store_ship_order',
    description: 'Mark a vendor order as shipped with tracking info.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      orderId: z.string().uuid(),
      trackingNumber: z.string().min(1),
      fulfillmentProvider: z.string().min(1),
      trackingUrl: z.string().optional(),
    },
    query: `
      mutation ShipVendorOrder($storeId: String, $input: ShipVendorOrderInput!) {
        shipVendorOrder(storeId: $storeId, input: $input) { id status }
      }
    `,
    variables: (args) => {
      const { storeId, ...input } = args;
      return { storeId, input };
    },
    pick: 'shipVendorOrder',
  }),
  gqlTool({
    name: 'store_cancel_order',
    description: 'Cancel a vendor order.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      orderId: z.string().uuid(),
    },
    query: `
      mutation CancelVendorOrder($storeId: String, $orderId: String!) {
        cancelVendorOrder(storeId: $storeId, orderId: $orderId) { id status }
      }
    `,
    pick: 'cancelVendorOrder',
  }),
  gqlTool({
    name: 'store_list_promotions',
    description: 'List promotions for a store.',
    role: 'store',
    inputSchema: {
      storeId: storeIdField,
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query StorePromotions($storeId: String!, $page: Int, $limit: Int) {
        storePromotions(storeId: $storeId, page: $page, limit: $limit) {
          items { id name type isActive startsAt endsAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      storeId: args.storeId,
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'storePromotions',
  }),
  gqlTool({
    name: 'store_create_promotion',
    description: 'Create a store-scoped promotion (admin must pass storeId).',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField,
      name: z.string(),
      code: z.string(),
      type: z.string(),
      discountValue: z.number(),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
      isActive: z.boolean().optional(),
      autoApply: z.boolean().optional(),
      minPurchaseAmount: z.number().optional(),
      maxDiscountAmount: z.number().optional(),
      usageLimit: z.number().int().optional(),
      usagePerCustomer: z.number().int().optional(),
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
    name: 'store_list_sale_campaigns',
    description: 'List sale campaigns for a store.',
    role: 'store',
    inputSchema: { storeId: storeIdField },
    query: `
      query StoreSaleCampaigns($storeId: String!) {
        storeSaleCampaigns(storeId: $storeId) {
          id name isActive startsAt expiresAt
        }
      }
    `,
    pick: 'storeSaleCampaigns',
  }),
  gqlTool({
    name: 'store_create_sale_campaign',
    description: 'Create a sale campaign for a store. items is required.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField,
      name: z.string(),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
      isActive: z.boolean().optional(),
      items: z.array(
        z.object({
          productId: z.string().uuid(),
          discountType: z.string().optional(),
          discountValue: z.number().optional(),
        }),
      ),
    },
    query: `
      mutation CreateSaleCampaign($input: CreateSaleCampaignInput!) {
        createSaleCampaign(input: $input) { id name isActive }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createSaleCampaign',
  }),
  gqlTool({
    name: 'store_list_shipping_options',
    description: 'List shipping options for a store.',
    role: 'store',
    inputSchema: { storeId: storeIdField.optional() },
    query: `
      query MyStoreShippingOptions($storeId: String) {
        myStoreShippingOptions(storeId: $storeId) {
          id name price isActive
        }
      }
    `,
    pick: 'myStoreShippingOptions',
  }),
  gqlTool({
    name: 'store_create_shipping_option',
    description: 'Create a shipping option for a store.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      name: z.string(),
      price: z.number(),
      description: z.string().optional(),
      providerId: z.string().uuid().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    },
    query: `
      mutation CreateShippingOption($storeId: String, $input: CreateShippingOptionInput!) {
        createShippingOption(storeId: $storeId, input: $input) {
          id name price isActive
        }
      }
    `,
    variables: (args) => {
      const { storeId, ...input } = args;
      return { storeId, input };
    },
    pick: 'createShippingOption',
  }),
  gqlTool({
    name: 'store_list_reviews',
    description: 'List product reviews for a store.',
    role: 'store',
    inputSchema: {
      storeId: storeIdField,
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query StoreProductReviews($storeId: String!, $page: Int, $limit: Int) {
        storeProductReviews(storeId: $storeId, page: $page, limit: $limit) {
          items { id rating comment productId productName createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      storeId: args.storeId,
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'storeProductReviews',
  }),
  gqlTool({
    name: 'store_create_review_reply',
    description: 'Reply to a product review as the store.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      reviewId: z.string().uuid(),
      body: z.string().min(1),
    },
    query: `
      mutation CreateReviewReply($input: CreateReviewReplyInput!) {
        createReviewReply(input: $input) { id body reviewId }
      }
    `,
    variables: (args) => {
      const input = { ...args };
      delete input.storeId;
      return { input };
    },
    pick: 'createReviewReply',
  }),
  gqlTool({
    name: 'store_list_members',
    description: 'List team members for a store.',
    role: 'store',
    inputSchema: { storeId: storeIdField.optional() },
    query: `
      query StoreMembers($storeId: String) {
        storeMembers(storeId: $storeId) {
          id userId storeId role email fullName
        }
      }
    `,
    pick: 'storeMembers',
  }),
  gqlTool({
    name: 'store_list_api_keys',
    description: 'List store API keys (secrets are never returned after creation).',
    role: 'store',
    inputSchema: { storeId: storeIdField },
    query: `
      query StoreApiKeys($storeId: String!) {
        storeApiKeys(storeId: $storeId) {
          id name keyPrefix createdAt lastUsedAt revokedAt
        }
      }
    `,
    pick: 'storeApiKeys',
  }),
  gqlTool({
    name: 'store_create_api_key',
    description: 'Create a store API key. Returns the secret once — store it securely.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField,
      name: z.string().min(1),
    },
    query: `
      mutation CreateStoreApiKey($storeId: String!, $name: String!) {
        createStoreApiKey(storeId: $storeId, name: $name) {
          secret
          apiKey { id name keyPrefix createdAt }
        }
      }
    `,
    pick: 'createStoreApiKey',
  }),
  gqlTool({
    name: 'store_revoke_api_key',
    description: 'Revoke a store API key.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField,
      id: z.string().uuid(),
    },
    query: `
      mutation RevokeStoreApiKey($storeId: String!, $id: String!) {
        revokeStoreApiKey(storeId: $storeId, id: $id)
      }
    `,
    pick: 'revokeStoreApiKey',
  }),
  gqlTool({
    name: 'store_upload_image',
    description: 'Upload an image (base64) to storage and return its public URL.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      folder: z.string().optional().describe('Upload folder, e.g. products'),
      base64: z.string().describe('Base64-encoded file bytes (no data: prefix)'),
    },
    query: `
      mutation UploadImage($base64: String!, $folder: String) {
        uploadImage(base64: $base64, folder: $folder) { url key }
      }
    `,
    variables: (args) => ({
      base64: args.base64,
      folder: args.folder,
    }),
    pick: 'uploadImage',
  }),
];
