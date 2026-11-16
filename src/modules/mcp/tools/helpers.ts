import { z } from 'zod';
import type { ToolContext } from '../graphql/client';
import type { SessionRole } from '../auth/session';
import { assertRole, type SopetToolDefinition, type ToolRole } from './types';

export const storeIdField = z
  .string()
  .uuid()
  .describe('Target store UUID. Required for admin; ignored for vendor (session store is used).');

export function withStoreId(
  actor: SessionRole,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (actor === 'vendor') {
    const storeId = ctx.sessions.vendorStoreId();
    if (!storeId) {
      throw new Error('Vendor session has no store. Set SOPET_VENDOR_STORE_ID.');
    }
    return { ...args, storeId };
  }
  if (!args.storeId || typeof args.storeId !== 'string') {
    throw new Error('storeId is required for admin store operations');
  }
  return args;
}

export function gqlTool(opts: {
  name: string;
  description: string;
  role: ToolRole;
  writes?: boolean;
  inputSchema: SopetToolDefinition['inputSchema'];
  query: string;
  /** Map tool args -> GraphQL variables. Default: pass args through. */
  variables?: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    actor: SessionRole,
  ) => Record<string, unknown>;
  /** Pick a field from the GraphQL data root. Default: whole data. */
  pick?: string;
}): SopetToolDefinition {
  const writeNote = opts.writes
    ? ' WRITE: mutates data or may move money / publish / issue secrets.'
    : '';
  return {
    name: opts.name,
    description: `${opts.description}${writeNote}`,
    role: opts.role,
    writes: opts.writes,
    inputSchema: opts.inputSchema,
    async execute(args, ctx) {
      const actor = assertRole(ctx, opts.role);
      let variables = opts.variables ? opts.variables(args, ctx, actor) : { ...args };
      if (opts.role === 'store') {
        variables = withStoreId(actor, ctx, variables);
      }
      const data = await ctx.gql.request<Record<string, unknown>>(actor, opts.query, variables);
      if (opts.pick) {
        return data[opts.pick];
      }
      return data;
    },
  };
}
