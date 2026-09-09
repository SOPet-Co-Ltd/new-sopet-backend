import { randomUUID } from 'node:crypto';
import { readRequestHeader, resolveClientIp } from '../../common/utils/client-ip.util';

export type AuditRequestContext = {
  requestId: string | null;
  ipAddress: string | null;
};

const REQUEST_ID_MAX_LENGTH = 64;
const REQUEST_ID_HEADER = 'x-request-id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sliceOrNull(value: string | null, maxLength: number): string | null {
  if (value == null) {
    return null;
  }
  return value.slice(0, maxLength);
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
    const headerId = readRequestHeader(req, REQUEST_ID_HEADER);
    let requestId = sliceOrNull(existingId || headerId, REQUEST_ID_MAX_LENGTH);

    if (requestId == null) {
      requestId = randomUUID().slice(0, REQUEST_ID_MAX_LENGTH);
      req.requestId = requestId;
    }

    const ipAddress = resolveClientIp(req);

    return { requestId, ipAddress };
  } catch {
    return { requestId: null, ipAddress: null };
  }
}
