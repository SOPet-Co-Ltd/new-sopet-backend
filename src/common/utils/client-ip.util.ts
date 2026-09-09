const CLIENT_IP_HEADER = 'x-sopet-client-ip';
const VERCEL_FORWARDED_FOR_HEADER = 'x-vercel-forwarded-for';
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';
const IP_ADDRESS_MAX_LENGTH = 45;

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

function firstHop(value: string | null): string | null {
  const hop = value?.split(',')[0]?.trim() ?? '';
  return hop || null;
}

/**
 * Prefer the BFF-stamped visitor IP. Cloudflare in front of the API often
 * rewrites x-forwarded-for / req.ip to the Vercel serverless egress address.
 */
export function resolveClientIp(req: unknown): string | null {
  if (!isRecord(req)) {
    return null;
  }

  const headers = req.headers;
  const raw =
    firstHop(readHeader(headers, CLIENT_IP_HEADER)) ??
    firstHop(readHeader(headers, VERCEL_FORWARDED_FOR_HEADER)) ??
    firstHop(readHeader(headers, REAL_IP_HEADER)) ??
    firstHop(readHeader(headers, FORWARDED_FOR_HEADER)) ??
    (typeof req.ip === 'string' ? req.ip.trim() || null : null) ??
    (isRecord(req.socket) && typeof req.socket.remoteAddress === 'string'
      ? req.socket.remoteAddress.trim() || null
      : null);

  if (raw == null) {
    return null;
  }
  return raw.slice(0, IP_ADDRESS_MAX_LENGTH);
}

export function readRequestHeader(req: unknown, name: string): string | null {
  if (!isRecord(req)) {
    return null;
  }
  return readHeader(req.headers, name);
}
