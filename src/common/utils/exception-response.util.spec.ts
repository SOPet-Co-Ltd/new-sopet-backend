import { BadRequestException, ConflictException, HttpStatus } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { QueryFailedError } from 'typeorm';
import {
  SAFE_SERVER_MESSAGE,
  mapException,
  mapUnknownException,
  responseFromHttpException,
  toClientError,
} from './exception-response.util';

describe('exception-response.util', () => {
  it('extracts code and message from HttpException objects for logs', () => {
    const result = responseFromHttpException(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'email' }],
      }),
    );
    expect(result).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [{ field: 'email' }],
    });
  });

  it('maps unique constraint violations to CONFLICT', () => {
    const error = new QueryFailedError('INSERT', [], {
      code: '23505',
    } as never);
    expect(mapUnknownException(error)).toEqual({
      status: HttpStatus.CONFLICT,
      code: 'CONFLICT',
      message: 'This record already exists.',
    });
  });

  it('maps insufficient stock errors to INSUFFICIENT_STOCK', () => {
    expect(mapUnknownException(new Error('Insufficient stock for Dog Food'))).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: 'INSUFFICIENT_STOCK',
      message: 'Insufficient stock for Dog Food',
    });
  });

  it('maps GraphQL missing-variable errors to BAD_USER_INPUT', () => {
    expect(
      mapUnknownException(
        new GraphQLError('Variable "$id" of required type "String!" was not provided.'),
      ),
    ).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: 'BAD_USER_INPUT',
      message: 'Variable "$id" of required type "String!" was not provided.',
    });
  });

  it('maps GraphQLError with BAD_USER_INPUT extension', () => {
    expect(
      mapUnknownException(new GraphQLError('bad', { extensions: { code: 'BAD_USER_INPUT' } })),
    ).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: 'BAD_USER_INPUT',
      message: 'bad',
    });
  });

  it('returns safe internal message for unknown errors', () => {
    const result = mapException(new Error('database connection lost'));
    expect(result.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.message).toBe(SAFE_SERVER_MESSAGE);
    expect(result.message).not.toContain('database connection lost');
  });

  it('preserves ConflictException responses for logs', () => {
    const result = mapException(
      new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Email already registered',
      }),
    );
    expect(result.code).toBe('EMAIL_TAKEN');
    expect(result.message).toBe('Email already registered');
  });

  describe('toClientError', () => {
    it('sets message equal to code and keeps details', () => {
      const client = toClientError({
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'email' }],
      });
      expect(client).toEqual({
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'VALIDATION_ERROR',
        details: [{ field: 'email' }],
      });
    });

    it('never publishes SAFE_SERVER_MESSAGE or domain text to clients', () => {
      const internal = mapException(new Error('database connection lost'));
      const client = toClientError(internal);
      expect(client.message).toBe('INTERNAL_SERVER_ERROR');
      expect(client.message).toBe(client.code);
      expect(client.message).not.toBe(SAFE_SERVER_MESSAGE);
      expect(client.message).not.toContain('database');

      const domain = toClientError(
        mapException(
          new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: 'Insufficient stock for Dog Food',
          }),
        ),
      );
      expect(domain.message).toBe('INSUFFICIENT_STOCK');
      expect(domain.message).not.toContain('Dog Food');
    });
  });
});
