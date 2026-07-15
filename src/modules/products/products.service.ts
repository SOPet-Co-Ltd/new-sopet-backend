import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, SelectQueryBuilder } from 'typeorm';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { StoreStatus } from '../../database/entities/store.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateVariantDto,
  UpdateVariantDto,
  ProductQueryDto,
} from './dto';
import { PaginatedResponse } from '../../common/interfaces';
import { generateSlug as slugify } from '../../common/utils/slug.util';
import { StoresService } from '../stores/stores.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { Tag } from '../../database/entities/tag.entity';
import {
  formatPublishChecklistMessage,
  getProductPublishChecklist,
  ProductPublishChecklist,
} from './product-publish.validation';
import { SearchService } from '../search/search.service';
import { SearchEmbeddingQueueService } from '../search/embedding/search-embedding-queue.service';
import {
  BlockedVariantPayload,
  ProductVariantSyncImpact,
  VariantRemovalBlockReason,
  VariantRemovalBlockerFlags,
} from './variant-removal.types';

type SyncVariantItem = {
  id?: string;
  sku: string;
  stockQuantity: number;
  priceModifier?: number;
  attributes: Record<string, string>;
};

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private variantRepository: Repository<ProductVariant>,
    @InjectRepository(ProductImage)
    private imageRepository: Repository<ProductImage>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    private readonly storesService: StoresService,
    private readonly taxonomyService: TaxonomyService,
    @Optional() private readonly searchService?: SearchService,
    @Optional() private readonly searchEmbeddingQueueService?: SearchEmbeddingQueueService,
  ) {}

  private async enqueueEmbeddingIfPublished(product: Product): Promise<void> {
    if (product.status !== ProductStatus.PUBLISHED) {
      return;
    }

    await this.searchEmbeddingQueueService?.enqueueProductEmbedding(product.id);
  }

  private shouldReembedAfterUpdate(
    previousStatus: ProductStatus,
    saved: Product,
    updateProductDto: UpdateProductDto,
  ): boolean {
    if (saved.status !== ProductStatus.PUBLISHED) {
      return false;
    }

    if (previousStatus !== ProductStatus.PUBLISHED) {
      return true;
    }

    const materialKeys: Array<keyof UpdateProductDto> = [
      'name',
      'description',
      'category',
      'categoryId',
      'petTypeId',
      'brandId',
      'tags',
      'tagIds',
    ];

    return materialKeys.some((key) => updateProductDto[key] !== undefined);
  }

  private async assertStoreAccess(userId: string, storeId: string, action: string): Promise<void> {
    const hasAccess = await this.storesService.userHasStoreAccess(userId, storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `You do not have permission to ${action} for this store`,
      });
    }
  }

  async resolveActiveStoreId(userId: string, storeId?: string): Promise<string> {
    if (storeId) {
      await this.assertStoreAccess(userId, storeId, 'access');
      return storeId;
    }

    const defaultStoreId = await this.storesService.resolveDefaultStoreId(userId);
    if (!defaultStoreId) {
      throw new BadRequestException({
        code: 'NO_ACTIVE_STORE',
        message: 'No active store. Switch to a store and try again.',
      });
    }

    return defaultStoreId;
  }

  private generateSlug(name: string): string {
    return slugify(name, 'product');
  }

  private async resolveTaxonomyFields(input: {
    category?: string;
    categoryId?: string;
    tags?: string[];
    tagIds?: string[];
    petTypeId?: string;
    brandId?: string;
  }): Promise<{
    category: string | null | undefined;
    categoryId: string | null | undefined;
    tags: string[] | undefined;
    taxonomyTags: Tag[] | undefined;
    petTypeId: string | null | undefined;
    brandId: string | null | undefined;
  }> {
    const hasCategoryId = input.categoryId !== undefined;
    const hasTagIds = input.tagIds !== undefined;
    const hasPetTypeId = input.petTypeId !== undefined;
    const hasBrandId = input.brandId !== undefined;

    if (!hasCategoryId && !hasTagIds && !hasPetTypeId && !hasBrandId) {
      return {
        category: input.category,
        categoryId: undefined,
        tags: input.tags,
        taxonomyTags: undefined,
        petTypeId: undefined,
        brandId: undefined,
      };
    }

    let category = input.category;
    let categoryId: string | null | undefined = input.categoryId ?? null;
    let tags = input.tags;
    let taxonomyTags: Tag[] | undefined;
    let petTypeId: string | null | undefined = input.petTypeId ?? null;
    let brandId: string | null | undefined = input.brandId ?? null;

    if (hasCategoryId) {
      if (input.categoryId) {
        const resolvedCategory = await this.taxonomyService.getApprovedCategory(input.categoryId);
        categoryId = resolvedCategory.id;
        category = resolvedCategory.name;
      } else {
        categoryId = null;
      }
    }

    if (hasTagIds) {
      taxonomyTags = await this.taxonomyService.getApprovedTags(input.tagIds ?? []);
      tags = taxonomyTags.map((tag) => tag.name);
    }

    if (hasPetTypeId) {
      if (input.petTypeId) {
        const resolvedPetType = await this.taxonomyService.getApprovedPetType(input.petTypeId);
        petTypeId = resolvedPetType.id;
      } else {
        petTypeId = null;
      }
    }

    if (hasBrandId) {
      if (input.brandId) {
        const resolvedBrand = await this.taxonomyService.getApprovedBrand(input.brandId);
        brandId = resolvedBrand.id;
      } else {
        brandId = null;
      }
    }

    return { category, categoryId, tags, taxonomyTags, petTypeId, brandId };
  }

  // Create product
  async create(
    userId: string,
    storeId: string,
    createProductDto: CreateProductDto,
  ): Promise<Product> {
    await this.assertStoreAccess(userId, storeId, 'create products');
    const { name, categoryId, tagIds, petTypeId, brandId, category, tags, ...productData } =
      createProductDto;
    const taxonomy = await this.resolveTaxonomyFields({
      category,
      categoryId,
      tags,
      tagIds,
      petTypeId,
      brandId,
    });

    // Generate unique slug within store
    let slug = this.generateSlug(name);
    let slugExists = await this.productRepository.findOne({
      where: { storeId, slug },
    });
    let counter = 1;
    while (slugExists) {
      slug = `${this.generateSlug(name)}-${counter}`;
      slugExists = await this.productRepository.findOne({
        where: { storeId, slug },
      });
      counter++;
    }

    const product = this.productRepository.create({
      ...productData,
      ...taxonomy,
      name,
      slug,
      storeId,
      status: ProductStatus.DRAFT,
    });

    return this.productRepository.save(product);
  }

  /**
   * Create a product together with its variant items for the public REST API.
   *
   * Mirrors the vendor UI create flow exactly: the caller declares variant
   * option groups (the parent "variants", e.g. "สี"/"ขนาด") plus the concrete
   * variant items (child combinations that carry sku/stock/price and select one
   * value per group). Each variant item becomes one ProductVariant row whose
   * `options` map is the selected combination — matching how `syncVariants`
   * persists the admin variants spreadsheet.
   *
   * Taxonomy is resolved by NAME against approved records (throws if missing).
   * The product base price is derived from the cheapest variant item rather
   * than accepted as input, and each item stores the difference as its price
   * adjustment. Media is not supported here.
   */
  async createWithVariants(
    userId: string,
    storeId: string,
    input: {
      name: string;
      description?: string;
      warning?: string;
      expiryDate?: string;
      category?: string;
      tags?: string[];
      petType?: string;
      brand?: string;
      variants: Array<{ name: string; values: string[] }>;
      variantItems: Array<{
        sku: string;
        stock: number;
        price: number;
        options: Record<string, string>;
      }>;
    },
  ): Promise<Product> {
    await this.assertStoreAccess(userId, storeId, 'create products');

    // Normalize + validate option groups (parent "variants")
    const groups = (input.variants ?? []).map((group) => ({
      name: group.name.trim(),
      values: [...new Set((group.values ?? []).map((value) => value.trim()).filter(Boolean))],
    }));
    if (!groups.length || groups.some((group) => !group.name || !group.values.length)) {
      throw new BadRequestException({
        code: 'VARIANTS_REQUIRED',
        message: 'At least one variant option group with a name and values is required',
      });
    }

    const groupNames = groups.map((group) => group.name);
    if (new Set(groupNames).size !== groupNames.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_VARIANT_GROUP',
        message: 'Variant option group names must be unique',
      });
    }
    const valuesByGroup = new Map(groups.map((group) => [group.name, new Set(group.values)]));

    // Validate variant items (child combinations that carry sku/stock/price)
    const items = input.variantItems ?? [];
    if (!items.length) {
      throw new BadRequestException({
        code: 'VARIANT_ITEMS_REQUIRED',
        message: 'At least one variant item is required',
      });
    }

    const skus = new Set<string>();
    const comboKeys = new Set<string>();
    for (const item of items) {
      const optionNames = Object.keys(item.options ?? {});
      // Each item must select exactly one value for every declared group
      if (
        optionNames.length !== groupNames.length ||
        !groupNames.every((name) => optionNames.includes(name))
      ) {
        throw new BadRequestException({
          code: 'INVALID_VARIANT_OPTIONS',
          message: `Variant item "${item.sku}" must specify a value for each variant group: ${groupNames.join(', ')}`,
        });
      }
      // Every selected value must be one of the group's declared values
      for (const name of groupNames) {
        const value = String(item.options[name]).trim();
        if (!valuesByGroup.get(name)!.has(value)) {
          throw new BadRequestException({
            code: 'INVALID_VARIANT_OPTIONS',
            message: `Variant item "${item.sku}" has invalid value "${value}" for option "${name}"`,
          });
        }
      }
      // Reject duplicate SKUs within the payload
      if (skus.has(item.sku)) {
        throw new BadRequestException({
          code: 'SKU_EXISTS',
          message: `Duplicate SKU "${item.sku}" in request`,
        });
      }
      skus.add(item.sku);
      // Reject duplicate option combinations
      const comboKey = groupNames
        .map((name) => `${name}:${String(item.options[name]).trim()}`)
        .join('|');
      if (comboKeys.has(comboKey)) {
        throw new BadRequestException({
          code: 'DUPLICATE_VARIANT_COMBINATION',
          message: `Duplicate variant combination for options: ${comboKey}`,
        });
      }
      comboKeys.add(comboKey);
    }

    // Pre-check SKU uniqueness before any writes (mirrors addVariant's check)
    const existingSku = await this.variantRepository.findOne({
      where: { sku: In([...skus]) },
    });
    if (existingSku) {
      throw new BadRequestException({
        code: 'SKU_EXISTS',
        message: `SKU "${existingSku.sku}" already exists`,
      });
    }

    // Resolve taxonomy by name against approved records (throws if missing)
    let categoryId: string | undefined;
    if (input.category) {
      const category = await this.taxonomyService.getApprovedCategoryByName(input.category);
      categoryId = category.id;
    }

    let tagIds: string[] | undefined;
    if (input.tags?.length) {
      const tags = await this.taxonomyService.getApprovedTagsByNames(input.tags);
      tagIds = tags.map((tag) => tag.id);
    }

    let petTypeId: string | undefined;
    if (input.petType) {
      const petType = await this.taxonomyService.getApprovedPetTypeByName(input.petType);
      petTypeId = petType.id;
    }

    let brandId: string | undefined;
    if (input.brand) {
      const brand = await this.taxonomyService.getApprovedBrandByName(input.brand);
      brandId = brand.id;
    }

    // Derive base price from the cheapest variant item; each item stores the
    // difference as its price adjustment so effective prices are preserved.
    const basePrice = Math.min(...items.map((item) => item.price));

    // Products created via the public API are always drafts; the vendor
    // reviews and publishes them from the admin panel.
    const product = await this.create(userId, storeId, {
      name: input.name,
      description: input.description,
      warning: input.warning,
      expiryDate: input.expiryDate,
      status: ProductStatus.DRAFT,
      basePrice,
      categoryId,
      tagIds,
      petTypeId,
      brandId,
    });

    // Persist each variant item as one ProductVariant (options = combination),
    // mirroring the admin variants sync (attributes only, no synthetic name).
    for (const item of items) {
      const options: Record<string, string> = {};
      for (const name of groupNames) {
        options[name] = String(item.options[name]).trim();
      }
      await this.addVariant(product.id, userId, {
        name: '',
        sku: item.sku,
        stockQuantity: item.stock,
        priceModifier: item.price - basePrice,
        attributes: options,
      });
    }

    return this.findOne(product.id);
  }

  private emptyPaginatedResponse(page: number, limit: number): PaginatedResponse<Product> {
    return {
      items: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  // Find products with filters and pagination
  async findAll(queryDto: ProductQueryDto): Promise<PaginatedResponse<Product>> {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC' } = queryDto;

    const resolvedDto: ProductQueryDto = { ...queryDto };

    const categoryArg = queryDto.category?.trim();
    if (categoryArg) {
      const resolvedCategory =
        await this.taxonomyService.resolveApprovedCategoryFilter(categoryArg);
      if (!resolvedCategory) {
        return this.emptyPaginatedResponse(page, limit);
      }
      resolvedDto.categoryId = resolvedCategory.id;
    }

    const tagArg = queryDto.tag?.trim();
    if (tagArg) {
      const resolvedTag = await this.taxonomyService.resolveApprovedTagFilter(tagArg);
      if (!resolvedTag) {
        return this.emptyPaginatedResponse(page, limit);
      }
      resolvedDto.tagId = resolvedTag.id;
      resolvedDto.tagName = resolvedTag.name;
    }

    if (resolvedDto.search?.trim() && this.searchService?.isSmartSearchEnabled()) {
      return this.searchService.searchProducts(resolvedDto);
    }

    const {
      search,
      storeId,
      categoryId,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    } = resolvedDto;

    const skip = (page - 1) * limit;
    const filters = {
      search,
      storeId,
      categoryId,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    };

    const idQueryBuilder = this.productRepository.createQueryBuilder('product');
    idQueryBuilder.select('product.id', 'id');
    this.applyProductListFilters(idQueryBuilder, filters);
    this.applyProductSorting(idQueryBuilder, sortBy, sortOrder, search);
    idQueryBuilder.offset(skip).limit(limit);

    const idRows = await idQueryBuilder.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    const countQueryBuilder = this.productRepository.createQueryBuilder('product');
    this.applyProductListFilters(countQueryBuilder, filters);
    const totalRow = await countQueryBuilder
      .select('COUNT(product.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRow?.cnt ?? 0);

    if (ids.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    const items = await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.store', 'store')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants')
      .leftJoinAndSelect('product.categoryRelation', 'categoryRelation')
      .leftJoinAndSelect('product.petTypeRelation', 'petTypeRelation')
      .leftJoinAndSelect('product.brandRelation', 'brandRelation')
      .leftJoinAndSelect('product.taxonomyTags', 'taxonomyTags')
      .where('product.id IN (:...ids)', { ids })
      .orderBy('array_position(ARRAY[:...ids]::uuid[], product.id)')
      .getMany();

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private applyProductListFilters(
    queryBuilder: SelectQueryBuilder<Product>,
    filters: {
      search?: string;
      storeId?: string;
      categoryId?: string;
      tagId?: string;
      tagName?: string;
      status?: ProductStatus;
      allStatuses?: boolean;
      petTypeIds?: string[];
      brandIds?: string[];
      minPrice?: number;
      maxPrice?: number;
    },
  ): void {
    const {
      search,
      storeId,
      categoryId,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    } = filters;

    if (search) {
      queryBuilder.andWhere('(product.name ILIKE :search OR product.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    if (storeId) {
      queryBuilder.andWhere('product.storeId = :storeId', { storeId });
    }

    if (!allStatuses) {
      queryBuilder.innerJoin('product.store', 'store');
      queryBuilder.andWhere('store.status = :approvedStoreStatus', {
        approvedStoreStatus: StoreStatus.APPROVED,
      });
    }

    if (categoryId) {
      queryBuilder.andWhere('product.categoryId = :categoryId', { categoryId });
    }

    if (tagId && tagName) {
      queryBuilder.andWhere(
        `(:tagName = ANY(product.tags) OR EXISTS (
            SELECT 1 FROM "product_tags" "pt"
            INNER JOIN "tags" "t" ON "t"."id" = "pt"."tag_id"
            WHERE "pt"."product_id" = product.id
              AND "t"."id" = :tagId
          ))`,
        { tagId, tagName },
      );
    }

    if (status) {
      queryBuilder.andWhere('product.status = :status', { status });
    } else if (!allStatuses) {
      queryBuilder.andWhere('product.status = :status', {
        status: ProductStatus.PUBLISHED,
      });
    }

    if (petTypeIds && petTypeIds.length > 0) {
      queryBuilder.andWhere('product.petTypeId IN (:...petTypeIds)', { petTypeIds });
    }

    if (brandIds && brandIds.length > 0) {
      queryBuilder.andWhere('product.brandId IN (:...brandIds)', { brandIds });
    }

    if (minPrice !== undefined) {
      queryBuilder.andWhere('product.basePrice >= :minPrice', { minPrice });
    }

    if (maxPrice !== undefined) {
      queryBuilder.andWhere('product.basePrice <= :maxPrice', { maxPrice });
    }
  }

  private applyProductSorting(
    queryBuilder: SelectQueryBuilder<Product>,
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    search?: string,
  ): void {
    const excludedStatuses = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

    if (sortBy === 'soldCount') {
      queryBuilder
        .addSelect((subQuery) => {
          return subQuery
            .select('COALESCE(SUM(oi.quantity), 0)', 'sold_count')
            .from(OrderItem, 'oi')
            .innerJoin('oi.order', 'o')
            .innerJoin('oi.productVariant', 'salesVariant')
            .where('salesVariant.productId = product.id')
            .andWhere('o.status NOT IN (:...excludedStatuses)', { excludedStatuses });
        }, 'sold_count_sort')
        .orderBy('sold_count_sort', sortOrder);
      return;
    }

    if (sortBy === 'relevance') {
      if (search) {
        queryBuilder
          .addSelect(
            'CASE WHEN product.name ILIKE :relevancePrefix THEN 0 WHEN product.name ILIKE :relevanceContains THEN 1 ELSE 2 END',
            'relevance_rank',
          )
          .setParameter('relevancePrefix', `${search}%`)
          .setParameter('relevanceContains', `%${search}%`)
          .addOrderBy('relevance_rank', 'ASC');
      }
      queryBuilder
        .addSelect('product.createdAt', 'product_created_at')
        .addOrderBy('product.createdAt', 'DESC');
      return;
    }

    const allowedColumns: Record<string, string> = {
      createdAt: 'createdAt',
      basePrice: 'basePrice',
      averageRating: 'averageRating',
      name: 'name',
    };

    const column = allowedColumns[sortBy] ?? 'createdAt';
    queryBuilder
      .addSelect(`product.${column}`, `product_${column}`)
      .orderBy(`product.${column}`, sortOrder);
  }

  // Find product by ID
  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: [
        'store',
        'images',
        'variants',
        'reviews',
        'categoryRelation',
        'petTypeRelation',
        'brandRelation',
        'taxonomyTags',
      ],
    });

    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }

    return product;
  }

  async findOnePublished(id: string): Promise<Product> {
    const product = await this.findOne(id);
    if (product.status !== ProductStatus.PUBLISHED) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }
    return product;
  }

  async findPublishedByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const products = await this.productRepository.find({
      where: { id: In(ids), status: ProductStatus.PUBLISHED },
      relations: [
        'store',
        'images',
        'variants',
        'reviews',
        'categoryRelation',
        'petTypeRelation',
        'brandRelation',
        'taxonomyTags',
      ],
    });

    const byId = new Map(products.map((product) => [product.id, product]));
    return ids.map((id) => byId.get(id)).filter((product): product is Product => product != null);
  }

  // Find product by slug
  async findBySlug(storeId: string, slug: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { storeId, slug },
      relations: [
        'store',
        'images',
        'variants',
        'reviews',
        'categoryRelation',
        'petTypeRelation',
        'brandRelation',
        'taxonomyTags',
      ],
    });

    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }

    return product;
  }

  async findBySlugPublished(storeId: string, slug: string): Promise<Product> {
    const product = await this.findBySlug(storeId, slug);
    if (product.status !== ProductStatus.PUBLISHED) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }
    return product;
  }

  getPublishChecklist(product: Product): ProductPublishChecklist {
    return getProductPublishChecklist(product);
  }

  assertPublishable(product: Product): void {
    const checklist = getProductPublishChecklist(product);
    if (!checklist.canPublish) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_PUBLISHABLE',
        message: formatPublishChecklistMessage(checklist.missingKeys),
        details: {
          missingKeys: checklist.missingKeys,
        },
      });
    }
  }

  async publish(id: string, userId: string): Promise<Product> {
    const product = await this.findOne(id);
    await this.assertStoreAccess(userId, product.storeId, 'publish products');
    this.assertPublishable(product);
    product.status = ProductStatus.PUBLISHED;
    const saved = await this.productRepository.save(product);
    await this.enqueueEmbeddingIfPublished(saved);
    return saved;
  }

  // Update product
  async update(id: string, userId: string, updateProductDto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    const previousStatus = product.status;

    await this.assertStoreAccess(userId, product.storeId, 'update products');

    const { categoryId, tagIds, petTypeId, brandId, category, tags, ...rest } = updateProductDto;
    const taxonomy = await this.resolveTaxonomyFields({
      category,
      categoryId,
      tags,
      tagIds,
      petTypeId,
      brandId,
    });

    if (rest.status === ProductStatus.PUBLISHED && product.status !== ProductStatus.PUBLISHED) {
      this.assertPublishable(product);
    }

    // Apply rest fields (skip undefined so partial updates don't clear existing values)
    Object.assign(
      product,
      Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    );

    // Apply taxonomy fields only if they are defined
    if (taxonomy.category !== undefined) {
      product.category = taxonomy.category;
    }
    if (taxonomy.categoryId !== undefined) {
      product.categoryId = taxonomy.categoryId;
    }
    if (taxonomy.tags !== undefined) {
      product.tags = taxonomy.tags;
    }
    if (taxonomy.taxonomyTags !== undefined) {
      product.taxonomyTags = taxonomy.taxonomyTags;
    }
    if (taxonomy.petTypeId !== undefined) {
      product.petTypeId = taxonomy.petTypeId;
    }
    if (taxonomy.brandId !== undefined) {
      product.brandId = taxonomy.brandId;
    }

    const saved = await this.productRepository.save(product);

    if (this.shouldReembedAfterUpdate(previousStatus, saved, updateProductDto)) {
      await this.enqueueEmbeddingIfPublished(saved);
    }

    return saved;
  }

  // Delete product (soft delete)
  async remove(id: string, userId: string): Promise<void> {
    const product = await this.findOne(id);

    await this.assertStoreAccess(userId, product.storeId, 'delete products');

    await this.productRepository.softDelete(id);
  }

  // Add variant to product
  async addVariant(
    productId: string,
    userId: string,
    createVariantDto: CreateVariantDto,
  ): Promise<ProductVariant> {
    const product = await this.findOne(productId);

    await this.assertStoreAccess(userId, product.storeId, 'manage product variants');

    // Check SKU uniqueness
    const existingVariant = await this.variantRepository.findOne({
      where: { sku: createVariantDto.sku },
    });

    if (existingVariant) {
      throw new BadRequestException({
        code: 'SKU_EXISTS',
        message: 'SKU already exists',
      });
    }

    const { name, attributes, priceModifier, sku, stockQuantity } = createVariantDto;

    const variant = this.variantRepository.create({
      productId,
      sku,
      stockQuantity,
      priceAdjustment: priceModifier ?? 0,
      options: this.buildVariantOptions(name, attributes),
    });

    return this.variantRepository.save(variant);
  }

  // Update variant
  async updateVariant(
    variantId: string,
    userId: string,
    updateVariantDto: UpdateVariantDto,
  ): Promise<ProductVariant> {
    const variant = await this.variantRepository.findOne({
      where: { id: variantId },
      relations: ['product'],
    });

    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Variant not found',
      });
    }

    await this.assertStoreAccess(userId, variant.product.storeId, 'manage product variants');

    const { name, attributes, priceModifier, sku, stockQuantity } = updateVariantDto;

    if (sku !== undefined) {
      variant.sku = sku;
    }
    if (stockQuantity !== undefined) {
      variant.stockQuantity = stockQuantity;
    }
    if (priceModifier !== undefined) {
      variant.priceAdjustment = priceModifier;
    }
    if (name !== undefined || attributes !== undefined) {
      variant.options = this.buildVariantOptions(
        name ?? variant.options?.name,
        attributes ?? variant.options,
      );
    }

    return this.variantRepository.save(variant);
  }

  // Delete variant
  async removeVariant(variantId: string, userId: string): Promise<void> {
    const variant = await this.variantRepository.findOne({
      where: { id: variantId },
      relations: ['product'],
    });

    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Variant not found',
      });
    }

    await this.assertStoreAccess(userId, variant.product.storeId, 'manage product variants');
    await this.assertRemovalsAllowed([variant]);

    await this.variantRepository.softDelete(variantId);
  }

  async getProductVariantSyncImpact(
    productId: string,
    userId: string,
    items: SyncVariantItem[],
  ): Promise<ProductVariantSyncImpact> {
    const product = await this.findOne(productId);
    await this.assertStoreAccess(userId, product.storeId, 'manage product variants');

    if (!items.length) {
      throw new BadRequestException({
        code: 'VARIANTS_REQUIRED',
        message: 'At least one variant is required',
      });
    }

    const existingVariants = product.variants ?? [];
    const plan = this.classifySyncPlan(existingVariants, items);
    const blockers = await this.evaluateRemovalBlockers(plan.remove.map((variant) => variant.id));

    const removedVariants = plan.remove.map((variant) => {
      const flags = blockers.get(variant.id) ?? { hasOrders: false, hasOpenCarts: false };
      const reasons = this.reasonsFromFlags(flags);
      return {
        id: variant.id,
        sku: variant.sku,
        optionsJson: variant.options ? JSON.stringify(variant.options) : null,
        optionKey: this.variantOptionKey(variant.options ?? {}),
        reasons,
      };
    });

    return {
      kept: plan.kept,
      new: plan.createCount,
      removed: plan.remove.length,
      blocked: removedVariants.some((entry) => entry.reasons.length > 0),
      removedVariants,
    };
  }

  async syncVariants(
    productId: string,
    userId: string,
    items: SyncVariantItem[],
  ): Promise<ProductVariant[]> {
    const product = await this.findOne(productId);

    await this.assertStoreAccess(userId, product.storeId, 'manage product variants');

    if (!items.length) {
      throw new BadRequestException({
        code: 'VARIANTS_REQUIRED',
        message: 'At least one variant is required',
      });
    }

    const existingVariants = product.variants ?? [];
    const plan = this.classifySyncPlan(existingVariants, items);
    await this.assertRemovalsAllowed(plan.remove);

    const keepIds = new Set<string>();
    const savedVariants: ProductVariant[] = [];

    for (const item of items) {
      const options = this.buildVariantOptions(undefined, item.attributes);
      const optionKey = this.variantOptionKey(options);

      const variant: ProductVariant | undefined = item.id
        ? existingVariants.find((existing) => existing.id === item.id)
        : existingVariants.find(
            (existing) => this.variantOptionKey(existing.options) === optionKey,
          );

      if (variant) {
        variant.sku = item.sku;
        variant.stockQuantity = item.stockQuantity;
        variant.priceAdjustment = item.priceModifier ?? 0;
        variant.options = options;
        savedVariants.push(await this.variantRepository.save(variant));
        keepIds.add(variant.id);
        continue;
      }

      const duplicateSku = await this.variantRepository.findOne({
        where: { sku: item.sku, productId },
      });
      if (duplicateSku) {
        throw new BadRequestException({
          code: 'SKU_EXISTS',
          message: `SKU "${item.sku}" is already in use`,
        });
      }

      const created = this.variantRepository.create({
        productId,
        sku: item.sku,
        stockQuantity: item.stockQuantity,
        priceAdjustment: item.priceModifier ?? 0,
        options,
      });
      const saved = await this.variantRepository.save(created);
      savedVariants.push(saved);
      keepIds.add(saved.id);
    }

    for (const existing of plan.remove) {
      if (!keepIds.has(existing.id)) {
        await this.variantRepository.softDelete(existing.id);
      }
    }

    return savedVariants;
  }

  private classifySyncPlan(
    existingVariants: ProductVariant[],
    items: SyncVariantItem[],
  ): { kept: number; createCount: number; remove: ProductVariant[] } {
    const keepIds = new Set<string>();
    let kept = 0;
    let createCount = 0;

    for (const item of items) {
      const options = this.buildVariantOptions(undefined, item.attributes);
      const optionKey = this.variantOptionKey(options);

      const match = item.id
        ? existingVariants.find((existing) => existing.id === item.id)
        : existingVariants.find(
            (existing) => this.variantOptionKey(existing.options) === optionKey,
          );

      if (match) {
        keepIds.add(match.id);
        kept += 1;
      } else {
        createCount += 1;
      }
    }

    return {
      kept,
      createCount,
      remove: existingVariants.filter((existing) => !keepIds.has(existing.id)),
    };
  }

  private async evaluateRemovalBlockers(
    variantIds: string[],
  ): Promise<Map<string, VariantRemovalBlockerFlags>> {
    const blockers = new Map<string, VariantRemovalBlockerFlags>();
    for (const variantId of variantIds) {
      blockers.set(variantId, { hasOrders: false, hasOpenCarts: false });
    }

    if (!variantIds.length) {
      return blockers;
    }

    const [orderRefs, cartRefs] = await Promise.all([
      this.orderItemRepository.find({
        where: { variantId: In(variantIds) },
        select: ['variantId'],
      }),
      this.cartItemRepository.find({
        where: { variantId: In(variantIds) },
        select: ['variantId'],
      }),
    ]);

    for (const row of orderRefs) {
      const flags = blockers.get(row.variantId);
      if (flags) {
        flags.hasOrders = true;
      }
    }

    for (const row of cartRefs) {
      const flags = blockers.get(row.variantId);
      if (flags) {
        flags.hasOpenCarts = true;
      }
    }

    return blockers;
  }

  private reasonsFromFlags(flags: VariantRemovalBlockerFlags): VariantRemovalBlockReason[] {
    const reasons: VariantRemovalBlockReason[] = [];
    if (flags.hasOrders) {
      reasons.push(VariantRemovalBlockReason.HAS_ORDERS);
    }
    if (flags.hasOpenCarts) {
      reasons.push(VariantRemovalBlockReason.HAS_OPEN_CARTS);
    }
    return reasons;
  }

  private async assertRemovalsAllowed(variants: ProductVariant[]): Promise<void> {
    if (!variants.length) {
      return;
    }

    const blockers = await this.evaluateRemovalBlockers(variants.map((variant) => variant.id));
    const blockedVariants: BlockedVariantPayload[] = [];

    for (const variant of variants) {
      const flags = blockers.get(variant.id) ?? { hasOrders: false, hasOpenCarts: false };
      const reasons = this.reasonsFromFlags(flags);
      if (reasons.length) {
        blockedVariants.push({
          id: variant.id,
          sku: variant.sku,
          reasons,
        });
      }
    }

    if (!blockedVariants.length) {
      return;
    }

    throw new BadRequestException({
      code: 'VARIANT_REMOVAL_BLOCKED',
      message: 'One or more variants cannot be removed because they appear in orders or open carts',
      blockedVariants,
    });
  }

  private variantOptionKey(options: Record<string, string>): string {
    return Object.entries(options)
      .filter(([key]) => key !== 'name')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
  }

  private buildVariantOptions(
    name?: string,
    attributes?: Record<string, any>,
  ): Record<string, string> {
    const options: Record<string, string> = {};

    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (key !== 'name' && value != null) {
          options[key] = String(value);
        }
      }
    }

    if (name) {
      options.name = name;
    }

    return options;
  }

  // Add image to product
  async addImage(
    productId: string,
    userId: string,
    imageUrl: string,
    sortOrder: number = 0,
    altText?: string,
    isThumbnail?: boolean,
  ): Promise<ProductImage> {
    const product = await this.findOne(productId);

    await this.assertStoreAccess(userId, product.storeId, 'manage product images');

    const existingImages = await this.imageRepository.find({
      where: { productId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const hasThumbnail = existingImages.some((img) => img.isThumbnail);
    const shouldBeThumbnail = isThumbnail === true || existingImages.length === 0 || !hasThumbnail;

    if (shouldBeThumbnail && isThumbnail !== false) {
      await this.clearThumbnails(productId);
    }

    const image = this.imageRepository.create({
      productId,
      url: imageUrl,
      sortOrder,
      altText: altText ?? null,
      isThumbnail: shouldBeThumbnail && isThumbnail !== false,
    });

    const saved = await this.imageRepository.save(image);
    await this.ensureThumbnail(productId);
    return this.imageRepository.findOneOrFail({ where: { id: saved.id } });
  }

  // Update image
  async updateImage(
    imageId: string,
    userId: string,
    updates: { sortOrder?: number; altText?: string; isThumbnail?: boolean },
  ): Promise<ProductImage> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId },
      relations: ['product'],
    });

    if (!image) {
      throw new NotFoundException({
        code: 'IMAGE_NOT_FOUND',
        message: 'Image not found',
      });
    }

    await this.assertStoreAccess(userId, image.product.storeId, 'manage product images');

    if (updates.sortOrder !== undefined) {
      image.sortOrder = updates.sortOrder;
    }
    if (updates.altText !== undefined) {
      image.altText = updates.altText;
    }
    if (updates.isThumbnail === true) {
      await this.clearThumbnails(image.productId, imageId);
      image.isThumbnail = true;
    } else if (updates.isThumbnail === false) {
      image.isThumbnail = false;
    }

    const saved = await this.imageRepository.save(image);
    await this.ensureThumbnail(image.productId);
    return this.imageRepository.findOneOrFail({ where: { id: saved.id } });
  }

  async setProductThumbnail(
    productId: string,
    imageId: string,
    userId: string,
  ): Promise<ProductImage> {
    const product = await this.findOne(productId);

    await this.assertStoreAccess(userId, product.storeId, 'manage product images');

    const image = await this.imageRepository.findOne({
      where: { id: imageId, productId },
    });

    if (!image) {
      throw new NotFoundException({
        code: 'IMAGE_NOT_FOUND',
        message: 'Image not found for this product',
      });
    }

    await this.clearThumbnails(productId, imageId);
    image.isThumbnail = true;
    return this.imageRepository.save(image);
  }

  // Reorder images (persist sequential sortOrder from the given id order)
  async reorderImages(
    productId: string,
    userId: string,
    imageIds: string[],
  ): Promise<ProductImage[]> {
    const product = await this.findOne(productId);

    await this.assertStoreAccess(userId, product.storeId, 'manage product images');

    const images = await this.imageRepository.find({ where: { productId } });
    const validIds = new Set(images.map((img) => img.id));
    for (const id of imageIds) {
      if (!validIds.has(id)) {
        throw new NotFoundException({
          code: 'IMAGE_NOT_FOUND',
          message: 'Image not found for this product',
        });
      }
    }

    await this.imageRepository.manager.transaction(async (manager) => {
      await Promise.all(
        imageIds.map((id, index) =>
          manager.update(ProductImage, { id, productId }, { sortOrder: index }),
        ),
      );
    });

    return this.imageRepository.find({
      where: { productId },
      order: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  // Delete image
  async removeImage(imageId: string, userId: string): Promise<void> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId },
      relations: ['product'],
    });

    if (!image) {
      throw new NotFoundException({
        code: 'IMAGE_NOT_FOUND',
        message: 'Image not found',
      });
    }

    await this.assertStoreAccess(userId, image.product.storeId, 'manage product images');

    const productId = image.productId;
    const wasThumbnail = image.isThumbnail;

    await this.imageRepository.delete(imageId);

    if (wasThumbnail) {
      await this.ensureThumbnail(productId);
    }
  }

  private async clearThumbnails(productId: string, exceptImageId?: string): Promise<void> {
    const qb = this.imageRepository
      .createQueryBuilder()
      .update(ProductImage)
      .set({ isThumbnail: false })
      .where('product_id = :productId', { productId })
      .andWhere('is_thumbnail = true');

    if (exceptImageId) {
      qb.andWhere('id != :exceptImageId', { exceptImageId });
    }

    await qb.execute();
  }

  private async ensureThumbnail(productId: string): Promise<void> {
    const images = await this.imageRepository.find({
      where: { productId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    if (images.length === 0) {
      return;
    }

    const hasThumbnail = images.some((img) => img.isThumbnail);
    if (hasThumbnail) {
      return;
    }

    images[0].isThumbnail = true;
    await this.imageRepository.save(images[0]);
  }
}
