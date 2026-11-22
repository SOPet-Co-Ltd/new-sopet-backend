import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from '../../database/entities/favorite.entity';
import { Product } from '../../database/entities/product.entity';

const FAVORITES_DEFAULT_LIMIT = 24;
const FAVORITES_MAX_LIMIT = 100;

/** One image per product: thumbnail flag, then sort order. Product has no stored thumbnailUrl. */
const THUMBNAIL_IMAGE_JOIN = `image.id = (
  SELECT pi.id
  FROM product_images pi
  WHERE pi.product_id = product.id
  ORDER BY pi.is_thumbnail DESC, pi.sort_order ASC, pi.created_at ASC, pi.id ASC
  LIMIT 1
)`;

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async list(customerId: string, page = 1, limit = FAVORITES_DEFAULT_LIMIT): Promise<Favorite[]> {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), FAVORITES_MAX_LIMIT);

    return this.favoriteRepository
      .createQueryBuilder('favorite')
      .leftJoinAndSelect('favorite.product', 'product')
      .leftJoinAndSelect('product.store', 'store')
      .leftJoinAndSelect('product.images', 'image', THUMBNAIL_IMAGE_JOIN)
      .where('favorite.customerId = :customerId', { customerId })
      .orderBy('favorite.createdAt', 'DESC')
      .addOrderBy('favorite.id', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();
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
