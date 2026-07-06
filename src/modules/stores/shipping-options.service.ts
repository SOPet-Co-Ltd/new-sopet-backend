import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';

export interface CreateShippingOptionData {
  name: string;
  description?: string;
  price: number;
  sortOrder?: number;
  isActive?: boolean;
  providerId?: string | null;
}

export interface UpdateShippingOptionData {
  name?: string;
  description?: string;
  price?: number;
  sortOrder?: number;
  isActive?: boolean;
  providerId?: string | null;
}

@Injectable()
export class ShippingOptionsService {
  constructor(
    @InjectRepository(StoreShippingOption)
    private readonly shippingOptionRepository: Repository<StoreShippingOption>,
  ) {}

  async findByStore(storeId: string, activeOnly = false): Promise<StoreShippingOption[]> {
    const where: { storeId: string; isActive?: boolean } = { storeId };
    if (activeOnly) {
      where.isActive = true;
    }

    return this.shippingOptionRepository.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(storeId: string, data: CreateShippingOptionData): Promise<StoreShippingOption> {
    const option = this.shippingOptionRepository.create({
      storeId,
      name: data.name,
      description: data.description ?? null,
      price: data.price,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
      providerId: data.providerId ?? null,
    });

    return this.shippingOptionRepository.save(option);
  }

  async update(
    id: string,
    storeId: string,
    data: UpdateShippingOptionData,
  ): Promise<StoreShippingOption> {
    const option = await this.findOneForStore(id, storeId);
    Object.assign(option, data);
    return this.shippingOptionRepository.save(option);
  }

  async delete(id: string, storeId: string): Promise<void> {
    const option = await this.findOneForStore(id, storeId);
    await this.shippingOptionRepository.softRemove(option);
  }

  async findByStoreForAdmin(storeId: string): Promise<StoreShippingOption[]> {
    return this.findByStore(storeId, false);
  }

  async adminUpdate(id: string, data: UpdateShippingOptionData): Promise<StoreShippingOption> {
    const option = await this.findOneById(id);
    Object.assign(option, data);
    return this.shippingOptionRepository.save(option);
  }

  async adminDelete(id: string): Promise<void> {
    const option = await this.findOneById(id);
    await this.shippingOptionRepository.softRemove(option);
  }

  private async findOneById(id: string): Promise<StoreShippingOption> {
    const option = await this.shippingOptionRepository.findOne({
      where: { id },
    });

    if (!option) {
      throw new NotFoundException({
        code: 'SHIPPING_OPTION_NOT_FOUND',
        message: 'Shipping option not found',
      });
    }

    return option;
  }

  private async findOneForStore(id: string, storeId: string): Promise<StoreShippingOption> {
    const option = await this.shippingOptionRepository.findOne({
      where: { id, storeId },
    });

    if (!option) {
      throw new NotFoundException({
        code: 'SHIPPING_OPTION_NOT_FOUND',
        message: 'Shipping option not found',
      });
    }

    return option;
  }
}
