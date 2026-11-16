import type { McpConfig } from '../config';
import type { AuthTokens, Session, SessionRole, SessionStore } from '../auth/session';

export type GraphQlError = {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
};

export class GraphQlRequestError extends Error {
  readonly errors: GraphQlError[];
  readonly status?: number;

  constructor(message: string, errors: GraphQlError[], status?: number) {
    super(message);
    this.name = 'GraphQlRequestError';
    this.errors = errors;
    this.status = status;
  }
}

type LoginPayload = {
  tokens: AuthTokens;
  user: { id: string; email: string; role: string };
};

const ADMIN_LOGIN = `
  mutation AdminLogin($input: VendorLoginInput!) {
    adminLogin(input: $input) {
      tokens { accessToken refreshToken }
      user { id email role }
    }
  }
`;

const VENDOR_LOGIN = `
  mutation VendorLogin($input: VendorLoginInput!) {
    vendorLogin(input: $input) {
      tokens { accessToken refreshToken }
      user { id email role }
    }
  }
`;

const REFRESH = `
  mutation RefreshToken($input: RefreshTokenInput!) {
    refreshToken(input: $input) {
      accessToken
      refreshToken
    }
  }
`;

const SWITCH_STORE = `
  mutation SwitchStore($input: SwitchStoreInput!) {
    switchStore(input: $input) {
      tokens { accessToken refreshToken }
      user { id email role }
    }
  }
`;

export class SopetGraphqlClient {
  constructor(
    private readonly config: McpConfig,
    private readonly sessions: SessionStore,
  ) {}

  async bootstrap(): Promise<void> {
    if (this.config.adminEmail && this.config.adminPassword) {
      const data = await this.rawRequest<{ adminLogin: LoginPayload }>(ADMIN_LOGIN, {
        input: { email: this.config.adminEmail, password: this.config.adminPassword },
      });
      this.sessions.set({
        role: 'admin',
        tokens: data.adminLogin.tokens,
        userId: data.adminLogin.user.id,
        email: data.adminLogin.user.email,
      });
    }

    if (this.config.vendorEmail && this.config.vendorPassword) {
      const data = await this.rawRequest<{ vendorLogin: LoginPayload }>(VENDOR_LOGIN, {
        input: { email: this.config.vendorEmail, password: this.config.vendorPassword },
      });
      let tokens = data.vendorLogin.tokens;
      const storeId = this.config.vendorStoreId;

      if (storeId) {
        const switched = await this.rawRequest<{ switchStore: LoginPayload }>(
          SWITCH_STORE,
          { input: { storeId } },
          tokens.accessToken,
        );
        tokens = switched.switchStore.tokens;
      }

      this.sessions.set({
        role: 'vendor',
        tokens,
        storeId,
        userId: data.vendorLogin.user.id,
        email: data.vendorLogin.user.email,
      });
    }
  }

  async request<T>(
    role: SessionRole,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const session = this.sessions.require(role);
    try {
      return await this.rawRequest<T>(query, variables, session.tokens.accessToken);
    } catch (error) {
      if (!isUnauthorized(error)) {
        throw error;
      }
      await this.refresh(role);
      const refreshed = this.sessions.require(role);
      return this.rawRequest<T>(query, variables, refreshed.tokens.accessToken);
    }
  }

  async admin<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.request<T>('admin', query, variables);
  }

  async vendor<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.request<T>('vendor', query, variables);
  }

  /**
   * Admin store ops use the admin JWT. Vendor ops use the vendor JWT and force session storeId.
   */
  async forStoreRole<T>(
    preferredRole: SessionRole,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    if (preferredRole === 'admin') {
      return this.admin<T>(query, variables);
    }
    const session = this.sessions.require('vendor');
    const locked = { ...variables };
    if (session.storeId) {
      locked.storeId = session.storeId;
    }
    return this.vendor<T>(query, locked);
  }

  private async refresh(role: SessionRole): Promise<void> {
    const session = this.sessions.require(role);
    const data = await this.rawRequest<{ refreshToken: AuthTokens }>(REFRESH, {
      input: { refreshToken: session.tokens.refreshToken },
    });
    this.sessions.updateTokens(role, data.refreshToken);
  }

  private async rawRequest<T>(
    query: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(this.config.graphqlUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const json = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: GraphQlError[];
    };

    if (!response.ok) {
      throw new GraphQlRequestError(
        `GraphQL HTTP ${response.status}`,
        json.errors ?? [{ message: response.statusText }],
        response.status,
      );
    }

    if (json.errors?.length) {
      const code = json.errors[0]?.extensions?.code;
      throw new GraphQlRequestError(
        json.errors.map((e) => e.message).join('; '),
        json.errors,
        code === 'UNAUTHENTICATED' || code === 'UNAUTHORIZED' ? 401 : undefined,
      );
    }

    if (json.data === undefined) {
      throw new GraphQlRequestError('Empty GraphQL response', []);
    }

    return json.data;
  }
}

function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof GraphQlRequestError &&
    (error.status === 401 ||
      error.errors.some(
        (e) => e.extensions?.code === 'UNAUTHENTICATED' || e.extensions?.code === 'UNAUTHORIZED',
      ))
  );
}

export type ToolContext = {
  config: McpConfig;
  sessions: SessionStore;
  gql: SopetGraphqlClient;
  /** Prefer admin when both sessions exist for store tools. */
  resolveStoreActor(): SessionRole;
};

export function createToolContext(
  config: McpConfig,
  sessions: SessionStore,
  gql: SopetGraphqlClient,
): ToolContext {
  return {
    config,
    sessions,
    gql,
    resolveStoreActor(): SessionRole {
      if (sessions.has('admin')) return 'admin';
      if (sessions.has('vendor')) return 'vendor';
      throw new Error('No authenticated session');
    },
  };
}

export type { Session };
