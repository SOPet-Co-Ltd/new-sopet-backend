import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { SAFE_SERVER_MESSAGE } from '../utils/exception-response.util';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  function createHost(url = '/api/v1/stores/1/products', method = 'GET') {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { url, method };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it('publishes REST error.message equal to error.code', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new BadRequestException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'PRODUCT_NOT_FOUND',
        },
      }),
    );
    const body = json.mock.calls[0][0];
    expect(body.error.message).toBe(body.error.code);
    expect(body.error.message).not.toBe('Product not found');
  });

  it('keeps details and does not leak SAFE_SERVER_MESSAGE on unknown errors', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'sku' }],
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'VALIDATION_ERROR',
          details: [{ field: 'sku' }],
        },
      }),
    );

    const { host: host500, status: status500, json: json500 } = createHost();
    const errorSpy = jest.spyOn((filter as unknown as { logger: { error: unknown } }).logger, 'error').mockImplementation();
    filter.catch(new Error('database connection lost'), host500);
    errorSpy.mockRestore();

    expect(status500).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json500.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).not.toBe(SAFE_SERVER_MESSAGE);
    expect(body.error.message).not.toContain('database');
  });

  it('rethrows GraphQL host exceptions for formatError', () => {
    const host = {
      getType: () => 'graphql',
    } as unknown as ArgumentsHost;
    const err = new BadRequestException({ code: 'FORBIDDEN', message: 'Nope' });
    expect(() => filter.catch(err, host)).toThrow(err);
  });
});
