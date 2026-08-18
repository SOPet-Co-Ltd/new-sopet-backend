import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { Public, CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Promotion, PromotionScope } from '../../database/entities/promotion.entity';
import {
  PromotionType as PromotionGraphqlType,
  PromotionValidationResult,
  ValidatePromotionsResult,
} from '../../graphql/models/types';
import { mapPromotion } from '../../graphql/models/mappers';
import {
  CreatePromotionInput,
  UpdatePromotionInput,
  ValidatePromotionInput,
  ValidatePromotionsInput,
} from './promotions.inputs';
import { StoresService } from '../stores/stores.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

@Resolver()
export class PromotionsResolver {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly storesService: StoresService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async logPromotionAudit(
    adminId: string,
    adminEmail: string | undefined,
    action: string,
    promotion: Promotion,
    req?: unknown,
  ): Promise<void> {
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action,
      resourceType: AuditResourceType.PROMOTION,
      resourceId: promotion.id,
      metadata: { scope: promotion.scope, isActive: promotion.isActive },
      ...getAuditRequestContext(req),
    });
  }

  @Query(() => PromotionValidationResult)
  @Public()
  async validatePromotion(
    @Args('input') input: ValidatePromotionInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<PromotionValidationResult> {
    const { promotion, discountAmount, freeUnits, ineligibilityReason } =
      await this.promotionsService.validateCode(
        input.code,
        input.subtotal,
        input.storeId,
        customerId ? { customerId } : undefined,
        { mode: 'preview', lines: input.lines, shippingFee: input.shippingFee },
      );
    return {
      code: promotion.code,
      name: promotion.name,
      discountAmount,
      ineligibilityReason: ineligibilityReason ?? null,
      freeUnits: freeUnits ?? 0,
    };
  }

  @Query(() => ValidatePromotionsResult)
  @Public()
  async validatePromotions(
    @Args('input') input: ValidatePromotionsInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<ValidatePromotionsResult> {
    return this.promotionsService.validatePromotionsBatch(
      input.promotions.map((t) => ({ id: t.id, code: t.code })),
      input.subtotal,
      input.storeId,
      customerId ? { customerId } : undefined,
      input.lines,
      input.shippingFee,
    );
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
    await this.storesService.assertStoreAccess(userId, storeId);
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
    @CurrentUser('email') email?: string,
    @Context() context?: GraphqlContext,
  ): Promise<PromotionGraphqlType> {
    if (role === 'admin') {
      const promotion = await this.promotionsService.create(input, PromotionScope.PLATFORM);
      await this.logPromotionAudit(
        userId,
        email,
        AuditAction.PROMOTION_CREATED,
        promotion,
        context?.req,
      );
      return mapPromotion(promotion);
    }

    const targetStoreId = input.storeId ?? storeId;
    if (!targetStoreId) {
      throw new BadRequestException({
        code: 'NO_STORE_SELECTED',
        message: 'Store ID required for vendor promotions',
      });
    }
    await this.storesService.assertStoreAccess(userId, targetStoreId);
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
    @CurrentUser('email') email?: string,
    @Context() context?: GraphqlContext,
  ): Promise<PromotionGraphqlType> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.storesService.assertStoreAccess(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    const updated = await this.promotionsService.update(id, input);
    if (role === 'admin') {
      await this.logPromotionAudit(
        userId,
        email,
        AuditAction.PROMOTION_UPDATED,
        updated,
        context?.req,
      );
    }
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
    @CurrentUser('email') email?: string,
    @Context() context?: GraphqlContext,
  ): Promise<boolean> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.storesService.assertStoreAccess(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    await this.promotionsService.softDelete(id);
    if (role === 'admin') {
      await this.logPromotionAudit(
        userId,
        email,
        AuditAction.PROMOTION_DELETED,
        promotion,
        context?.req,
      );
    }
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
    @CurrentUser('email') email?: string,
    @Context() context?: GraphqlContext,
  ): Promise<PromotionGraphqlType> {
    const promotion = await this.promotionsService.findOne(id);
    if (role === 'vendor') {
      await this.storesService.assertStoreAccess(userId, promotion.storeId!);
      this.promotionsService.assertCanManage(promotion, PromotionScope.STORE, storeId);
    } else {
      this.promotionsService.assertCanManage(promotion, PromotionScope.PLATFORM);
    }
    const updated = await this.promotionsService.toggle(id, isActive);
    if (role === 'admin') {
      await this.logPromotionAudit(
        userId,
        email,
        AuditAction.PROMOTION_TOGGLED,
        updated,
        context?.req,
      );
    }
    return mapPromotion(updated);
  }
}
