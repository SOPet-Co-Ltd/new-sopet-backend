import { HttpStatus } from '@nestjs/common';

export interface NormalizedError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Derives a stable, client-friendly error code from an HTTP status code.
 * Used so known exceptions surface as e.g. `NOT_FOUND` / `PAYLOAD_TOO_LARGE`
 * instead of collapsing to a generic `INTERNAL_SERVER_ERROR`.
 */
export function codeFromStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'PAYLOAD_TOO_LARGE';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_ERROR';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_SERVER_ERROR' : 'ERROR';
  }
}

/**
 * Extracts an HTTP status from `http-errors`-style errors thrown outside of
 * Nest (e.g. body-parser's `PayloadTooLargeError` carries `status`/`statusCode`).
 */
export function getHttpErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const status =
      typeof candidate.status === 'number'
        ? candidate.status
        : typeof candidate.statusCode === 'number'
          ? candidate.statusCode
          : undefined;
    if (status && status >= 400 && status <= 599) {
      return status;
    }
  }
  return undefined;
}
