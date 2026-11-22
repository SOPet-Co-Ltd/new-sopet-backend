import { Logger } from '@nestjs/common';
import { reportServerError } from './report-server-error.util';

describe('reportServerError', () => {
  it('logs a single JSON object with level and code', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    reportServerError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'boom',
      stack: 'Error: boom',
      requestId: 'req-1',
      operationName: 'CreatePayment',
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toEqual({
      level: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'boom',
      stack: 'Error: boom',
      requestId: 'req-1',
      operationName: 'CreatePayment',
    });

    errorSpy.mockRestore();
  });
});
