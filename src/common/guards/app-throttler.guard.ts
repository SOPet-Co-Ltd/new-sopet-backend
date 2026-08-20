import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getClientIpTracker } from '../../modules/audit-logs/audit-request-context';

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

type ResponseLike = {
  header: (key: string, value: string | number) => void;
};

/**
 * Nest Throttler defaults to HTTP `switchToHttp()`. GraphQL resolvers need the
 * request from `GqlExecutionContext` or `req.ip` is undefined and every query fails.
 *
 * Tracker must use BFF/proxy client IP headers — behind Caddy→Docker, `req.ip` is
 * often `127.0.0.1` for all traffic and a global 120/min bucket takes down the site.
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

      const req: RequestLike = gqlCtx.req ?? { ip: 'unknown', headers: {} };
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

  protected getTracker(req: RequestLike): Promise<string> {
    return Promise.resolve(
      getClientIpTracker(req, req.socket?.remoteAddress?.trim() || 'unknown'),
    );
  }
}
