import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../graphql/client';
import { adminStoreTools } from './admin/stores';
import { adminTaxonomyTools } from './admin/taxonomy';
import { adminOrdersCustomersTools } from './admin/orders-customers';
import { adminPlatformTools } from './admin/platform';
import { adminMoreTools } from './admin/more';
import { storeProductTools } from './store/products';
import { storeOpsTools } from './store/ops';
import { vendorOnlyTools } from './vendor/only';
import { errorResult, jsonResult, type SopetToolDefinition } from './types';

export function allTools(): SopetToolDefinition[] {
  return [
    ...adminStoreTools,
    ...adminTaxonomyTools,
    ...adminOrdersCustomersTools,
    ...adminPlatformTools,
    ...adminMoreTools,
    ...storeProductTools,
    ...storeOpsTools,
    ...vendorOnlyTools,
  ];
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of allTools()) {
    if (tool.role === 'admin' && !ctx.sessions.has('admin')) {
      continue;
    }
    if (tool.role === 'vendor' && !ctx.sessions.has('vendor')) {
      continue;
    }
    if (tool.role === 'store' && !ctx.sessions.has('admin') && !ctx.sessions.has('vendor')) {
      continue;
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        try {
          const result = await tool.execute(args, ctx);
          return jsonResult(result);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}

export function listToolNames(): string[] {
  return allTools().map((t) => t.name);
}
