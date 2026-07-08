import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Promotion, PromotionScope, PromotionType } from '../../database/entities/promotion.entity';
import { CreatePromotionInput, UpdatePromotionInput } from './promotions.inputs';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
  ) {}

  async findActive(storeId?: string): Promise<Promotion[]> {
    const now = new Date();
    const qb = this.promotionRepository
      .createQueryBuilder('promotion')
      .where('promotion.is_active = true')
      .andWhere('promotion.deleted_at IS NULL')
      .andWhere('(promotion.starts_at IS NULL OR promotion.starts_at <= :now)', { now })
      .andWhere('(promotion.expires_at IS NULL OR promotion.expires_at >= :now)', { now });

    if (storeId) {
      qb.andWhere(
        '(promotion.scope = :platform OR (promotion.scope = :store AND promotion.store_id = :storeId))',
        { platform: PromotionScope.PLATFORM, store: PromotionScope.STORE, storeId },
      );
    } else {
      qb.andWhere('promotion.scope = :platform', { platform: PromotionScope.PLATFORM });
    }

    return qb.orderBy('promotion.priority', 'DESC').getMany();
  }

  async findByStore(storeId: string): Promise<Promotion[]> {
    return this.promotionRepository.find({
      where: { storeId, deletedAt: IsNull() },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async findActiveForStore(storeId: string): Promise<Promotion[]> {
    const now = new Date();

    return this.promotionRepository
      .createQueryBuilder('promotion')
      .where('promotion.is_active = true')
      .andWhere('promotion.deleted_at IS NULL')
      .andWhere('promotion.scope = :store', { store: PromotionScope.STORE })
      .andWhere('promotion.store_id = :storeId', { storeId })
      .andWhere('(promotion.starts_at IS NULL OR promotion.starts_at <= :now)', { now })
      .andWhere('(promotion.expires_at IS NULL OR promotion.expires_at >= :now)', { now })
      .orderBy('promotion.priority', 'DESC')
      .addOrderBy('promotion.created_at', 'DESC')
      .getMany();
  }

  async findPlatform(): Promise<Promotion[]> {
    return this.promotionRepository.find({
      where: { scope: PromotionScope.PLATFORM, deletedAt: IsNull() },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Promotion> {
    const promotion = await this.promotionRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!promotion) {
      throw new NotFoundException({
        code: 'PROMOTION_NOT_FOUND',
        message: 'Promotion not found',
      });
    }
    return promotion;
  }

  private assertDiscountBounds(type: PromotionType, discountValue: number): void {
    const isPercentage =
      type === PromotionType.PERCENTAGE || type === PromotionType.PERCENTAGE_SHIPPING_DISCOUNT;
    if (isPercentage && discountValue > 100) {
      throw new BadRequestException({
        code: 'INVALID_DISCOUNT_VALUE',
        message: 'เปอร์เซ็นต์ส่วนลดต้องไม่เกิน 100',
      });
    }
  }

  async create(
    input: CreatePromotionInput,
    scope: PromotionScope,
    storeId?: string,
  ): Promise<Promotion> {
    this.assertDiscountBounds(input.type, input.discountValue);
    const conditions = this.parseConditions(input.conditions);
    const promotion = this.promotionRepository.create({
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      scope,
      storeId: scope === PromotionScope.STORE ? (storeId ?? null) : null,
      discountValue: input.discountValue,
      minPurchaseAmount: input.minPurchaseAmount ?? null,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      usageLimit: input.usageLimit ?? null,
      usagePerCustomer: input.usagePerCustomer ?? 1,
      isActive: input.isActive ?? true,
      autoApply: input.autoApply ?? false,
      priority: input.priority ?? 0,
      conditions,
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    return this.promotionRepository.save(promotion);
  }

  async update(id: string, input: UpdatePromotionInput): Promise<Promotion> {
    const promotion = await this.findOne(id);
    if (input.type !== undefined || input.discountValue !== undefined) {
      this.assertDiscountBounds(
        input.type ?? promotion.type,
        input.discountValue ?? Number(promotion.discountValue),
      );
    }
    if (input.code !== undefined) promotion.code = input.code.toUpperCase();
    if (input.name !== undefined) promotion.name = input.name;
    if (input.description !== undefined) promotion.description = input.description;
    if (input.type !== undefined) promotion.type = input.type;
    if (input.discountValue !== undefined) promotion.discountValue = input.discountValue;
    if (input.minPurchaseAmount !== undefined) {
      promotion.minPurchaseAmount = input.minPurchaseAmount;
    }
    if (input.maxDiscountAmount !== undefined) {
      promotion.maxDiscountAmount = input.maxDiscountAmount;
    }
    if (input.usageLimit !== undefined) promotion.usageLimit = input.usageLimit;
    if (input.usagePerCustomer !== undefined) {
      promotion.usagePerCustomer = input.usagePerCustomer;
    }
    if (input.isActive !== undefined) promotion.isActive = input.isActive;
    if (input.autoApply !== undefined) promotion.autoApply = input.autoApply;
    if (input.priority !== undefined) promotion.priority = input.priority;
    if (input.conditions !== undefined) {
      promotion.conditions = this.parseConditions(input.conditions);
    }
    if (input.startsAt !== undefined) promotion.startsAt = input.startsAt;
    if (input.expiresAt !== undefined) promotion.expiresAt = input.expiresAt;
    return this.promotionRepository.save(promotion);
  }

  async softDelete(id: string): Promise<void> {
    const promotion = await this.findOne(id);
    await this.promotionRepository.softRemove(promotion);
  }

  async toggle(id: string, isActive: boolean): Promise<Promotion> {
    const promotion = await this.findOne(id);
    promotion.isActive = isActive;
    return this.promotionRepository.save(promotion);
  }

  assertCanManage(promotion: Promotion, scope: PromotionScope, storeId?: string): void {
    if (promotion.scope !== scope) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cannot manage this promotion',
      });
    }
    if (scope === PromotionScope.STORE && storeId && promotion.storeId !== storeId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Promotion does not belong to this store',
      });
    }
  }

  async validateCode(
    code: string,
    subtotal: number,
    storeId?: string,
  ): Promise<{ promotion: Promotion; discountAmount: number }> {
    const promotion = await this.promotionRepository.findOne({
      where: { code, isActive: true, deletedAt: IsNull() },
    });

    if (!promotion) {
      throw new BadRequestException({ code: 'INVALID_PROMOTION', message: 'Invalid promo code' });
    }

    const now = new Date();
    if (promotion.startsAt && promotion.startsAt > now) {
      throw new BadRequestException({
        code: 'PROMOTION_NOT_STARTED',
        message: 'Promotion not active yet',
      });
    }
    if (promotion.expiresAt && promotion.expiresAt < now) {
      throw new BadRequestException({ code: 'PROMOTION_EXPIRED', message: 'Promotion expired' });
    }
    if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
      throw new BadRequestException({
        code: 'PROMOTION_LIMIT',
        message: 'Promotion usage limit reached',
      });
    }
    if (promotion.scope === PromotionScope.STORE && storeId && promotion.storeId !== storeId) {
      throw new BadRequestException({
        code: 'PROMOTION_STORE',
        message: 'Promotion not valid for this store',
      });
    }
    if (promotion.minPurchaseAmount && subtotal < Number(promotion.minPurchaseAmount)) {
      throw new BadRequestException({
        code: 'PROMOTION_MIN_PURCHASE',
        message: `Minimum purchase ฿${promotion.minPurchaseAmount}`,
      });
    }

    let discountAmount = 0;
    if (promotion.type === PromotionType.PERCENTAGE) {
      discountAmount = (subtotal * Number(promotion.discountValue)) / 100;
    } else if (promotion.type === PromotionType.FIXED_AMOUNT) {
      discountAmount = Number(promotion.discountValue);
    }

    if (promotion.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, Number(promotion.maxDiscountAmount));
    }
    discountAmount = Math.min(discountAmount, subtotal);

    return { promotion, discountAmount };
  }

  async applyStackedPromotions(
    subtotal: number,
    storeSubtotals: Map<string, number>,
    platformCode?: string,
    storeCodes?: string[],
  ): Promise<{ promotions: Promotion[]; discountAmount: number }> {
    const promotions: Promotion[] = [];
    let discountAmount = 0;

    if (platformCode) {
      const platform = await this.validateCode(platformCode, subtotal);
      promotions.push(platform.promotion);
      discountAmount += platform.discountAmount;
    }

    if (storeCodes?.length) {
      for (const code of storeCodes) {
        const promo = await this.promotionRepository.findOne({
          where: { code, isActive: true },
        });
        const storeId = promo?.storeId ?? undefined;
        const storeSubtotal = storeId ? (storeSubtotals.get(storeId) ?? 0) : subtotal;
        const store = await this.validateCode(code, storeSubtotal, storeId);
        promotions.push(store.promotion);
        discountAmount += store.discountAmount;
      }
    }

    discountAmount = Math.min(discountAmount, subtotal);
    return { promotions, discountAmount };
  }

  private parseConditions(conditions?: string): Record<string, unknown> {
    if (!conditions) {
      return {};
    }
    try {
      return JSON.parse(conditions) as Record<string, unknown>;
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CONDITIONS',
        message: 'conditions must be valid JSON',
      });
    }
  }
}
