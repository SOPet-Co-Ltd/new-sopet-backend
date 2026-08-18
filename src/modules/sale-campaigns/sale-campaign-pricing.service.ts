import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleCampaign } from '../../database/entities/sale-campaign.entity';
import { SaleCampaignItem } from '../../database/entities/sale-campaign-item.entity';
import {
  type EffectiveUnitPrice,
  resolveEffectiveUnitFromItem,
  roundMoney,
  selectWinningCampaignItem,
} from './sale-campaign-pricing';

@Injectable()
export class SaleCampaignPricingService {
  constructor(
    @InjectRepository(SaleCampaignItem)
    private readonly itemRepository: Repository<SaleCampaignItem>,
  ) {}

  /**
   * Batch-resolve payable unit prices for cart/order lines.
   * Uses active+window campaign items; missing/invalid % leaves catalog unit.
   */
  async resolveEffectiveUnitPrices(
    lines: Array<{ productId: string; variantId: string; catalogUnit: number }>,
  ): Promise<Map<string, EffectiveUnitPrice>> {
    const result = new Map<string, EffectiveUnitPrice>();
    if (lines.length === 0) return result;

    const productIds = [...new Set(lines.map((line) => line.productId).filter(Boolean))];
    const rows = productIds.length > 0 ? await this.findActiveItemsForProducts(productIds) : [];

    const items = rows.map(({ item, campaign }) => ({
      productId: item.productId,
      variantId: item.variantId,
      discountPercent: item.discountPercent != null ? Number(item.discountPercent) : null,
      compareAtPrice: item.compareAtPrice != null ? Number(item.compareAtPrice) : null,
      priority: campaign.priority,
      campaignId: campaign.id,
      createdAt: campaign.createdAt,
    }));

    for (const line of lines) {
      const winner = selectWinningCampaignItem(items, line.productId, line.variantId);
      result.set(
        line.variantId,
        resolveEffectiveUnitFromItem(roundMoney(line.catalogUnit), winner),
      );
    }

    return result;
  }

  /** Active campaign items that target any of the given products (catalog cards). */
  async findActiveItemsForProducts(
    productIds: string[],
  ): Promise<Array<{ item: SaleCampaignItem; campaign: SaleCampaign }>> {
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
}
