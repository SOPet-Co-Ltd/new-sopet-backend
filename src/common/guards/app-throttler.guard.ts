import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import { readRequestHeader, resolveClientIp } from '../utils/client-ip.util';

export const SESSION_ID_HEADER = 'x-sopet-session-id';

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  body?: {
    variables?: Record<string, unknown>;
  };
  user?: { id?: string; sub?: string };
};

type ResponseLike = {
  header: (key: string, value: string | number) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Decode JWT payload `sub` without verifying — used only as a rate-limit bucket key. */
export function readJwtSubFromAuthorization(authorization: string | null): string | null {
  if (!authorization) {
    return null;
  }
  const value = authorization.trim();
  const token = value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value;
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null;
  } catch {
    return null;
  }
}

export function readSessionIdFromRequest(req: RequestLike): string | null {
  const fromHeader = readRequestHeader(req, SESSION_ID_HEADER);
  if (fromHeader) {
    return fromHeader;
  }

  const variables = req.body?.variables;
  if (!isRecord(variables)) {
    return null;
  }

  if (typeof variables.sessionId === 'string' && variables.sessionId.trim()) {
    return variables.sessionId.trim();
  }

  const input = variables.input;
  if (isRecord(input) && typeof input.sessionId === 'string' && input.sessionId.trim()) {
    return input.sessionId.trim();
  }

  return null;
}

/**
 * Resolve a per-visitor throttle tracker.
 * Order: authenticated user → guest session → visitor IP.
 * Returns null when no stable identity exists (caller must not use a shared "unknown" bucket).
 */
export function resolveThrottleTracker(req: RequestLike | Record<string, unknown>): string | null {
  const request = req as RequestLike;
  const userId =
    (typeof request.user?.id === 'string' && request.user.id.trim()) ||
    (typeof request.user?.sub === 'string' && request.user.sub.trim()) ||
    readJwtSubFromAuthorization(readRequestHeader(request, 'authorization'));
  if (userId) {
    return `user:${userId}`;
  }

  const sessionId = readSessionIdFromRequest(request);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const clientIp = resolveClientIp(request);
  if (clientIp) {
    return `ip:${clientIp}`;
  }

  return null;
}

/**
 * Nest Throttler defaults to HTTP `switchToHttp()`. GraphQL resolvers need the
 * request from `GqlExecutionContext` or `req.ip` is undefined and every query fails.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext): {
    req: RequestLike;
    res: ResponseLike;
  } {
    if (context.getType<string>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context).getContext<{
        req?: RequestLike;
        res?: ResponseLike;
      }>();

      const req: RequestLike = gqlCtx.req ?? { headers: {} };
      const res: ResponseLike = gqlCtx.res ?? {
        header: () => undefined,
      };

      return { req, res };
    }

    return super.getRequestResponse(context) as {
      req: RequestLike;
      res: ResponseLike;
    };
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const tracker = resolveThrottleTracker(req);
    // Empty string signals handleRequest to skip rather than share an "unknown" bucket.
    return Promise.resolve(tracker ?? '');
  }

  protected async handleRequest(
    requestProps: Parameters<ThrottlerGuard['handleRequest']>[0],
  ): Promise<boolean> {
    const { context, getTracker } = requestProps;
    const { req } = this.getRequestResponse(context);
    const tracker = await getTracker(req, context);
    if (!tracker) {
      return true;
    }
    return super.handleRequest(requestProps);
  }
}
