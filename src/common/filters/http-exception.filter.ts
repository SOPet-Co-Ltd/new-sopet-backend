import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { codeFromStatus, getHttpErrorStatus } from '../utils/http-error.util';
import { mapException, toClientError } from '../utils/exception-response.util';
import { reportServerError } from '../utils/report-server-error.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType<string>() === 'graphql') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let mapped = mapException(exception);

    if (exception instanceof HttpException) {
      mapped = mapException(exception);
    } else if (getHttpErrorStatus(exception) !== undefined) {
      const status = getHttpErrorStatus(exception)!;
      const internalMessage = (exception as Error).message || 'Internal server error';
      mapped = {
        status,
        code: codeFromStatus(status),
        message: internalMessage,
      };
    } else {
      mapped = mapException(exception);
    }

    if (mapped.status >= 500) {
      reportServerError({
        code: mapped.code,
        message:
          exception instanceof Error
            ? exception.message
            : typeof mapped.message === 'string'
              ? mapped.message
              : 'Internal server error',
        stack: exception instanceof Error ? exception.stack : undefined,
        requestId: request?.requestId,
      });
    }

    const client = toClientError(mapped);

    const errorResponse = {
      success: false,
      error: {
        code: client.code,
        message: client.message,
        ...(client.details !== undefined ? { details: client.details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request?.url ?? '/',
        method: request?.method ?? 'UNKNOWN',
      },
    };

    response.status(client.status).json(errorResponse);
  }
}
