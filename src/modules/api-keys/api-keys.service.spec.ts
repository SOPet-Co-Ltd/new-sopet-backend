import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ApiKeysService } from './api-keys.service';
import { StoreStatus } from '../../database/entities/store.entity';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let apiKeyRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let storesService: {
    assertStoreManager: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    apiKeyRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({
        ...data,
        id: data.id ?? 'key-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        lastUsedAt: null,
        revokedAt: null,
      })),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    storesService = {
      assertStoreManager: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({
        id: 'store-1',
        status: StoreStatus.APPROVED,
      }),
    };

    service = new ApiKeysService(apiKeyRepository as never, storesService as never);
  });

  it('creates a hashed key and returns the secret once', async () => {
    const result = await service.create('user-1', 'store-1', 'Integration');

    expect(storesService.assertStoreManager).toHaveBeenCalledWith('user-1', 'store-1');
    expect(result.secret).toMatch(/^sopet_sk_[0-9a-f]{64}$/);
    expect(result.apiKey.keyHash).toBeDefined();
    expect(result.apiKey.keyHash).not.toBe(result.secret);
    expect(result.apiKey.keyPrefix).toBe(result.secret.slice(0, 24));
    expect(await bcrypt.compare(result.secret, result.apiKey.keyHash)).toBe(true);
    expect(apiKeyRepository.save).toHaveBeenCalled();
  });

  it('verifies a valid key and updates lastUsedAt', async () => {
    const secret = 'sopet_sk_' + 'a'.repeat(64);
    const keyHash = await bcrypt.hash(secret, 10);
    const apiKey = {
      id: 'key-1',
      storeId: 'store-1',
      keyPrefix: secret.slice(0, 24),
      keyHash,
      createdBy: 'user-1',
      revokedAt: null,
    };

    apiKeyRepository.find.mockResolvedValue([apiKey]);

    const result = await service.verifyAndAuthenticate(secret, 'store-1');

    expect(result.id).toBe('key-1');
    expect(apiKeyRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedAt: expect.any(Date) }),
    );
  });

  it('rejects revoked keys', async () => {
    const secret = 'sopet_sk_' + 'b'.repeat(64);
    apiKeyRepository.find.mockResolvedValue([]);

    await expect(service.verifyAndAuthenticate(secret, 'store-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects suspended stores', async () => {
    storesService.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.SUSPENDED,
    });

    await expect(
      service.verifyAndAuthenticate('sopet_sk_' + 'c'.repeat(64), 'store-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('revokes an active key', async () => {
    apiKeyRepository.findOne.mockResolvedValue({
      id: 'key-1',
      storeId: 'store-1',
      revokedAt: null,
    });

    await service.revoke('user-1', 'store-1', 'key-1');

    expect(apiKeyRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('throws when revoking a missing key', async () => {
    apiKeyRepository.findOne.mockResolvedValue(null);

    await expect(service.revoke('user-1', 'store-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
