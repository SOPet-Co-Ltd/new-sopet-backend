import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { StoreApiKey } from '../../database/entities/store-api-key.entity';
import { StoreStatus } from '../../database/entities/store.entity';
import { StoresService } from '../stores/stores.service';

const KEY_PREFIX = 'sopet_sk_';
const KEY_RANDOM_BYTES = 32;
const KEY_PREFIX_LENGTH = 24;
const BCRYPT_ROUNDS = 10;

export interface CreateStoreApiKeyResult {
  apiKey: StoreApiKey;
  secret: string;
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(StoreApiKey)
    private readonly apiKeyRepository: Repository<StoreApiKey>,
    private readonly storesService: StoresService,
  ) {}

  async create(userId: string, storeId: string, name: string): Promise<CreateStoreApiKeyResult> {
    await this.storesService.assertStoreManager(userId, storeId);

    const secret = `${KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString('hex')}`;
    const keyHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);

    const apiKey = await this.apiKeyRepository.save(
      this.apiKeyRepository.create({
        storeId,
        name,
        keyPrefix,
        keyHash,
        createdBy: userId,
      }),
    );

    return { apiKey, secret };
  }

  async listForStore(userId: string, storeId: string): Promise<StoreApiKey[]> {
    await this.storesService.assertStoreManager(userId, storeId);

    return this.apiKeyRepository.find({
      where: { storeId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(userId: string, storeId: string, keyId: string): Promise<void> {
    await this.storesService.assertStoreManager(userId, storeId);

    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: keyId, storeId, revokedAt: IsNull() },
    });

    if (!apiKey) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'API key not found',
      });
    }

    apiKey.revokedAt = new Date();
    await this.apiKeyRepository.save(apiKey);
  }

  async verifyAndAuthenticate(secret: string, storeId: string): Promise<StoreApiKey> {
    if (!secret || secret.length < KEY_PREFIX_LENGTH) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      });
    }

    const store = await this.storesService.findOne(storeId);
    if (store.status !== StoreStatus.APPROVED) {
      throw new ForbiddenException({
        code: 'STORE_SUSPENDED',
        message: 'Store is not approved or is suspended',
      });
    }

    const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
    const candidates = await this.apiKeyRepository.find({
      where: { storeId, keyPrefix, revokedAt: IsNull() },
    });

    for (const candidate of candidates) {
      const matches = await bcrypt.compare(secret, candidate.keyHash);
      if (matches) {
        candidate.lastUsedAt = new Date();
        await this.apiKeyRepository.save(candidate);
        return candidate;
      }
    }

    throw new UnauthorizedException({
      code: 'INVALID_API_KEY',
      message: 'Invalid API key',
    });
  }
}
