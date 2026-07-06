import { Args, Mutation, Query, Resolver, ObjectType, Field } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { StoreApiKey } from '../../database/entities/store-api-key.entity';

@ObjectType()
export class StoreApiKeyType {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field()
  keyPrefix: string;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  lastUsedAt: Date | null;

  @Field(() => Date, { nullable: true })
  revokedAt: Date | null;
}

@ObjectType()
export class CreateStoreApiKeyPayload {
  @Field(() => StoreApiKeyType)
  apiKey: StoreApiKeyType;

  @Field()
  secret: string;
}

function mapStoreApiKey(apiKey: StoreApiKey): StoreApiKeyType {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  };
}

@Resolver()
export class ApiKeysResolver {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Mutation(() => CreateStoreApiKeyPayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createStoreApiKey(
    @Args('storeId') storeId: string,
    @Args('name') name: string,
    @CurrentUser('id') userId: string,
  ): Promise<CreateStoreApiKeyPayload> {
    const { apiKey, secret } = await this.apiKeysService.create(userId, storeId, name);
    return {
      apiKey: mapStoreApiKey(apiKey),
      secret,
    };
  }

  @Query(() => [StoreApiKeyType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeApiKeys(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreApiKeyType[]> {
    const keys = await this.apiKeysService.listForStore(userId, storeId);
    return keys.map(mapStoreApiKey);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async revokeStoreApiKey(
    @Args('storeId') storeId: string,
    @Args('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<boolean> {
    await this.apiKeysService.revoke(userId, storeId, id);
    return true;
  }
}
