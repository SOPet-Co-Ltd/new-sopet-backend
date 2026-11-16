import { z } from 'zod';
import { gqlTool } from '../helpers';
import type { SopetToolDefinition } from '../types';

const ITEM = `id name slug status imageUrl createdAt`;

export const adminTaxonomyTools: SopetToolDefinition[] = [
  gqlTool({
    name: 'admin_list_categories',
    description: 'List approved categories.',
    role: 'admin',
    inputSchema: {},
    query: `query { approvedCategories { ${ITEM} } }`,
    pick: 'approvedCategories',
  }),
  gqlTool({
    name: 'admin_list_pending_categories',
    description: 'List categories awaiting approval.',
    role: 'admin',
    inputSchema: {},
    query: `query { pendingCategories { ${ITEM} } }`,
    pick: 'pendingCategories',
  }),
  gqlTool({
    name: 'admin_create_category',
    description: 'Create a category (admin creates as approved).',
    role: 'admin',
    writes: true,
    inputSchema: {
      name: z.string().min(1),
      parentId: z.string().uuid().optional(),
    },
    query: `
      mutation CreateCategory($input: CreateCategoryInput!) {
        createCategory(input: $input) { ${ITEM} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createCategory',
  }),
  gqlTool({
    name: 'admin_update_category',
    description: 'Update a category.',
    role: 'admin',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      name: z.string().optional(),
      parentId: z.string().uuid().nullable().optional(),
    },
    query: `
      mutation UpdateCategory($input: UpdateCategoryInput!) {
        updateCategory(input: $input) { ${ITEM} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'updateCategory',
  }),
  gqlTool({
    name: 'admin_approve_category',
    description: 'Approve a pending category.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveCategory(id: $id) { ${ITEM} } }`,
    pick: 'approveCategory',
  }),
  gqlTool({
    name: 'admin_reject_category',
    description: 'Reject a pending category.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { rejectCategory(id: $id) { ${ITEM} } }`,
    pick: 'rejectCategory',
  }),
  gqlTool({
    name: 'admin_delete_category',
    description: 'Delete a category (may reassign products).',
    role: 'admin',
    writes: true,
    inputSchema: {
      id: z.string().uuid(),
      reassignToCategoryId: z.string().uuid().optional(),
    },
    query: `
      mutation DeleteCategory($input: DeleteTaxonomyInput!) {
        deleteCategory(input: $input) { success affectedProductCount }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'deleteCategory',
  }),
  gqlTool({
    name: 'admin_list_tags',
    description: 'List approved tags.',
    role: 'admin',
    inputSchema: {},
    query: `query { approvedTags { ${ITEM} } }`,
    pick: 'approvedTags',
  }),
  gqlTool({
    name: 'admin_create_tag',
    description: 'Create a tag.',
    role: 'admin',
    writes: true,
    inputSchema: { name: z.string().min(1) },
    query: `
      mutation CreateTag($input: CreateTagInput!) {
        createTag(input: $input) { ${ITEM} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createTag',
  }),
  gqlTool({
    name: 'admin_approve_tag',
    description: 'Approve a pending tag.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveTag(id: $id) { ${ITEM} } }`,
    pick: 'approveTag',
  }),
  gqlTool({
    name: 'admin_reject_tag',
    description: 'Reject a pending tag.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { rejectTag(id: $id) { ${ITEM} } }`,
    pick: 'rejectTag',
  }),
  gqlTool({
    name: 'admin_delete_tag',
    description: 'Delete a tag.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { deleteTag(id: $id) { success } }`,
    pick: 'deleteTag',
  }),
  gqlTool({
    name: 'admin_list_pet_types',
    description: 'List approved pet types.',
    role: 'admin',
    inputSchema: {},
    query: `query { approvedPetTypes { ${ITEM} } }`,
    pick: 'approvedPetTypes',
  }),
  gqlTool({
    name: 'admin_create_pet_type',
    description: 'Create a pet type.',
    role: 'admin',
    writes: true,
    inputSchema: { name: z.string().min(1) },
    query: `
      mutation CreatePetType($input: CreatePetTypeInput!) {
        createPetType(input: $input) { ${ITEM} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createPetType',
  }),
  gqlTool({
    name: 'admin_approve_pet_type',
    description: 'Approve a pending pet type.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approvePetType(id: $id) { ${ITEM} } }`,
    pick: 'approvePetType',
  }),
  gqlTool({
    name: 'admin_list_brands',
    description: 'List approved brands.',
    role: 'admin',
    inputSchema: {},
    query: `query { approvedBrands { ${ITEM} } }`,
    pick: 'approvedBrands',
  }),
  gqlTool({
    name: 'admin_create_brand',
    description: 'Create a brand.',
    role: 'admin',
    writes: true,
    inputSchema: { name: z.string().min(1) },
    query: `
      mutation CreateBrand($input: CreateBrandInput!) {
        createBrand(input: $input) { ${ITEM} }
      }
    `,
    variables: (args) => ({ input: args }),
    pick: 'createBrand',
  }),
  gqlTool({
    name: 'admin_approve_brand',
    description: 'Approve a pending brand.',
    role: 'admin',
    writes: true,
    inputSchema: { id: z.string().uuid() },
    query: `mutation($id: String!) { approveBrand(id: $id) { ${ITEM} } }`,
    pick: 'approveBrand',
  }),
];
