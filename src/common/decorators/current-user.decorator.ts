import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from '../utils/execution-context.util';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = getRequestFromContext(ctx);
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
