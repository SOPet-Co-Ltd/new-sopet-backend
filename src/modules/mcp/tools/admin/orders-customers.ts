import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

export const adminOrdersCustomersTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'admin_list_orders',
    description: 'List platform orders with filters.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      search: z.string().optional(),
      status: z.string().optional(),
    },
    query: `
      query AdminOrders($page: Int, $limit: Int, $search: String, $status: String) {
        adminOrders(page: $page, limit: $limit, search: $search, status: $status) {
          items {
            id orderNumber status paymentStatus totalAmount storeId customerId createdAt
          }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
      status: args.status,
    }),
    pick: 'adminOrders',
  }),
  gqlTool({
    name: 'admin_get_order',
    description: 'Get one order by id (admin).',
    role: 'admin',
    inputSchema: { id: z.string().uuid() },
    query: `
      query AdminOrder($id: String!) {
        adminOrder(id: $id) {
          id orderNumber status paymentStatus totalAmount storeId customerId
          shippingAddress createdAt
        }
      }
    `,
    pick: 'adminOrder',
  }),
  gqlTool({
    name: 'admin_update_order_status',
    description: 'Update an order status as admin.',
    role: 'admin',
    writes: true,
    inputSchema: {
      orderId: z.string().uuid(),
      status: z.string(),
      note: z.string().optional(),
    },
    query: `
      mutation UpdateOrderStatus($input: UpdateOrderStatusInput!) {
        updateOrderStatus(input: $input) { id orderNumber status }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'updateOrderStatus',
  }),
  gqlTool({
    name: 'admin_list_customers',
    description: 'List customers for platform admin.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      search: z.string().optional(),
    },
    query: `
      query AdminCustomers($page: Int, $limit: Int, $search: String) {
        adminCustomers(page: $page, limit: $limit, search: $search) {
          items { id email fullName phone isActive createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
    }),
    pick: 'adminCustomers',
  }),
  gqlTool({
    name: 'admin_get_customer',
    description: 'Get one customer by id.',
    role: 'admin',
    inputSchema: { id: z.string().uuid() },
    query: `
      query AdminCustomer($id: String!) {
        adminCustomer(id: $id) { id email fullName phone isActive createdAt }
      }
    `,
    pick: 'adminCustomer',
  }),
  gqlTool({
    name: 'admin_update_customer',
    description: 'Update customer profile fields as admin.',
    role: 'admin',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      fullName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      dateOfBirth: z.string().optional(),
    },
    query: `
      mutation UpdateCustomerAsAdmin($input: UpdateCustomerAsAdminInput!) {
        updateCustomerAsAdmin(input: $input) { id email fullName phone }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'updateCustomerAsAdmin',
  }),
  gqlTool({
    name: 'admin_list_vendors',
    description: 'List vendor accounts.',
    role: 'admin',
    inputSchema: {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      search: z.string().optional(),
      status: z.string().optional(),
    },
    query: `
      query AdminVendors($page: Int, $limit: Int, $search: String, $status: String) {
        adminVendors(page: $page, limit: $limit, search: $search, status: $status) {
          items { id email fullName isActive storeCount createdAt }
          pagination { page limit total totalPages }
        }
      }
    `,
    variables: (args) => ({
      page: args.page ?? 1,
      limit: args.limit ?? 20,
      search: args.search,
      status: args.status,
    }),
    pick: 'adminVendors',
  }),
  gqlTool({
    name: 'admin_invite_vendor',
    description: 'Invite a vendor by email.',
    role: 'admin',
    writes: true,
    inputSchema: {
      email: z.string().email(),
    },
    query: `
      mutation InviteVendor($input: InviteVendorInput!) {
        inviteVendor(input: $input) { id email status }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'inviteVendor',
  }),
];
