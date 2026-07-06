import { HttpException, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { codeFromStatus } from './http-error.util';

export const SAFE_SERVER_MESSAGE = 'An unexpected error occurred. Please try again.';

export interface MappedExceptionResponse {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function responseFromHttpException(exception: HttpException): MappedExceptionResponse {
  const status = exception.getStatus();
  const exceptionResponse = exception.getResponse();
  let message = exception.message;
  let code = codeFromStatus(status);
  let details: unknown;

  if (typeof exceptionResponse === 'string') {
    message = exceptionResponse;
  } else if (exceptionResponse && typeof exceptionResponse === 'object') {
    const responseObj = exceptionResponse as {
      message?: string | string[];
      code?: string;
      details?: unknown;
    };
    if (Array.isArray(responseObj.message)) {
      message = responseObj.message.join(', ');
    } else if (responseObj.message) {
      message = responseObj.message;
    }
    if (responseObj.code) {
      code = responseObj.code;
    }
    details = responseObj.details;
  }

  return { status, code, message, details };
}

/**
 * Maps TypeORM / domain `Error` throws to stable HTTP codes so clients never
 * see an opaque INTERNAL_SERVER_ERROR for known failure modes.
 */
export function mapUnknownException(exception: unknown): MappedExceptionResponse | null {
  if (exception instanceof QueryFailedError) {
    const driverError = exception.driverError as { code?: string };
    if (driverError?.code === '23505') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'This record already exists.',
      };
    }
    if (driverError?.code === '23503') {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'Related record not found.',
      };
    }
  }

  if (exception instanceof Error) {
    const message = exception.message;
    if (/insufficient stock/i.test(message)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INSUFFICIENT_STOCK',
        message,
      };
    }
    if (/variant .* not found/i.test(message) || message === 'Variant not found') {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Product variant not found.',
      };
    }
  }

  return null;
}

export function mapException(exception: unknown): MappedExceptionResponse {
  if (exception instanceof HttpException) {
    return responseFromHttpException(exception);
  }

  const mapped = mapUnknownException(exception);
  if (mapped) {
    return mapped;
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: SAFE_SERVER_MESSAGE,
  };
}
