import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type McpConfig } from './config';
import { SessionStore } from './auth/session';
import { createToolContext, SopetGraphqlClient } from './graphql/client';
import { registerTools } from './tools/registry';

/** Shape expected by the GraphQL client / tools (HTTP transport fields optional). */
export type RuntimeMcpConfig = McpConfig & {
  httpHost?: string;
  httpPort?: number;
  allowedHosts?: string[];
};

export type SopetMcpRuntime = {
  config: RuntimeMcpConfig;
  sessions: SessionStore;
  gql: SopetGraphqlClient;
  createServer: () => McpServer;
};

export async function createSopetMcpRuntime(options: {
  config: RuntimeMcpConfig;
  skipBootstrap?: boolean;
}): Promise<SopetMcpRuntime> {
  const config = options.config;
  const sessions = new SessionStore();
  const gql = new SopetGraphqlClient(config, sessions);

  if (!options.skipBootstrap) {
    await gql.bootstrap();
  }

  const createServer = (): McpServer => {
    const server = new McpServer({
      name: 'sopet-admin-mcp',
      version: '0.1.0',
    });
    registerTools(server, createToolContext(config, sessions, gql));
    return server;
  };

  return { config, sessions, gql, createServer };
}
