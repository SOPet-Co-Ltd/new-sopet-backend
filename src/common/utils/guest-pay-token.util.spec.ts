import { ForbiddenException } from '@nestjs/common';
import {
  assertGuestPayTokenAccess,
  guestPayTokensMatch,
  hashGuestPayToken,
  issueGuestPayToken,
} from './guest-pay-token.util';

describe('guest-pay-token.util', () => {
  it('issues a 64-char hex plaintext and matching SHA-256 hash', () => {
    const issued = issueGuestPayToken(new Date('2026-08-21T00:00:00.000Z'));
    expect(issued.plaintext).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.hash).toBe(hashGuestPayToken(issued.plaintext));
    expect(issued.expiresAt.toISOString()).toBe('2026-11-19T00:00:00.000Z');
  });

  it('matches presented plaintext against stored hash', () => {
    const issued = issueGuestPayToken();
    expect(guestPayTokensMatch(issued.hash, issued.plaintext)).toBe(true);
    expect(guestPayTokensMatch(issued.hash, '0'.repeat(64))).toBe(false);
  });

  it('allows legacy orders with null hash without a token', () => {
    expect(() =>
      assertGuestPayTokenAccess({ guestPayTokenHash: null, guestPayTokenExpiresAt: null }),
    ).not.toThrow();
  });

  it('requires a valid non-expired token when a hash is stored', () => {
    const issued = issueGuestPayToken();
    expect(() =>
      assertGuestPayTokenAccess(
        { guestPayTokenHash: issued.hash, guestPayTokenExpiresAt: issued.expiresAt },
        undefined,
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertGuestPayTokenAccess(
        { guestPayTokenHash: issued.hash, guestPayTokenExpiresAt: issued.expiresAt },
        '0'.repeat(64),
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertGuestPayTokenAccess(
        {
          guestPayTokenHash: issued.hash,
          guestPayTokenExpiresAt: new Date(Date.now() - 1_000),
        },
        issued.plaintext,
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertGuestPayTokenAccess(
        { guestPayTokenHash: issued.hash, guestPayTokenExpiresAt: issued.expiresAt },
        issued.plaintext,
      ),
    ).not.toThrow();
  });
});
