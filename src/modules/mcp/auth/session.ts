export type SessionRole = 'admin' | 'vendor';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type Session = {
  role: SessionRole;
  tokens: AuthTokens;
  storeId?: string;
  userId?: string;
  email?: string;
};

export class SessionStore {
  private admin?: Session;
  private vendor?: Session;

  set(session: Session): void {
    if (session.role === 'admin') {
      this.admin = session;
    } else {
      this.vendor = session;
    }
  }

  get(role: SessionRole): Session | undefined {
    return role === 'admin' ? this.admin : this.vendor;
  }

  require(role: SessionRole): Session {
    const session = this.get(role);
    if (!session) {
      throw new Error(`No ${role} session. Set SOPET_${role.toUpperCase()}_EMAIL/PASSWORD.`);
    }
    return session;
  }

  has(role: SessionRole): boolean {
    return Boolean(this.get(role));
  }

  vendorStoreId(): string | undefined {
    return this.vendor?.storeId;
  }

  updateTokens(role: SessionRole, tokens: AuthTokens): void {
    const session = this.require(role);
    session.tokens = tokens;
  }
}
