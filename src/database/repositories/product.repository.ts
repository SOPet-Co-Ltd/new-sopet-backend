import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource } from 'typeorm';
import { Product, ProductStatus } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../entities/inventory-transaction.entity';

interface ProductFilters {
  status?: ProductStatus;
  category?: string;
  tags?: string[];
  minPrice?: number;
  maxPrice?: number;
}

@Injectable()
export class ProductRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryRepository: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  async findByStore(
    storeId: string,
    filters?: ProductFilters,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Product[]> {
    const query = this.repository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants')
      .where('product.store_id = :storeId', { storeId })
      .andWhere('product.deleted_at IS NULL')
      .orderBy('images.sort_order', 'ASC')
      .addOrderBy('product.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.status) {
      query.andWhere('product.status = :status', { status: filters.status });
    }

    if (filters?.category) {
      query.andWhere('product.category = :category', { category: filters.category });
    }

    if (filters?.tags && filters.tags.length > 0) {
      query.andWhere('product.tags && :tags', { tags: filters.tags });
    }

    if (filters?.minPrice !== undefined) {
      query.andWhere('product.base_price >= :minPrice', { minPrice: filters.minPrice });
    }

    if (filters?.maxPrice !== undefined) {
      query.andWhere('product.base_price <= :maxPrice', { maxPrice: filters.maxPrice });
    }

    return query.getMany();
  }

  async search(
    searchQuery: string,
    filters?: ProductFilters,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Product[]> {
    const query = this.repository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants')
      .leftJoin('product.store', 'store')
      .where('product.deleted_at IS NULL')
      .andWhere('store.status = :storeStatus', { storeStatus: 'approved' })
      .andWhere('product.status = :productStatus', { productStatus: ProductStatus.PUBLISHED })
      .andWhere(
        `(
          to_tsvector('simple', product.name) @@ plainto_tsquery('simple', :query)
          OR to_tsvector('simple', product.description) @@ plainto_tsquery('simple', :query)
          OR product.name ILIKE :likeQuery
        )`,
        { query: searchQuery, likeQuery: `%${searchQuery}%` },
      )
      .orderBy('images.sort_order', 'ASC')
      .addOrderBy('product.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.category) {
      query.andWhere('product.category = :category', { category: filters.category });
    }

    if (filters?.tags && filters.tags.length > 0) {
      query.andWhere('product.tags && :tags', { tags: filters.tags });
    }

    if (filters?.minPrice !== undefined) {
      query.andWhere('product.base_price >= :minPrice', { minPrice: filters.minPrice });
    }

    if (filters?.maxPrice !== undefined) {
      query.andWhere('product.base_price <= :maxPrice', { maxPrice: filters.maxPrice });
    }

    return query.getMany();
  }

  async findBySlug(storeId: string, slug: string): Promise<Product | null> {
    return this.repository.findOne({
      where: { storeId, slug, deletedAt: IsNull() },
      relations: ['images', 'variants', 'store'],
    });
  }

  async findById(id: string): Promise<Product | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['images', 'variants', 'store'],
    });
  }

  async findWithVariants(id: string): Promise<Product | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['images', 'variants', 'store'],
    });
  }

  async create(data: {
    storeId: string;
    name: string;
    slug: string;
    description?: string;
    basePrice: number;
    category?: string;
    tags?: string[];
    status?: ProductStatus;
  }): Promise<Product> {
    const product = this.repository.create(data);
    return this.repository.save(product);
  }

  async update(
    id: string,
    data: Partial<
      Pick<Product, 'name' | 'slug' | 'description' | 'basePrice' | 'category' | 'tags' | 'status'>
    >,
  ): Promise<void> {
    await this.repository.update(id, data);
  }

  async updateInventory(
    variantId: string,
    quantityChange: number,
    type: InventoryTransactionType,
    referenceId?: string,
    referenceType?: string,
    performedBy?: string,
    notes?: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const variant = await manager.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!variant) {
        throw new Error('Variant not found');
      }

      const newQuantity = variant.stockQuantity + quantityChange;

      if (newQuantity < 0) {
        throw new Error('Insufficient stock');
      }

      await manager.update(ProductVariant, variantId, {
        stockQuantity: newQuantity,
      });

      const transaction = manager.create(InventoryTransaction, {
        variantId,
        type,
        quantityChange,
        quantityAfter: newQuantity,
        referenceId,
        referenceType,
        performedBy,
        notes,
      });

      await manager.save(transaction);
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }
}
