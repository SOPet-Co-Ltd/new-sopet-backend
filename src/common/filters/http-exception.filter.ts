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
import { mapException } from '../utils/exception-response.util';

const PAYLOAD_TOO_LARGE_MESSAGE = 'ไฟล์หรือข้อมูลที่อัปโหลดมีขนาดใหญ่เกินไป';

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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      const mapped = mapException(exception);
      status = mapped.status;
      message = mapped.message;
      code = mapped.code;
      details = mapped.details;
    } else if (getHttpErrorStatus(exception) !== undefined) {
      status = getHttpErrorStatus(exception)!;
      message = (exception as Error).message || message;
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`Unhandled exception: ${message}`, (exception as Error).stack);
      }
    } else {
      const mapped = mapException(exception);
      status = mapped.status;
      message = mapped.message;
      code = mapped.code;
      details = mapped.details;

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `Unhandled exception: ${(exception as Error).message ?? 'unknown'}`,
          (exception as Error).stack,
        );
      }
    }

    const hasExplicitCode = code !== undefined;
    code = code ?? codeFromStatus(status);

    if (status === HttpStatus.PAYLOAD_TOO_LARGE && !hasExplicitCode) {
      message = PAYLOAD_TOO_LARGE_MESSAGE;
    }

    const errorResponse = {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request?.url ?? '/',
        method: request?.method ?? 'UNKNOWN',
      },
    };

    response.status(status).json(errorResponse);
  }
}
