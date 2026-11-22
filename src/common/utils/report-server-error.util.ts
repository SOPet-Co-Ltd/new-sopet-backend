import { Logger } from '@nestjs/common';

const logger = new Logger('ServerError');

export type ServerErrorReport = {
  code: string;
  message: string;
  stack?: string;
  requestId?: string;
  operationName?: string;
};

/**
 * Emit one JSON line for CloudWatch metric filters / alarms.
 * Do not include tokens, phone numbers, or request bodies.
 */
export function reportServerError(report: ServerErrorReport): void {
  logger.error(
    JSON.stringify({
      level: 'error',
      code: report.code,
      message: report.message,
      ...(report.stack ? { stack: report.stack } : {}),
      ...(report.requestId ? { requestId: report.requestId } : {}),
      ...(report.operationName ? { operationName: report.operationName } : {}),
    }),
  );
}
