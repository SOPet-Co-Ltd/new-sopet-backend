import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Promotion, PromotionScope, PromotionType } from '../entities/promotion.entity';
import { PromotionUsage } from '../entities/promotion-usage.entity';

@Injectable()
export class PromotionRepository {
  constructor(
    @InjectRepository(Promotion)
    private readonly repository: Repository<Promotion>,
    @InjectRepository(PromotionUsage)
    private readonly usageRepository: Repository<PromotionUsage>,
  ) {}

  async findActive(storeId?: string): Promise<Promotion[]> {
    const now = new Date();
    const query = this.repository
      .createQueryBuilder('promotion')
      .where('promotion.is_active = :isActive', { isActive: true })
      .andWhere('promotion.deleted_at IS NULL')
      .andWhere('(promotion.starts_at IS NULL OR promotion.starts_at <= :now)', { now })
      .andWhere('(promotion.expires_at IS NULL OR promotion.expires_at >= :now)', { now });

    if (storeId) {
      query.andWhere('(promotion.store_id = :storeId OR promotion.scope = :platformScope)', {
        storeId,
        platformScope: PromotionScope.PLATFORM,
      });
    } else {
      query.andWhere('promotion.scope = :platformScope', {
        platformScope: PromotionScope.PLATFORM,
      });
    }

    return query.getMany();
  }

  async findByCode(code: string): Promise<Promotion | null> {
    return this.repository.findOne({
      where: { code, deletedAt: IsNull() },
      relations: ['store'],
    });
  }

  async validate(
    code: string,
    cartTotal: number,
    customerId?: string,
  ): Promise<{ valid: boolean; promotion?: Promotion; error?: string }> {
    const promotion = await this.findByCode(code);

    if (!promotion) {
      return { valid: false, error: 'Invalid promotion code' };
    }

    if (!promotion.isActive) {
      return { valid: false, error: 'Promotion is not active' };
    }

    const now = new Date();

    if (promotion.startsAt && promotion.startsAt > now) {
      return { valid: false, error: 'Promotion has not started yet' };
    }

    if (promotion.expiresAt && promotion.expiresAt < now) {
      return { valid: false, error: 'Promotion has expired' };
    }

    if (promotion.minPurchaseAmount && cartTotal < promotion.minPurchaseAmount) {
      return {
        valid: false,
        error: `Minimum purchase amount is ${promotion.minPurchaseAmount}`,
      };
    }

    if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
      return { valid: false, error: 'Promotion usage limit reached' };
    }

    if (customerId) {
      const customerUsageCount = await this.usageRepository.count({
        where: {
          promotionId: promotion.id,
          order: { customerId },
        },
      });

      if (customerUsageCount >= promotion.usagePerCustomer) {
        return {
          valid: false,
          error: 'You have reached the usage limit for this promotion',
        };
      }
    }

    return { valid: true, promotion };
  }

  async recordUsage(promotionId: string, orderId: string, discountAmount: number): Promise<void> {
    await this.usageRepository.save({
      promotionId,
      orderId,
      discountAmount,
    });

    await this.repository.increment({ id: promotionId }, 'usageCount', 1);
  }

  async calculateDiscount(promotion: Promotion, cartTotal: number): Promise<number> {
    let discount = 0;

    if (promotion.type === PromotionType.PERCENTAGE) {
      discount = (cartTotal * promotion.discountValue) / 100;
    } else if (promotion.type === PromotionType.FIXED_AMOUNT) {
      discount = promotion.discountValue;
    }

    if (promotion.maxDiscountAmount && discount > promotion.maxDiscountAmount) {
      discount = promotion.maxDiscountAmount;
    }

    return Math.min(discount, cartTotal);
  }

  async create(data: {
    storeId?: string;
    code: string;
    name: string;
    description?: string;
    type: PromotionType;
    scope: PromotionScope;
    discountValue: number;
    minPurchaseAmount?: number;
    maxDiscountAmount?: number;
    usageLimit?: number;
    usagePerCustomer?: number;
    startsAt?: Date;
    expiresAt?: Date;
  }): Promise<Promotion> {
    const promotion = this.repository.create(data);
    return this.repository.save(promotion);
  }

  async deactivate(id: string): Promise<void> {
    await this.repository.update(id, { isActive: false });
  }

  async softDelete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }
}
