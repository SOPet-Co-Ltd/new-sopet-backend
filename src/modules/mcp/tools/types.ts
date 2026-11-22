import type { ZodRawShape } from 'zod';
import type { ToolContext } from '../graphql/client';
import type { SessionRole } from '../auth/session';

export type ToolRole = 'admin' | 'vendor' | 'store';

export type SopetToolDefinition = {
  name: string;
  description: string;
  /** admin = platform admin JWT only; vendor = vendor JWT only; store = admin or vendor */
  role: ToolRole;
  /** When true, description already warns about writes / money movement. */
  writes?: boolean;
  inputSchema: ZodRawShape;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export function assertRole(ctx: ToolContext, role: ToolRole): SessionRole {
  if (role === 'admin') {
    if (!ctx.sessions.has('admin')) {
      throw new Error('Admin session required for this tool');
    }
    return 'admin';
  }
  if (role === 'vendor') {
    if (!ctx.sessions.has('vendor')) {
      throw new Error('Vendor session required for this tool');
    }
    return 'vendor';
  }
  // store: prefer admin, else vendor
  return ctx.resolveStoreActor();
}

export function jsonResult(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}
