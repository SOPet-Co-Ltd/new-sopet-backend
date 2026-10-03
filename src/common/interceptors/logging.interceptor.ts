import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now();

    if (context.getType<string>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const info = gqlCtx.getInfo<{
        fieldName?: string;
        operation?: { name?: { value?: string } };
      }>();
      const req = gqlCtx.getContext<{ req?: { requestId?: string } }>().req;
      const operationName = info.operation?.name?.value || info.fieldName || 'anonymous';
      const requestId = req?.requestId ?? '-';

      this.logger.log(`Incoming GraphQL: ${operationName} requestId=${requestId}`);

      return next.handle().pipe(
        tap({
          next: () => {
            this.logger.log(
              `Outgoing GraphQL: ${operationName} requestId=${requestId} ${Date.now() - now}ms`,
            );
          },
          error: (error: Error) => {
            this.logger.error(
              `Error GraphQL: ${operationName} requestId=${requestId} ${Date.now() - now}ms - ${error.message}`,
            );
          },
        }),
      );
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      ip?: string;
      requestId?: string;
      get?: (name: string) => string | undefined;
    }>();
    const { method, url } = request;
    const userAgent = request.get?.('user-agent') || '';
    const ip = request.ip;
    const requestId = request.requestId ?? '-';

    this.logger.log(
      `Incoming Request: ${method} ${url} - IP: ${ip} - User Agent: ${userAgent} requestId=${requestId}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const responseTime = Date.now() - now;
          this.logger.log(
            `Outgoing Response: ${method} ${url} - ${responseTime}ms requestId=${requestId}`,
          );
        },
        error: (error: Error) => {
          const responseTime = Date.now() - now;
          this.logger.error(
            `Error Response: ${method} ${url} - ${responseTime}ms requestId=${requestId} - ${error.message}`,
          );
        },
      }),
    );
  }
}
