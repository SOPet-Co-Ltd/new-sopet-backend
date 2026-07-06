import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShippingProvider } from '../../database/entities/shipping-provider.entity';

@Injectable()
export class ShippingProvidersService {
  constructor(
    @InjectRepository(ShippingProvider)
    private readonly shippingProviderRepository: Repository<ShippingProvider>,
  ) {}

  async findAll(includeInactive = false): Promise<ShippingProvider[]> {
    const where = includeInactive ? {} : { isActive: true };
    return this.shippingProviderRepository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async create(data: { name: string }): Promise<ShippingProvider> {
    const provider = this.shippingProviderRepository.create({
      name: data.name,
      isActive: true,
    });
    return this.shippingProviderRepository.save(provider);
  }

  async update(id: string, data: { name?: string; isActive?: boolean }): Promise<ShippingProvider> {
    const provider = await this.findOne(id);
    if (data.name !== undefined) provider.name = data.name;
    if (data.isActive !== undefined) provider.isActive = data.isActive;
    return this.shippingProviderRepository.save(provider);
  }

  async delete(id: string): Promise<void> {
    const provider = await this.findOne(id);
    await this.shippingProviderRepository.remove(provider);
  }

  private async findOne(id: string): Promise<ShippingProvider> {
    const provider = await this.shippingProviderRepository.findOne({
      where: { id },
    });
    if (!provider) {
      throw new NotFoundException({
        code: 'SHIPPING_PROVIDER_NOT_FOUND',
        message: 'Shipping provider not found',
      });
    }
    return provider;
  }
}
