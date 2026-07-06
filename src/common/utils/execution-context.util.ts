import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export function getRequestFromContext(context: ExecutionContext): {
  user?: Record<string, unknown>;
  headers?: Record<string, string>;
} {
  if (context.getType<string>() === 'graphql') {
    const gqlContext = GqlExecutionContext.create(context).getContext<{
      req?: { user?: Record<string, unknown>; headers?: Record<string, string> };
    }>();
    return gqlContext.req ?? {};
  }

  return context.switchToHttp().getRequest();
}
