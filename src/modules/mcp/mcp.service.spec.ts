import { isMcpEnabled, loadMcpConfig, mcpEndpointUrl } from './config';

describe('MCP config (same-host API)', () => {
  const keys = [
    'MCP_ENABLED',
    'MCP_HTTP_TOKEN',
    'MCP_ADMIN_EMAIL',
    'MCP_ADMIN_PASSWORD',
    'SOPET_ADMIN_EMAIL',
    'SOPET_ADMIN_PASSWORD',
    'API_URL',
    'PORT',
    'SOPET_GRAPHQL_URL',
  ] as const;

  afterEach(() => {
    for (const key of keys) {
      delete process.env[key];
    }
  });

  it('enables when MCP_HTTP_TOKEN is set', () => {
    process.env.MCP_HTTP_TOKEN = 'secret';
    expect(isMcpEnabled()).toBe(true);
  });

  it('builds mcpUrl on the existing API host (no subdomain)', () => {
    process.env.MCP_HTTP_TOKEN = 'secret';
    process.env.MCP_ADMIN_EMAIL = 'admin@sopet.org';
    process.env.MCP_ADMIN_PASSWORD = 'pw';
    process.env.API_URL = 'https://api.sopet.org';
    process.env.PORT = '3002';

    const config = loadMcpConfig();
    expect(mcpEndpointUrl(config)).toBe('https://api.sopet.org/mcp');
    expect(config.graphqlUrl).toBe('http://127.0.0.1:3002/graphql');
  });
});
