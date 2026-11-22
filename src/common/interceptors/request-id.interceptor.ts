import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { readRequestHeader } from '../utils/client-ip.util';

type RequestWithId = {
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
};

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = this.resolveRequest(context);
    const incoming = readRequestHeader(req, 'x-request-id');
    const requestId = incoming || randomUUID();
    req.requestId = requestId;

    return next.handle().pipe(
      tap(() => {
        if (context.getType<string>() === 'graphql') {
          return;
        }
        const response = context.switchToHttp().getResponse<{
          setHeader?: (key: string, value: string) => void;
        }>();
        response.setHeader?.('X-Request-Id', requestId);
      }),
    );
  }

  private resolveRequest(context: ExecutionContext): RequestWithId {
    if (context.getType<string>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context).getContext<{ req?: RequestWithId }>();
      const req = gqlCtx.req ?? { headers: {} };
      gqlCtx.req = req;
      return req;
    }

    return context.switchToHttp().getRequest<RequestWithId>();
  }
}
