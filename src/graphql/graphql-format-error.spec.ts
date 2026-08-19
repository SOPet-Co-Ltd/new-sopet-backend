import { BadRequestException, HttpException } from '@nestjs/common';
import { unwrapResolverError } from '@apollo/server/errors';
import type { GraphQLFormattedError } from 'graphql';
import {
  SAFE_SERVER_MESSAGE,
  mapException,
  mapUnknownException,
  responseFromHttpException,
  toClientError,
} from '../common/utils/exception-response.util';

/**
 * Mirrors `AppGraphqlModule` formatError so unit tests lock the client contract
 * without bootstrapping Apollo.
 */
function formatGraphqlError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const originalError = unwrapResolverError(error);

  const mapped =
    originalError instanceof HttpException
      ? responseFromHttpException(originalError)
      : (mapUnknownException(originalError) ?? mapException(originalError));

  const client = toClientError(mapped);
  return {
    ...formattedError,
    message: client.message,
    extensions: {
      ...formattedError.extensions,
      code: client.code,
      ...(client.details ? { details: client.details } : {}),
    },
  };
}

describe('GraphQL formatError client contract', () => {
  const base: GraphQLFormattedError = { message: 'ignored' };

  it('sets GraphQL message to the error code', () => {
    const httpError = new BadRequestException({
      code: 'GUEST_PHONE_REQUIRED',
      message: 'Guest checkout requires guestPhone',
    });
    const result = formatGraphqlError(base, httpError);

    expect(result.message).toBe('GUEST_PHONE_REQUIRED');
    expect(result.extensions?.code).toBe('GUEST_PHONE_REQUIRED');
    expect(result.message).toBe(result.extensions?.code);
    expect(result.message).not.toContain('guestPhone');
  });

  it('does not publish SAFE_SERVER_MESSAGE for unknown errors', () => {
    const result = formatGraphqlError(base, new Error('secret stack detail'));

    expect(result.message).toBe('INTERNAL_SERVER_ERROR');
    expect(result.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.message).not.toBe(SAFE_SERVER_MESSAGE);
    expect(result.message).not.toContain('secret');
  });
});
