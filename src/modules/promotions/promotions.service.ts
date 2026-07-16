import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Promotion, PromotionScope, PromotionType } from '../../database/entities/promotion.entity';
import { PromotionUsage } from '../../database/entities/promotion-usage.entity';
import { Product } from '../../database/entities/product.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { CreatePromotionInput, UpdatePromotionInput } from './promotions.inputs';

export type PromotionCustomerIdentity = {
  customerId?: string;
  guestPhone?: string;
};

/** Transient cart line context for BxGy evaluation (Design Doc). */
export type PromotionCartLine = {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  storeId?: string;
};

export type ValidateCodeOptions = {
  lines?: PromotionCartLine[];
  mode?: 'preview' | 'apply';
};

export type ValidateCodeResult = {
  promotion: Promotion;
  discountAmount: number;
  freeUnits: number;
  ineligibilityReason: string | null;
};

/** Paid-path statuses for new-customer ORDER_HISTORY gate (ADR / Design Doc). */
const PAID_PATH_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    @InjectRepository(Promotion)
    private readonly promotionRepository: Repository<Promotion>,
    @InjectRepository(PromotionUsage)
    private readonly promotionUsageRepository: Repository<PromotionUsage>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
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
    await this.assertValidConditions(input.type, scope, storeId, conditions);
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
    if (input.conditions !== undefined || input.type !== undefined) {
      await this.assertValidConditions(
        input.type ?? promotion.type,
        promotion.scope,
        promotion.storeId,
        promotion.conditions,
      );
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
    customer?: PromotionCustomerIdentity,
    options?: ValidateCodeOptions,
  ): Promise<ValidateCodeResult> {
    const mode = options?.mode ?? 'apply';
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
    await this.assertCustomerUsageWithinLimit(promotion, customer);
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

    const gateReason = await this.evaluateNewCustomerGates(promotion, customer, now);
    if (gateReason) {
      return this.resolveEligibilityFailure(promotion, gateReason, mode);
    }

    let discountAmount = 0;
    let freeUnits = 0;

    if (promotion.type === PromotionType.PERCENTAGE) {
      discountAmount = (subtotal * Number(promotion.discountValue)) / 100;
    } else if (promotion.type === PromotionType.FIXED_AMOUNT) {
      discountAmount = Number(promotion.discountValue);
    } else if (promotion.type === PromotionType.BUY_X_GET_Y) {
      const bxgy = this.evaluateBuyXGetY(promotion, options?.lines);
      if (bxgy.kind === 'eligibility') {
        return this.resolveEligibilityFailure(promotion, bxgy.code, mode);
      }
      if (bxgy.kind === 'insufficient') {
        // Preview: soft INSUFFICIENT_QTY. Apply: skip promo (I001c — never hard-throw).
        if (mode === 'preview') {
          return {
            promotion,
            discountAmount: 0,
            freeUnits: 0,
            ineligibilityReason: 'INSUFFICIENT_QTY',
          };
        }
        return {
          promotion,
          discountAmount: 0,
          freeUnits: 0,
          ineligibilityReason: null,
        };
      }
      freeUnits = bxgy.freeUnits;
      discountAmount = bxgy.discountAmount;
    }

    if (promotion.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, Number(promotion.maxDiscountAmount));
    }
    // Rule C: clamp to eligible base (subtotal) after optional maxDiscountAmount
    discountAmount = Math.min(discountAmount, subtotal);

    return {
      promotion,
      discountAmount,
      freeUnits,
      ineligibilityReason: null,
    };
  }

  /**
   * BxGy Rules A–B (discount-only). Foreign productId lines ignored.
   * Sort: unitPrice asc, then line index, then variantId string.
   */
  private evaluateBuyXGetY(
    promotion: Promotion,
    lines: PromotionCartLine[] | undefined,
  ):
    | { kind: 'eligibility'; code: 'MISSING_LINES' }
    | { kind: 'insufficient' }
    | { kind: 'ok'; freeUnits: number; discountAmount: number } {
    if (lines == null) {
      return { kind: 'eligibility', code: 'MISSING_LINES' };
    }

    const conditions = promotion.conditions ?? {};
    const productId = conditions.productId;
    const buyQuantity = conditions.buyQuantity;
    const getQuantity = conditions.getQuantity;

    if (
      typeof productId !== 'string' ||
      productId.trim().length === 0 ||
      typeof buyQuantity !== 'number' ||
      !Number.isInteger(buyQuantity) ||
      buyQuantity < 1 ||
      typeof getQuantity !== 'number' ||
      !Number.isInteger(getQuantity) ||
      getQuantity < 1
    ) {
      throw new BadRequestException({
        code: 'INVALID_BXGY_CONDITIONS',
        message: 'buy_x_get_y requires productId, buyQuantity ≥ 1, and getQuantity ≥ 1',
      });
    }

    const x = buyQuantity;
    const y = getQuantity;

    type UnitSlot = { unitPrice: number; lineIndex: number; variantId: string };
    const units: UnitSlot[] = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (line.productId !== productId) {
        continue;
      }
      const qty = Math.max(0, Math.floor(Number(line.quantity)) || 0);
      const variantId = line.variantId ?? '';
      for (let u = 0; u < qty; u++) {
        units.push({
          unitPrice: Number(line.unitPrice),
          lineIndex,
          variantId,
        });
      }
    }

    const q = units.length;
    // Rule A: freeUnits = floor(Q / (X + Y)) * Y
    const freeUnits = Math.floor(q / (x + y)) * y;
    if (freeUnits === 0) {
      return { kind: 'insufficient' };
    }

    // Rule B: cheapest freeUnits; stable tie-break (line index, then variantId)
    units.sort((a, b) => {
      if (a.unitPrice !== b.unitPrice) {
        return a.unitPrice - b.unitPrice;
      }
      if (a.lineIndex !== b.lineIndex) {
        return a.lineIndex - b.lineIndex;
      }
      if (a.variantId < b.variantId) {
        return -1;
      }
      if (a.variantId > b.variantId) {
        return 1;
      }
      return 0;
    });

    let discountAmount = 0;
    for (let i = 0; i < freeUnits; i++) {
      discountAmount += units[i].unitPrice;
    }

    return { kind: 'ok', freeUnits, discountAmount };
  }

  async applyStackedPromotions(
    subtotal: number,
    storeSubtotals: Map<string, number>,
    platformCode?: string,
    storeCodes?: string[],
    customer?: PromotionCustomerIdentity,
    options?: ValidateCodeOptions,
  ): Promise<{
    promotions: Promotion[];
    discountAmount: number;
    discountsByPromotionId: Record<string, number>;
    freeUnits: number;
  }> {
    const mode = options?.mode ?? 'apply';
    const promotions: Promotion[] = [];
    const discountsByPromotionId: Record<string, number> = {};
    let discountAmount = 0;
    let freeUnits = 0;

    const absorb = (result: ValidateCodeResult): void => {
      // I001c: BxGy Rule A zero free on apply — skip contribution; do not abort stack
      const isBxGyApplySkip =
        mode === 'apply' &&
        result.promotion.type === PromotionType.BUY_X_GET_Y &&
        result.freeUnits === 0 &&
        result.discountAmount === 0;
      if (isBxGyApplySkip) {
        return;
      }
      promotions.push(result.promotion);
      discountsByPromotionId[result.promotion.id] = result.discountAmount;
      discountAmount += result.discountAmount;
      freeUnits += result.freeUnits;
    };

    if (platformCode) {
      const platform = await this.validateCode(platformCode, subtotal, undefined, customer, {
        ...options,
        mode,
      });
      absorb(platform);
    }

    if (storeCodes?.length) {
      for (const code of storeCodes) {
        const promo = await this.promotionRepository.findOne({
          where: { code, isActive: true },
        });
        const storeId = promo?.storeId ?? undefined;
        const storeSubtotal = storeId ? (storeSubtotals.get(storeId) ?? 0) : subtotal;
        const store = await this.validateCode(code, storeSubtotal, storeId, customer, {
          ...options,
          mode,
        });
        absorb(store);
      }
    }

    discountAmount = Math.min(discountAmount, subtotal);
    return { promotions, discountAmount, discountsByPromotionId, freeUnits };
  }

  /**
   * New-customer dual gates (AND). Returns ineligibility code or null when skipped/passed.
   */
  private async evaluateNewCustomerGates(
    promotion: Promotion,
    customer: PromotionCustomerIdentity | undefined,
    nowUtc: Date,
  ): Promise<string | null> {
    const conditions = promotion.conditions ?? {};
    const newCustomer = conditions.newCustomer;
    if (
      newCustomer === undefined ||
      newCustomer === null ||
      typeof newCustomer !== 'object' ||
      Array.isArray(newCustomer)
    ) {
      return null;
    }
    const nc = newCustomer as Record<string, unknown>;
    if (nc.enabled !== true) {
      return null;
    }

    const customerId = customer?.customerId;
    if (!customerId) {
      return 'GUEST';
    }

    const record = await this.customerRepository.findOne({
      where: { id: customerId, deletedAt: IsNull() },
    });
    if (!record) {
      return 'GUEST';
    }

    const nDays = nc.nDays;
    if (typeof nDays === 'number' && Number.isInteger(nDays) && nDays >= 1) {
      const endInstantMs = record.createdAt.getTime() + nDays * 24 * 60 * 60 * 1000;
      // Inclusive end: pass iff nowUtc <= createdAtUtc + nDays×24h
      if (nowUtc.getTime() > endInstantMs) {
        return 'ACCOUNT_AGE';
      }
    }

    const paidPathCount = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.customer_id = :customerId', { customerId })
      .andWhere('order.status IN (:...statuses)', { statuses: PAID_PATH_ORDER_STATUSES })
      .getCount();
    if (paidPathCount > 0) {
      return 'ORDER_HISTORY';
    }

    return null;
  }

  private resolveEligibilityFailure(
    promotion: Promotion,
    code: string,
    mode: 'preview' | 'apply',
  ): ValidateCodeResult {
    this.logger.debug(`Promotion eligibility fail code=${code} promotionId=${promotion.id}`);
    if (mode === 'preview') {
      return {
        promotion,
        discountAmount: 0,
        freeUnits: 0,
        ineligibilityReason: code,
      };
    }
    throw new BadRequestException({
      code,
      message: `Promotion not eligible: ${code}`,
    });
  }

  private async assertCustomerUsageWithinLimit(
    promotion: Promotion,
    customer?: PromotionCustomerIdentity,
  ): Promise<void> {
    if (!promotion.usagePerCustomer || promotion.usagePerCustomer <= 0) {
      return;
    }

    const customerId = customer?.customerId;
    const guestPhone = customer?.guestPhone?.trim();
    if (!customerId && !guestPhone) {
      return;
    }

    const qb = this.promotionUsageRepository
      .createQueryBuilder('usage')
      .innerJoin('usage.order', 'order')
      .where('usage.promotion_id = :promotionId', { promotionId: promotion.id });

    if (customerId) {
      qb.andWhere('order.customer_id = :customerId', { customerId });
    } else if (guestPhone) {
      qb.andWhere('order.guest_phone = :guestPhone', { guestPhone });
    }

    const customerUsageCount = await qb.getCount();
    if (customerUsageCount >= promotion.usagePerCustomer) {
      throw new BadRequestException({
        code: 'PROMOTION_CUSTOMER_LIMIT',
        message: 'You have reached the usage limit for this promotion',
      });
    }
  }

  private parseConditions(conditions?: string): Record<string, unknown> {
    if (!conditions) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(conditions);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BadRequestException({
          code: 'INVALID_CONDITIONS',
          message: 'conditions must be a JSON object',
        });
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        code: 'INVALID_CONDITIONS',
        message: 'conditions must be valid JSON',
      });
    }
  }

  /**
   * Semantic write validation for opaque conditions JSON (ADR-0007 keys).
   * Unknown keys are ignored. Called from create/update only.
   */
  private async assertValidConditions(
    type: PromotionType,
    scope: PromotionScope,
    storeId: string | null | undefined,
    conditions: Record<string, unknown>,
  ): Promise<void> {
    const newCustomer = conditions.newCustomer;
    if (newCustomer !== undefined && newCustomer !== null) {
      if (typeof newCustomer !== 'object' || Array.isArray(newCustomer)) {
        throw new BadRequestException({
          code: 'INVALID_NEW_CUSTOMER_CONDITIONS',
          message: 'newCustomer must be an object with enabled and nDays',
        });
      }
      const nc = newCustomer as Record<string, unknown>;
      if (nc.enabled === true) {
        const nDays = nc.nDays;
        if (typeof nDays !== 'number' || !Number.isInteger(nDays) || nDays < 1) {
          throw new BadRequestException({
            code: 'INVALID_NEW_CUSTOMER_CONDITIONS',
            message: 'newCustomer.nDays must be a positive integer when enabled',
          });
        }
      }
    }

    if (type !== PromotionType.BUY_X_GET_Y) {
      return;
    }

    const productId = conditions.productId;
    const buyQuantity = conditions.buyQuantity;
    const getQuantity = conditions.getQuantity;

    if (
      typeof productId !== 'string' ||
      productId.trim().length === 0 ||
      typeof buyQuantity !== 'number' ||
      !Number.isInteger(buyQuantity) ||
      buyQuantity < 1 ||
      typeof getQuantity !== 'number' ||
      !Number.isInteger(getQuantity) ||
      getQuantity < 1
    ) {
      throw new BadRequestException({
        code: 'INVALID_BXGY_CONDITIONS',
        message: 'buy_x_get_y requires productId, buyQuantity ≥ 1, and getQuantity ≥ 1',
      });
    }

    const product = await this.productRepository.findOne({
      where: { id: productId, deletedAt: IsNull() },
    });
    if (!product) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found for buy_x_get_y conditions',
      });
    }
    if (scope === PromotionScope.STORE && storeId && product.storeId !== storeId) {
      throw new BadRequestException({
        code: 'PRODUCT_STORE_MISMATCH',
        message: 'Product does not belong to this store',
      });
    }
  }
}
