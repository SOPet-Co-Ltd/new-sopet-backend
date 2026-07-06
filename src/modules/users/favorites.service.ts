import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from '../../database/entities/favorite.entity';
import { Product } from '../../database/entities/product.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async list(customerId: string): Promise<Favorite[]> {
    return this.favoriteRepository.find({
      where: { customerId },
      relations: ['product', 'product.images', 'product.variants', 'product.store'],
      order: { createdAt: 'DESC' },
    });
  }

  async add(customerId: string, productId: string): Promise<Favorite> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }

    const existing = await this.favoriteRepository.findOne({
      where: { customerId, productId },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_FAVORITED',
        message: 'Product already in favorites',
      });
    }

    return this.favoriteRepository.save(this.favoriteRepository.create({ customerId, productId }));
  }

  async remove(customerId: string, productId: string): Promise<boolean> {
    const result = await this.favoriteRepository.delete({ customerId, productId });
    return (result.affected ?? 0) > 0;
  }
}
