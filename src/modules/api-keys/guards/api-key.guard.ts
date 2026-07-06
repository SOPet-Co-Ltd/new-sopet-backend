import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';
import { ApiKeysService } from '../api-keys.service';
import {
  ApiKeyAuthenticatedRequest,
  ApiKeyAuthContext,
} from '../decorators/api-key-auth.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequestFromContext(context) as ApiKeyAuthenticatedRequest & {
      params?: { storeId?: string };
      headers?: Record<string, string | string[] | undefined>;
    };

    const secret = this.extractApiKey(request.headers);
    if (!secret) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Missing API key',
      });
    }

    const storeId = request.params?.storeId;
    if (!storeId) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Missing store ID',
      });
    }

    const apiKey = await this.apiKeysService.verifyAndAuthenticate(secret, storeId);

    const auth: ApiKeyAuthContext = {
      storeId: apiKey.storeId,
      keyId: apiKey.id,
      createdBy: apiKey.createdBy,
    };
    request.apiKeyAuth = auth;

    return true;
  }

  private extractApiKey(headers?: Record<string, string | string[] | undefined>): string | null {
    if (!headers) {
      return null;
    }

    const authorization = headers.authorization ?? headers.Authorization;
    if (typeof authorization === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    const apiKeyHeader = headers['x-api-key'] ?? headers['X-Api-Key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
      return apiKeyHeader.trim();
    }

    return null;
  }
}
