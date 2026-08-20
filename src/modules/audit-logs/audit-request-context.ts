import { randomUUID } from 'node:crypto';

export type AuditRequestContext = {
  requestId: string | null;
  ipAddress: string | null;
};

const REQUEST_ID_MAX_LENGTH = 64;
const IP_ADDRESS_MAX_LENGTH = 45;
const REQUEST_ID_HEADER = 'x-request-id';
const CLIENT_IP_HEADER = 'x-sopet-client-ip';
const VERCEL_FORWARDED_FOR_HEADER = 'x-vercel-forwarded-for';
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHeaderValue(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0].trim() || null : null;
  }
  if (typeof raw === 'string') {
    return raw.trim() || null;
  }
  return null;
}

function readHeader(headers: unknown, name: string): string | null {
  if (!isRecord(headers)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(headers, name)) {
    return normalizeHeaderValue(headers[name]);
  }
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match ? normalizeHeaderValue(match[1]) : null;
}

function sliceOrNull(value: string | null, maxLength: number): string | null {
  if (value == null) {
    return null;
  }
  return value.slice(0, maxLength);
}

function firstHop(value: string | null): string | null {
  const hop = value?.split(',')[0]?.trim() ?? '';
  return hop || null;
}

/**
 * Prefer the BFF-stamped visitor IP. Cloudflare in front of the API often
 * rewrites x-forwarded-for / req.ip to the Vercel serverless egress address
 * (commonly iad1 / Virginia).
 *
 * Exported for rate-limit / throttler trackers (must not key only on Docker/Caddy
 * loopback `req.ip` when the real visitor IP is in forwarded headers).
 */
export function readClientIp(req: Record<string, unknown>): string | null {
  const headers = req.headers;
  return (
    firstHop(readHeader(headers, CLIENT_IP_HEADER)) ??
    firstHop(readHeader(headers, VERCEL_FORWARDED_FOR_HEADER)) ??
    firstHop(readHeader(headers, REAL_IP_HEADER)) ??
    firstHop(readHeader(headers, FORWARDED_FOR_HEADER)) ??
    (typeof req.ip === 'string' ? req.ip.trim() || null : null)
  );
}

/** Rate-limit / throttle tracker string (never empty). */
export function getClientIpTracker(req: unknown, fallback = 'unknown'): string {
  if (!isRecord(req)) {
    return fallback;
  }
  return sliceOrNull(readClientIp(req), IP_ADDRESS_MAX_LENGTH) || fallback;
}

/**
 * GraphQL-safe request id / client IP from context `req`.
 * Does not use HTTP-only RequestIdInterceptor / switchToHttp.
 */
export function getAuditRequestContext(req: unknown): AuditRequestContext {
  try {
    if (!isRecord(req)) {
      return { requestId: null, ipAddress: null };
    }

    const existingId = typeof req.requestId === 'string' ? req.requestId.trim() : '';
    const headerId = readHeader(req.headers, REQUEST_ID_HEADER);
    let requestId = sliceOrNull(existingId || headerId, REQUEST_ID_MAX_LENGTH);

    if (requestId == null) {
      requestId = randomUUID().slice(0, REQUEST_ID_MAX_LENGTH);
      req.requestId = requestId;
    }

    const ipAddress = sliceOrNull(readClientIp(req), IP_ADDRESS_MAX_LENGTH);

    return { requestId, ipAddress };
  } catch {
    return { requestId: null, ipAddress: null };
  }
}
