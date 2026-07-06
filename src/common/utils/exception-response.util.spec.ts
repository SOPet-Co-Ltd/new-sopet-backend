import { BadRequestException, ConflictException, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  mapException,
  mapUnknownException,
  responseFromHttpException,
} from './exception-response.util';

describe('exception-response.util', () => {
  it('extracts code and message from HttpException objects', () => {
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

  it('returns safe message for unknown errors', () => {
    const result = mapException(new Error('database connection lost'));
    expect(result.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.message).not.toContain('database connection lost');
  });

  it('preserves ConflictException responses', () => {
    const result = mapException(
      new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Email already registered',
      }),
    );
    expect(result.code).toBe('EMAIL_TAKEN');
    expect(result.message).toBe('Email already registered');
  });
});
