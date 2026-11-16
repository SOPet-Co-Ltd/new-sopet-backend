export type McpConfig = {
  graphqlUrl: string;
  adminEmail?: string;
  adminPassword?: string;
  vendorEmail?: string;
  vendorPassword?: string;
  vendorStoreId?: string;
  httpToken: string;
  /** Public API origin (same host as GraphQL), e.g. https://api.sopet.org */
  publicApiUrl: string;
};

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True when MCP HTTP should mount on this Nest process. */
export function isMcpEnabled(): boolean {
  const flag = optional('MCP_ENABLED');
  if (flag === 'false' || flag === '0') {
    return false;
  }
  if (flag === 'true' || flag === '1') {
    return true;
  }
  return Boolean(optional('MCP_HTTP_TOKEN'));
}

export function loadMcpConfig(): McpConfig {
  const port = optional('PORT') ?? '3002';
  // Client-facing URL (same host as GraphQL) — no separate MCP subdomain.
  const publicApiUrl = stripTrailingSlash(
    optional('API_URL') ?? optional('MCP_PUBLIC_URL') ?? `http://localhost:${port}`,
  );
  // In-process loopback for tool calls (avoids hairpinning through public TLS).
  const graphqlUrl =
    optional('SOPET_GRAPHQL_URL') ??
    optional('MCP_GRAPHQL_URL') ??
    `http://127.0.0.1:${port}/graphql`;
  const httpToken = optional('MCP_HTTP_TOKEN');
  const adminEmail = optional('MCP_ADMIN_EMAIL') ?? optional('SOPET_ADMIN_EMAIL');
  const adminPassword = optional('MCP_ADMIN_PASSWORD') ?? optional('SOPET_ADMIN_PASSWORD');
  const vendorEmail = optional('MCP_VENDOR_EMAIL') ?? optional('SOPET_VENDOR_EMAIL');
  const vendorPassword = optional('MCP_VENDOR_PASSWORD') ?? optional('SOPET_VENDOR_PASSWORD');
  const vendorStoreId = optional('MCP_VENDOR_STORE_ID') ?? optional('SOPET_VENDOR_STORE_ID');

  if (!httpToken) {
    throw new Error('MCP_HTTP_TOKEN is required when MCP is enabled');
  }
  if (!adminEmail && !vendorEmail) {
    throw new Error(
      'Set MCP_ADMIN_EMAIL/PASSWORD and/or MCP_VENDOR_EMAIL/PASSWORD (or SOPET_* aliases)',
    );
  }
  if (adminEmail && !adminPassword) {
    throw new Error('MCP_ADMIN_PASSWORD is required when MCP_ADMIN_EMAIL is set');
  }
  if (vendorEmail && !vendorPassword) {
    throw new Error('MCP_VENDOR_PASSWORD is required when MCP_VENDOR_EMAIL is set');
  }

  return {
    graphqlUrl,
    adminEmail,
    adminPassword,
    vendorEmail,
    vendorPassword,
    vendorStoreId,
    httpToken,
    publicApiUrl,
  };
}

export function mcpEndpointUrl(config: McpConfig): string {
  return `${config.publicApiUrl}/mcp`;
}
