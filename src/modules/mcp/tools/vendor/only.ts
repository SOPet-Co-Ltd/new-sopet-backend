import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

/** Tools that remain vendor-session only (no admin parallel). */
export const vendorOnlyTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'vendor_list_my_stores',
    description: 'List stores accessible to the logged-in vendor.',
    role: 'vendor',
    inputSchema: {},
    query: `
      query {
        myStores {
          store { id name slug status }
          membershipRole
        }
      }
    `,
    pick: 'myStores',
  }),
  gqlTool({
    name: 'vendor_request_payout',
    description: 'Request an automatic payout for the vendor session store. Moves money state.',
    role: 'vendor',
    writes: true,
    inputSchema: {},
    query: `
      mutation {
        requestPayout { id amount status storeId }
      }
    `,
    pick: 'requestPayout',
  }),
  gqlTool({
    name: 'vendor_cancel_payout_request',
    description: 'Cancel the vendor session store pending payout request. Moves money state.',
    role: 'vendor',
    writes: true,
    inputSchema: {},
    query: `
      mutation {
        cancelPayoutRequest { id amount status storeId failureReason }
      }
    `,
    pick: 'cancelPayoutRequest',
  }),
  gqlTool({
    name: 'vendor_request_manual_payout',
    description: 'Request a manual payout for the vendor session store. Moves money state.',
    role: 'vendor',
    writes: true,
    inputSchema: {},
    query: `
      mutation {
        requestManualPayout { id amount status storeId }
      }
    `,
    pick: 'requestManualPayout',
  }),
  gqlTool({
    name: 'vendor_get_payout_summary',
    description: 'Get payout summary for the vendor session store.',
    role: 'vendor',
    inputSchema: {},
    query: `
      query {
        storePayoutSummary {
          storeId availableBalance pendingPayoutAmount totalPaidOut canRequestPayout
        }
      }
    `,
    pick: 'storePayoutSummary',
  }),
  gqlTool({
    name: 'vendor_list_customers',
    description: 'List customers who ordered from the vendor session store.',
    role: 'vendor',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      search: z.string().optional(),
      storeId: z.string().uuid().optional(),
    },
    query: `
      query VendorCustomers($storeId: String, $page: Int, $limit: Int, $search: String) {
        vendorCustomers(storeId: $storeId, page: $page, limit: $limit, search: $search) {
          items { id email fullName }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args, ctx) => ({
      storeId: ctx.sessions.vendorStoreId() ?? args.storeId,
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
    }),
    pick: 'vendorCustomers',
  }),
];
