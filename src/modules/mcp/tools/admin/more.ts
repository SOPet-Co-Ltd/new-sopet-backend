import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

export const adminMoreTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'admin_list_store_requests',
    description: 'List pending store creation requests.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        pendingStoreRequests { id storeName ownerEmail status createdAt }
      }
    `,
    pick: 'pendingStoreRequests',
  }),
  gqlTool({
    name: 'admin_approve_store_request',
    description: 'Approve a store request.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveStoreRequest(id: $id) { id status } }`,
    pick: 'approveStoreRequest',
  }),
  gqlTool({
    name: 'admin_reject_store_request',
    description: 'Reject a store request.',
    role: 'admin',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      reason: z.string().min(1),
    },
    query: `
      mutation RejectStoreRequest($input: RejectStoreRequestInput!) {
        rejectStoreRequest(input: $input) { id status }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'rejectStoreRequest',
  }),
  gqlTool({
    name: 'admin_list_reactivation_requests',
    description: 'List store reactivation requests.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        pendingStoreReactivationRequests { id storeId status createdAt }
      }
    `,
    pick: 'pendingStoreReactivationRequests',
  }),
  gqlTool({
    name: 'admin_approve_reactivation_request',
    description: 'Approve a store reactivation request.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveStoreReactivationRequest(id: $id) { id status } }`,
    pick: 'approveStoreReactivationRequest',
  }),
  gqlTool({
    name: 'admin_list_shipping_providers',
    description: 'List platform shipping providers.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        shippingProviders { id name isActive }
      }
    `,
    pick: 'shippingProviders',
  }),
  gqlTool({
    name: 'admin_create_shipping_provider',
    description: 'Create a shipping provider.',
    role: 'admin',
    writes: true,
    inputSchema: {
      name: z.string(),
    },
    query: `
      mutation CreateShippingProvider($input: CreateShippingProviderInput!) {
        createShippingProvider(input: $input) { id name isActive }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createShippingProvider',
  }),
  gqlTool({
    name: 'admin_get_platform_analytics',
    description: 'Get platform analytics summary for a date range.',
    role: 'admin',
    inputSchema: {
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    },
    query: `
      query PlatformAnalytics($fromDate: String, $toDate: String) {
        platformAnalytics(fromDate: $fromDate, toDate: $toDate) {
          totalOrders totalRevenue totalCustomers totalStores averageOrderValue pendingStores
        }
      }
    `,
    pick: 'platformAnalytics',
  }),
  gqlTool({
    name: 'admin_list_notifications',
    description: 'List notifications for the logged-in admin.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    query: `
      query Notifications($page: Int, $limit: Int) {
        notifications(page: $page, limit: $limit) {
          id title message type isRead createdAt metadata
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
    }),
    pick: 'notifications',
  }),
  gqlTool({
    name: 'admin_list_email_templates',
    description: 'List email content templates.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        emailContentTemplates { id key name subjectTemplate updatedAt enabled }
      }
    `,
    pick: 'emailContentTemplates',
  }),
  gqlTool({
    name: 'admin_list_team',
    description: 'List platform admin team members.',
    role: 'admin',
    inputSchema: {},
    query: `
      query {
        adminTeamMembers { id email fullName isActive createdAt }
      }
    `,
    pick: 'adminTeamMembers',
  }),
];
