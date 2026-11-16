import { z } from 'zod';
import { gqlTool, storeIdField } from '../helpers';
import type { SopetToolDefinition } from '../types';

const PRODUCT_FIELDS = `
  id name slug description basePrice compareAtPrice status storeId
  categoryId petTypeId brandId warning expiryDate createdAt updatedAt
`;

export const storeProductTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'store_list_products',
    description: 'List products for a store (admin: any store; vendor: session store).',
    role: 'store',
    inputSchema: {
      storeId: storeIdField.optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query VendorProducts(
        $storeId: String
        $search: String
        $status: String
        $page: Int
        $limit: Int
      ) {
        vendorProducts(storeId: $storeId, search: $search, status: $status, page: $page, limit: $limit) {
          items { ${PRODUCT_FIELDS} }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      storeId: args.storeId,
      search: args.search,
      status: args.status,
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'vendorProducts',
  }),
  gqlTool({
    name: 'store_get_product',
    description: 'Get a vendor-visible product by id.',
    role: 'store',
    inputSchema: {
      id: z.string().uuid(),
      storeId: storeIdField.optional(),
    },
    query: `
      query VendorProduct($id: String!) {
        vendorProduct(id: $id) { ${PRODUCT_FIELDS} }
      }
    `,
    variables: (args) => ({ id: args.id }),
    pick: 'vendorProduct',
  }),
  gqlTool({
    name: 'store_create_product',
    description: 'Create a product in a store. Requires storeId for admin.',
    role: 'store',
    writes: true,
    inputSchema: {
      storeId: storeIdField.optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      basePrice: z.number(),
      compareAtPrice: z.number().optional(),
      categoryId: z.string().uuid().optional(),
      tagIds: z.array(z.string().uuid()).optional(),
      petTypeId: z.string().uuid().optional(),
      brandId: z.string().uuid().optional(),
      warning: z.string().optional(),
      expiryDate: z.string().optional(),
    },
    query: `
      mutation CreateProduct($storeId: String, $input: CreateProductInput!) {
        createProduct(storeId: $storeId, input: $input) { ${PRODUCT_FIELDS} }
      }
    `,
    variables: (args) => {
      const { storeId, ...input } = args;
      return { storeId, input };
    },
    pick: 'createProduct',
  }),
  gqlTool({
    name: 'store_update_product',
    description: 'Update a product (admin or store member).',
    role: 'store',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      storeId: storeIdField.optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      basePrice: z.number().optional(),
      compareAtPrice: z.number().nullable().optional(),
      status: z.string().optional(),
      categoryId: z.string().uuid().optional(),
      tagIds: z.array(z.string().uuid()).optional(),
      petTypeId: z.string().uuid().nullable().optional(),
      brandId: z.string().uuid().nullable().optional(),
      warning: z.string().nullable().optional(),
      expiryDate: z.string().nullable().optional(),
    },
    query: `
      mutation UpdateProduct($id: String!, $input: UpdateProductInput!) {
        updateProduct(id: $id, input: $input) { ${PRODUCT_FIELDS} }
      }
    `,
    variables: (args) => {
      const input = { ...args };
      const id = input.id;
      delete input.storeId;
      delete input.id;
      return { id, input };
    },
    pick: 'updateProduct',
  }),
  gqlTool({
    name: 'store_delete_product',
    description: 'Delete a product permanently from its store.',
    role: 'store',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      storeId: storeIdField.optional(),
    },
    query: `
      mutation DeleteProduct($id: String!) {
        deleteProduct(id: $id)
      }
    `,
    variables: (args) => ({ id: args.id }),
    pick: 'deleteProduct',
  }),
  gqlTool({
    name: 'store_publish_product',
    description: 'Publish a single product (makes it visible on storefront when checklist passes).',
    role: 'store',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      storeId: storeIdField.optional(),
    },
    query: `
      mutation PublishProduct($id: String!) {
        publishProduct(id: $id) { ${PRODUCT_FIELDS} }
      }
    `,
    variables: (args) => ({ id: args.id }),
    pick: 'publishProduct',
  }),
  gqlTool({
    name: 'store_publish_products',
    description: 'Batch publish products by id.',
    role: 'store',
    writes: true,
    inputSchema: {
      ids: z.array(z.string().uuid()).min(1),
      storeId: storeIdField.optional(),
    },
    query: `
      mutation PublishProducts($ids: [String!]!) {
        publishProducts(ids: $ids) {
          publishedCount
          failedCount
          publishedIds
          failures { productId code message }
        }
      }
    `,
    variables: (args) => ({ ids: args.ids }),
    pick: 'publishProducts',
  }),
  gqlTool({
    name: 'store_get_publish_checklist',
    description: 'Get publish readiness checklist for a product.',
    role: 'store',
    inputSchema: {
      productId: z.string().uuid(),
      storeId: storeIdField.optional(),
    },
    query: `
      query ProductPublishChecklist($productId: String!) {
        productPublishChecklist(productId: $productId) {
          canPublish
          missingKeys
          items { key complete }
        }
      }
    `,
    variables: (args) => ({ productId: args.productId }),
    pick: 'productPublishChecklist',
  }),
  gqlTool({
    name: 'store_sync_product_variants',
    description: 'Replace/sync product variants (sku, stock, price, attributes).',
    role: 'store',
    writes: true,
    inputSchema: {
      productId: z.string().uuid(),
      storeId: storeIdField.optional(),
      variants: z.array(
        z.object({
          id: z.string().uuid().optional(),
          sku: z.string(),
          stockQuantity: z.number().int(),
          price: z.number().optional(),
          priceModifier: z.number().optional(),
          compareAtPrice: z.number().nullable().optional(),
          attributes: z.string().describe('JSON string of attribute map'),
        }),
      ),
    },
    query: `
      mutation SyncProductVariants($productId: String!, $variants: [SyncProductVariantItemInput!]!) {
        syncProductVariants(productId: $productId, variants: $variants) {
          id sku stockQuantity price compareAtPrice attributes
        }
      }
    `,
    variables: (args) => ({
      productId: args.productId,
      variants: args.variants,
    }),
    pick: 'syncProductVariants',
  }),
  gqlTool({
    name: 'store_add_product_image',
    description: 'Attach an uploaded image URL to a product.',
    role: 'store',
    writes: true,
    inputSchema: {
      productId: z.string().uuid(),
      storeId: storeIdField.optional(),
      url: z.string().url(),
      altText: z.string().optional(),
      sortOrder: z.number().int().optional(),
      isThumbnail: z.boolean().optional(),
    },
    query: `
      mutation AddProductImage($productId: String!, $input: AddProductImageInput!) {
        addProductImage(productId: $productId, input: $input) {
          id url altText sortOrder isThumbnail
        }
      }
    `,
    variables: (args) => {
      const input = { ...args };
      const productId = input.productId;
      delete input.storeId;
      delete input.productId;
      return { productId, input };
    },
    pick: 'addProductImage',
  }),
];
