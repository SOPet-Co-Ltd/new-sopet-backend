import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';

/** Guest pay/confirm capability window (covers unpaid pay + later delivery confirm). */
export const GUEST_PAY_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type GuestPayTokenIssue = {
  plaintext: string;
  hash: string;
  expiresAt: Date;
};

export function issueGuestPayToken(
  now: Date = new Date(),
  ttlMs: number = GUEST_PAY_TOKEN_TTL_MS,
): GuestPayTokenIssue {
  const plaintext = randomBytes(32).toString('hex');
  return {
    plaintext,
    hash: hashGuestPayToken(plaintext),
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export function hashGuestPayToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function guestPayTokensMatch(storedHash: string, presentedToken: string): boolean {
  const presentedHash = hashGuestPayToken(presentedToken);
  const stored = Buffer.from(storedHash, 'utf8');
  const presented = Buffer.from(presentedHash, 'utf8');
  if (stored.length !== presented.length) {
    return false;
  }
  return timingSafeEqual(stored, presented);
}

export type GuestPayTokenOrderFields = {
  guestPayTokenHash?: string | null;
  guestPayTokenExpiresAt?: Date | string | null;
};

/**
 * Unauthenticated guest capability check (SOPET-H-07).
 * Legacy unpaid rows with null hash keep UUID-only access until they pay/expire.
 */
export function assertGuestPayTokenAccess(
  order: GuestPayTokenOrderFields,
  guestPayToken?: string | null,
): void {
  if (!order.guestPayTokenHash) {
    return;
  }

  if (!guestPayToken) {
    throw new ForbiddenException({
      code: 'GUEST_PAY_TOKEN_REQUIRED',
      message: 'Guest pay token is required for this order',
    });
  }

  const expiresAt = order.guestPayTokenExpiresAt
    ? new Date(order.guestPayTokenExpiresAt).getTime()
    : NaN;
  if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
    throw new ForbiddenException({
      code: 'GUEST_PAY_TOKEN_EXPIRED',
      message: 'Guest pay token has expired',
    });
  }

  if (!guestPayTokensMatch(order.guestPayTokenHash, guestPayToken)) {
    throw new ForbiddenException({
      code: 'GUEST_PAY_TOKEN_INVALID',
      message: 'Guest pay token is invalid',
    });
  }
}
