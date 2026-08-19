import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { codeFromStatus, getHttpErrorStatus } from '../utils/http-error.util';
import { mapException, toClientError } from '../utils/exception-response.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType<string>() === 'graphql') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let mapped = mapException(exception);

    if (exception instanceof HttpException) {
      mapped = mapException(exception);
    } else if (getHttpErrorStatus(exception) !== undefined) {
      const status = getHttpErrorStatus(exception)!;
      const internalMessage = (exception as Error).message || 'Internal server error';
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`Unhandled exception: ${internalMessage}`, (exception as Error).stack);
      }
      mapped = {
        status,
        code: codeFromStatus(status),
        message: internalMessage,
      };
    } else {
      mapped = mapException(exception);
      if (mapped.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `Unhandled exception: ${(exception as Error).message ?? 'unknown'}`,
          (exception as Error).stack,
        );
      }
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
