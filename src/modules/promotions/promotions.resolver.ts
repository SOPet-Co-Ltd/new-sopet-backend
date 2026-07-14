import { Args, Field, Float, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PromotionsService } from './promotions.service';
import { Public, CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PromotionScope } from '../../database/entities/promotion.entity';
import {
  PromotionType as PromotionGraphqlType,
  PromotionValidationResult,
} from '../../graphql/models/types';
import { mapPromotion } from '../../graphql/models/mappers';
import { CreatePromotionInput, UpdatePromotionInput } from './promotions.inputs';
import { StoresService } from '../stores/stores.service';
import { StoreMemberRole } from '../../database/entities/store-member.entity';

@InputType()
export class ValidatePromotionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @Field(() => Float)
  subtotal!: number;

  @Field({ nullable: true })
  storeId?: string;
}

@Resolver()
export class PromotionsResolver {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => PromotionValidationResult)
  @Public()
  async validatePromotion(
    @Args('input') input: ValidatePromotionInput,
  ): Promise<PromotionValidationResult> {
    const { promotion, discountAmount } = await this.promotionsService.validateCode(
      input.code,
      input.subtotal,
      input.storeId,
    );
    return { code: promotion.code, name: promotion.name, discountAmount };
  }

  @Query(() => [PromotionGraphqlType])
  @Public()
  async activeStorePromotions(@Args('storeId') storeId: string): Promise<PromotionGraphqlType[]> {
    const promotions = await this.promotionsService.findActiveForStore(storeId);
    return promotions.map(mapPromotion);
  }

  @Query(() => [PromotionGraphqlType])
  @Public()
  async activePlatformPromotions(): Promise<PromotionGraphqlType[]> {
    const promotions = await this.promotionsService.findActive();
    return promotions.map(mapPromotion);
  }

  @Query(() => [PromotionGraphqlType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storePromotions(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<PromotionGraphqlType[]> {
    await this.assertPromotionManager(userId, storeId);
    const promotions = await this.promotionsService.findByStore(storeId);
    return promotions.map(mapPromotion);
  }

  @Query(() => [PromotionGraphqlType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformPromotions(): Promise<PromotionGraphqlType[]> {
    const promotions = await this.promotionsService.findPlatform();
    return promotions.map(mapPromotion);
  }

  @Mutation(() => PromotionGraphqlType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'vendor')
  async createPromotion(
    @Args('input') input: CreatePromotionInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<PromotionGraphqlType> {
    if (role === 'admin') {
      const promotion = await this.promotionsService.create(input, PromotionScope.PLATFORM);
      return mapPromotion(promotion);
    }

    const targetStoreId = input.storeId ?? storeId;
    if (!targetStoreId) {
      throw new BadRequestException({
        code: 'NO_STORE_SELECTED',
        message: 'Store ID required for vendor promotions',
      });
    }
    await this.assertPromotionManager(userId, targetStoreId);
    const promotion = await this.promotionsService.create(
      input,
      PromotionScope.STORE,
      targetStoreId,
    );
    return mapPromotion(promotion);
  }

  @Mutation(() => PromotionGraphqlType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'vendor')
  async updatePromotion(
    @Args('id') id: string,
    @Args('input') input: UpdatePromotionInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<PromotionGraphqlType> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.assertPromotionManager(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    const updated = await this.promotionsService.update(id, input);
    return mapPromotion(updated);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'vendor')
  async deletePromotion(
    @Args('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<boolean> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.assertPromotionManager(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    await this.promotionsService.softDelete(id);
    return true;
  }

  @Mutation(() => PromotionGraphqlType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'vendor')
  async togglePromotion(
    @Args('id') id: string,
    @Args('isActive') isActive: boolean,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<PromotionGraphqlType> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.assertPromotionManager(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    const updated = await this.promotionsService.toggle(id, isActive);
    return mapPromotion(updated);
  }

  private async assertPromotionManager(userId: string, storeId: string): Promise<void> {
    const isOwner = await this.storesService.isStoreOwner(userId, storeId);
    if (isOwner) return;

    const accessible = await this.storesService.getAccessibleStores(userId);
    const membership = accessible.find((a) => a.store.id === storeId);
    if (
      membership &&
      (membership.membershipRole === StoreMemberRole.MANAGER ||
        membership.membershipRole === 'manager')
    ) {
      return;
    }

    throw new BadRequestException({
      code: 'PROMOTION_MANAGER_REQUIRED',
      message: 'Only store owner or manager can manage promotions',
    });
  }
}
