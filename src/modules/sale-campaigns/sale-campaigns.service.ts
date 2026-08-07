import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SaleCampaign } from '../../database/entities/sale-campaign.entity';
import { SaleCampaignItem } from '../../database/entities/sale-campaign-item.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { StoresService } from '../stores/stores.service';
import {
  CreateSaleCampaignInput,
  SaleCampaignItemInput,
  UpdateSaleCampaignInput,
} from './sale-campaigns.inputs';

@Injectable()
export class SaleCampaignsService {
  constructor(
    @InjectRepository(SaleCampaign)
    private readonly campaignRepository: Repository<SaleCampaign>,
    @InjectRepository(SaleCampaignItem)
    private readonly itemRepository: Repository<SaleCampaignItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly storesService: StoresService,
  ) {}

  async findByStore(storeId: string): Promise<SaleCampaign[]> {
    return this.campaignRepository.find({
      where: { storeId },
      relations: ['items', 'items.product', 'items.variant'],
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<SaleCampaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id },
      relations: ['items', 'items.product', 'items.variant'],
    });
    if (!campaign) {
      throw new NotFoundException({
        code: 'SALE_CAMPAIGN_NOT_FOUND',
        message: 'Sale campaign not found',
      });
    }
    return campaign;
  }

  /** Active campaigns in the current time window for storefront strikethrough. */
  async findActiveForStore(storeId: string): Promise<SaleCampaign[]> {
    const now = new Date();
    const campaigns = await this.campaignRepository.find({
      where: { storeId, isActive: true },
      relations: ['items'],
      order: { priority: 'DESC', createdAt: 'DESC' },
    });

    return campaigns.filter((campaign) => this.isWithinWindow(campaign, now));
  }

  /** Active campaign items that target any of the given products (catalog cards). */
  async findActiveItemsForProducts(productIds: string[]): Promise<
    Array<{ item: SaleCampaignItem; campaign: SaleCampaign }>
  > {
    const uniqueIds = [...new Set(productIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const now = new Date();
    const items = await this.itemRepository
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.campaign', 'campaign')
      .where('item.product_id IN (:...productIds)', { productIds: uniqueIds })
      .andWhere('campaign.is_active = true')
      .andWhere('campaign.deleted_at IS NULL')
      .andWhere('(campaign.starts_at IS NULL OR campaign.starts_at <= :now)', { now })
      .andWhere('(campaign.expires_at IS NULL OR campaign.expires_at >= :now)', { now })
      .orderBy('campaign.priority', 'DESC')
      .addOrderBy('campaign.created_at', 'DESC')
      .getMany();

    return items.map((item) => ({ item, campaign: item.campaign }));
  }

  private isWithinWindow(campaign: SaleCampaign, now: Date): boolean {
    if (campaign.startsAt && campaign.startsAt > now) return false;
    if (campaign.expiresAt && campaign.expiresAt < now) return false;
    return true;
  }

  async create(
    userId: string,
    storeId: string,
    input: CreateSaleCampaignInput,
  ): Promise<SaleCampaign> {
    await this.storesService.assertStoreAccess(userId, storeId);
    this.assertValidDateRange(input.startsAt, input.expiresAt);
    await this.assertValidItems(storeId, input.items);

    const campaign = this.campaignRepository.create({
      storeId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      isActive: input.isActive ?? true,
      priority: input.priority ?? 0,
    });
    const saved = await this.campaignRepository.save(campaign);
    await this.replaceItems(saved.id, input.items);
    return this.findOne(saved.id);
  }

  async update(
    id: string,
    userId: string,
    input: UpdateSaleCampaignInput,
  ): Promise<SaleCampaign> {
    const campaign = await this.findOne(id);
    await this.storesService.assertStoreAccess(userId, campaign.storeId);

    const nextStartsAt =
      input.startsAt === undefined
        ? campaign.startsAt
        : input.startsAt
          ? new Date(input.startsAt)
          : null;
    const nextExpiresAt =
      input.expiresAt === undefined
        ? campaign.expiresAt
        : input.expiresAt
          ? new Date(input.expiresAt)
          : null;
    this.assertValidDateRange(
      nextStartsAt?.toISOString() ?? null,
      nextExpiresAt?.toISOString() ?? null,
    );

    if (input.name !== undefined) campaign.name = input.name.trim();
    if (input.description !== undefined) {
      campaign.description = input.description?.trim() || null;
    }
    if (input.startsAt !== undefined) campaign.startsAt = nextStartsAt;
    if (input.expiresAt !== undefined) campaign.expiresAt = nextExpiresAt;
    if (input.isActive !== undefined) campaign.isActive = input.isActive;
    if (input.priority !== undefined) campaign.priority = input.priority;

    await this.campaignRepository.save(campaign);

    if (input.items) {
      await this.assertValidItems(campaign.storeId, input.items);
      await this.replaceItems(campaign.id, input.items);
    }

    return this.findOne(campaign.id);
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const campaign = await this.findOne(id);
    await this.storesService.assertStoreAccess(userId, campaign.storeId);
    await this.campaignRepository.softDelete(id);
  }

  async toggle(id: string, userId: string, isActive: boolean): Promise<SaleCampaign> {
    const campaign = await this.findOne(id);
    await this.storesService.assertStoreAccess(userId, campaign.storeId);
    campaign.isActive = isActive;
    await this.campaignRepository.save(campaign);
    return this.findOne(id);
  }

  private assertValidDateRange(
    startsAt?: string | Date | null,
    expiresAt?: string | Date | null,
  ): void {
    if (!startsAt || !expiresAt) return;
    const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
    const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!(start < end)) {
      throw new BadRequestException({
        code: 'INVALID_SALE_CAMPAIGN_DATE_RANGE',
        message: 'Campaign end time must be after start time',
      });
    }
  }

  private async assertValidItems(
    storeId: string,
    items: SaleCampaignItemInput[],
  ): Promise<void> {
    for (const item of items) {
      const hasCompare = item.compareAtPrice != null;
      const hasPercent = item.discountPercent != null;
      if (!hasCompare && !hasPercent) {
        throw new BadRequestException({
          code: 'SALE_CAMPAIGN_ITEM_DISCOUNT_REQUIRED',
          message: 'Each campaign item needs compareAtPrice and/or discountPercent',
        });
      }

      const product = await this.productRepository.findOne({
        where: { id: item.productId, storeId, deletedAt: IsNull() },
      });
      if (!product) {
        throw new BadRequestException({
          code: 'PRODUCT_NOT_IN_STORE',
          message: `Product ${item.productId} is not in this store`,
        });
      }

      if (item.variantId) {
        const variant = await this.variantRepository.findOne({
          where: { id: item.variantId, productId: item.productId, deletedAt: IsNull() },
        });
        if (!variant) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_ON_PRODUCT',
            message: `Variant ${item.variantId} does not belong to product ${item.productId}`,
          });
        }
      }
    }
  }

  private async replaceItems(
    campaignId: string,
    items: SaleCampaignItemInput[],
  ): Promise<void> {
    await this.itemRepository.delete({ campaignId });
    const rows = items.map((item) =>
      this.itemRepository.create({
        campaignId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        compareAtPrice: item.compareAtPrice ?? null,
        discountPercent: item.discountPercent ?? null,
      }),
    );
    await this.itemRepository.save(rows);
  }
}
