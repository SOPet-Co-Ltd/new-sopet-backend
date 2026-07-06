import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService } from '../api-keys.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let apiKeysService: { verifyAndAuthenticate: jest.Mock };

  function contextFor(options: {
    headers?: Record<string, string>;
    storeId?: string;
  }): ExecutionContext {
    const request = {
      headers: options.headers ?? {},
      params: { storeId: options.storeId },
    };

    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    apiKeysService = {
      verifyAndAuthenticate: jest.fn(),
    };
    guard = new ApiKeyGuard(apiKeysService as unknown as ApiKeysService);
  });

  it('returns 401 when the API key header is missing', async () => {
    await expect(
      guard.canActivate(contextFor({ storeId: 'store-1', headers: {} })),
    ).rejects.toThrow(UnauthorizedException);

    expect(apiKeysService.verifyAndAuthenticate).not.toHaveBeenCalled();
  });

  it('returns 401 when the store does not match the key', async () => {
    apiKeysService.verifyAndAuthenticate.mockRejectedValue(
      new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      }),
    );

    await expect(
      guard.canActivate(
        contextFor({
          storeId: 'store-2',
          headers: { authorization: 'Bearer sopet_sk_test' },
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(apiKeysService.verifyAndAuthenticate).toHaveBeenCalledWith('sopet_sk_test', 'store-2');
  });

  it('accepts Authorization Bearer and attaches auth context', async () => {
    apiKeysService.verifyAndAuthenticate.mockResolvedValue({
      id: 'key-1',
      storeId: 'store-1',
      createdBy: 'user-1',
    });

    const request = {
      headers: { authorization: 'Bearer sopet_sk_valid' },
      params: { storeId: 'store-1' },
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toEqual(
      expect.objectContaining({
        apiKeyAuth: {
          storeId: 'store-1',
          keyId: 'key-1',
          createdBy: 'user-1',
        },
      }),
    );
  });

  it('accepts X-Api-Key header', async () => {
    apiKeysService.verifyAndAuthenticate.mockResolvedValue({
      id: 'key-1',
      storeId: 'store-1',
      createdBy: 'user-1',
    });

    await expect(
      guard.canActivate(
        contextFor({
          storeId: 'store-1',
          headers: { 'x-api-key': 'sopet_sk_valid' },
        }),
      ),
    ).resolves.toBe(true);

    expect(apiKeysService.verifyAndAuthenticate).toHaveBeenCalledWith('sopet_sk_valid', 'store-1');
  });
});
