import { HttpException, HttpStatus } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { QueryFailedError } from 'typeorm';
import { codeFromStatus } from './http-error.util';

export const SAFE_SERVER_MESSAGE = 'An unexpected error occurred. Please try again.';

export interface MappedExceptionResponse {
  status: number;
  code: string;
  /** Internal / log-facing message — not published to clients. */
  message: string;
  details?: unknown;
}

/** Client-facing error shape: `message` is always the stable `code`. */
export interface ClientExceptionResponse {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Maps an internal exception payload to the published API contract.
 * Clients must treat `code` as the only meaning; `message` equals `code`
 * (GraphQL still requires `message`).
 */
export function toClientError(mapped: MappedExceptionResponse): ClientExceptionResponse {
  return {
    status: mapped.status,
    code: mapped.code,
    message: mapped.code,
    ...(mapped.details !== undefined ? { details: mapped.details } : {}),
  };
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
  if (exception instanceof GraphQLError) {
    const extensionCode = exception.extensions?.code;
    if (
      extensionCode === 'BAD_USER_INPUT' ||
      extensionCode === 'GRAPHQL_VALIDATION_FAILED' ||
      extensionCode === 'GRAPHQL_PARSE_FAILED' ||
      extensionCode === 'QUERY_TOO_COMPLEX'
    ) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: String(extensionCode),
        message: exception.message,
      };
    }

    // Complexity plugin / variable coercion without an Apollo code.
    if (
      /Variable "\$/.test(exception.message) ||
      /was not provided/i.test(exception.message) ||
      /exceeds maximum complexity/i.test(exception.message) ||
      /exceeds the maximum complexity/i.test(exception.message)
    ) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_USER_INPUT',
        message: exception.message,
      };
    }
  }

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
