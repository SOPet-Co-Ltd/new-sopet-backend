import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

const ADMIN_STORE_FIELDS = `
  id name slug description status contactPhone contactEmail address
  commissionRate ownerId createdAt updatedAt
  bankAccountName bankAccountNumberMasked bankName bankAccountVerified
`;

export const adminStoreTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'admin_list_stores',
    description: 'List platform stores with optional search, status, and sort.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional().describe('Page number, default 1'),
      limit: z.number().int().min(1).max(100).optional().describe('Page size, default 20'),
      search: z.string().optional(),
      status: z.string().optional().describe('pending | approved | rejected | suspended'),
      sort: z.string().optional(),
    },
    query: `
      query AdminStores($page: Int!, $limit: Int!, $search: String, $status: String, $sort: String) {
        adminStores(page: $page, limit: $limit, search: $search, status: $status, sort: $sort) {
          items { ${ADMIN_STORE_FIELDS} }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
      status: args.status,
      sort: args.sort,
    }),
    pick: 'adminStores',
  }),
  gqlTool({
    name: 'admin_get_store',
    description: 'Get one store by id (admin detail).',
    role: 'admin',
    inputSchema: { id: z.string().uuid() },
    query: `
      query AdminStore($id: String!) {
        adminStore(id: $id) { ${ADMIN_STORE_FIELDS} }
      }
    `,
    pick: 'adminStore',
  }),
  gqlTool({
    name: 'admin_create_store',
    description: 'Create a store as platform admin and attach an owner vendor user.',
    role: 'admin',
    writes: true,
    inputSchema: {
      ownerUserId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      contactPhone: z.string().optional(),
      contactEmail: z.string().email().optional(),
      address: z.string().optional(),
    },
    query: `
      mutation CreateStoreAsAdmin($input: CreateStoreAsAdminInput!) {
        createStoreAsAdmin(input: $input) { ${ADMIN_STORE_FIELDS} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createStoreAsAdmin',
  }),
  gqlTool({
    name: 'admin_update_store',
    description:
      'Update store fields as platform admin (name, status, commission, owner, contacts).',
    role: 'admin',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      name: z.string().optional(),
      slug: z.string().optional(),
      description: z.string().nullable().optional(),
      status: z.string().optional(),
      contactPhone: z.string().nullable().optional(),
      contactEmail: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      ownerId: z.string().uuid().nullable().optional(),
      commissionRate: z.number().optional(),
    },
    query: `
      mutation UpdateStoreAsAdmin($input: UpdateStoreAsAdminInput!) {
        updateStoreAsAdmin(input: $input) { ${ADMIN_STORE_FIELDS} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'updateStoreAsAdmin',
  }),
  gqlTool({
    name: 'admin_approve_store',
    description: 'Approve a pending store registration.',
    role: 'admin',
    writes: true,
    inputSchema: { storeId: z.string().uuid() },
    query: `
      mutation ApproveStore($input: ApproveStoreInput!) {
        approveStore(input: $input) { id name status }
      }
    `,
    variables: (args) => ({ input: { storeId: args.storeId } }),
    pick: 'approveStore',
  }),
  gqlTool({
    name: 'admin_reject_store',
    description: 'Reject a pending store registration with a reason.',
    role: 'admin',
    writes: true,
    inputSchema: {
      storeId: z.string().uuid(),
      rejectionReason: z.string().optional(),
    },
    query: `
      mutation RejectStore($input: RejectStoreInput!) {
        rejectStore(input: $input) { id name status }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'rejectStore',
  }),
  gqlTool({
    name: 'admin_verify_store_bank_account',
    description: 'Mark a store bank account as verified.',
    role: 'admin',
    writes: true,
    inputSchema: { storeId: z.string().uuid() },
    query: `
      mutation VerifyStoreBankAccount($storeId: String!) {
        verifyStoreBankAccount(storeId: $storeId) { ${ADMIN_STORE_FIELDS} }
      }
    `,
    pick: 'verifyStoreBankAccount',
  }),
  gqlTool({
    name: 'admin_reject_store_bank_account',
    description: 'Reject a store bank account verification with a reason.',
    role: 'admin',
    writes: true,
    inputSchema: {
      storeId: z.string().uuid(),
      reason: z.string().min(1),
    },
    query: `
      mutation RejectStoreBankAccount($storeId: String!, $reason: String!) {
        rejectStoreBankAccount(storeId: $storeId, reason: $reason) { ${ADMIN_STORE_FIELDS} }
      }
    `,
    pick: 'rejectStoreBankAccount',
  }),
  gqlTool({
    name: 'admin_list_pending_stores',
    description: 'List stores awaiting approval.',
    role: 'admin',
    inputSchema: {},
    query: `
      query PendingStores {
        pendingStores { id name slug status createdAt }
      }
    `,
    pick: 'pendingStores',
  }),
];
