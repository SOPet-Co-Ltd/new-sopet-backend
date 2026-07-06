import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';

export interface ApiKeyAuthContext {
  storeId: string;
  keyId: string;
  createdBy: string;
}

export type ApiKeyAuthenticatedRequest = {
  apiKeyAuth?: ApiKeyAuthContext;
};

export const ApiKeyAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyAuthContext => {
    const request = getRequestFromContext(ctx) as ApiKeyAuthenticatedRequest;
    if (!request.apiKeyAuth) {
      throw new Error('ApiKeyAuth decorator used without ApiKeyGuard');
    }
    return request.apiKeyAuth;
  },
);
