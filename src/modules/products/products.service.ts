import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Between, In } from 'typeorm';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
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

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private variantRepository: Repository<ProductVariant>,
    @InjectRepository(ProductImage)
    private imageRepository: Repository<ProductImage>,
    private readonly storesService: StoresService,
    private readonly taxonomyService: TaxonomyService,
  ) {}

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
  }): Promise<{
    category: string | null | undefined;
    categoryId: string | null | undefined;
    tags: string[] | undefined;
    taxonomyTags: Tag[] | undefined;
  }> {
    const hasCategoryId = input.categoryId !== undefined;
    const hasTagIds = input.tagIds !== undefined;

    if (!hasCategoryId && !hasTagIds) {
      return {
        category: input.category,
        categoryId: undefined,
        tags: input.tags,
        taxonomyTags: undefined,
      };
    }

    let category = input.category;
    let categoryId: string | null | undefined = input.categoryId ?? null;
    let tags = input.tags;
    let taxonomyTags: Tag[] | undefined;

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

    return { category, categoryId, tags, taxonomyTags };
  }

  // Create product
  async create(
    userId: string,
    storeId: string,
    createProductDto: CreateProductDto,
  ): Promise<Product> {
    await this.assertStoreAccess(userId, storeId, 'create products');
    const { name, categoryId, tagIds, category, tags, ...productData } = createProductDto;
    const taxonomy = await this.resolveTaxonomyFields({
      category,
      categoryId,
      tags,
      tagIds,
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

  // Find products with filters and pagination
  async findAll(queryDto: ProductQueryDto): Promise<PaginatedResponse<Product>> {
    const {
      search,
      storeId,
      category,
      tag,
      status,
      allStatuses,
      minPrice,
      maxPrice,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = queryDto;

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.store', 'store')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants')
      .leftJoinAndSelect('product.categoryRelation', 'categoryRelation')
      .leftJoinAndSelect('product.taxonomyTags', 'taxonomyTags');

    // Apply filters
    if (search) {
      queryBuilder.andWhere('(product.name ILIKE :search OR product.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    if (storeId) {
      queryBuilder.andWhere('product.storeId = :storeId', { storeId });
    }

    if (category) {
      queryBuilder.andWhere('product.category = :category', { category });
    }

    if (tag) {
      // Match either the legacy free-form tags array or approved taxonomy tags
      // (by slug or name), without disturbing the selected relations or count.
      queryBuilder.andWhere(
        `(:tag = ANY(product.tags) OR EXISTS (
            SELECT 1 FROM "product_tags" "pt"
            INNER JOIN "tags" "t" ON "t"."id" = "pt"."tag_id"
            WHERE "pt"."product_id" = product.id
              AND ("t"."slug" = :tag OR "t"."name" = :tag)
          ))`,
        { tag },
      );
    }

    if (status) {
      queryBuilder.andWhere('product.status = :status', { status });
    } else if (!allStatuses) {
      // Default to published products for public listing
      queryBuilder.andWhere('product.status = :status', {
        status: ProductStatus.PUBLISHED,
      });
    }

    if (minPrice !== undefined) {
      queryBuilder.andWhere('product.basePrice >= :minPrice', { minPrice });
    }

    if (maxPrice !== undefined) {
      queryBuilder.andWhere('product.basePrice <= :maxPrice', { maxPrice });
    }

    // Sorting
    queryBuilder.orderBy(`product.${sortBy}`, sortOrder);

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

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

  // Find product by ID
  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['store', 'images', 'variants', 'reviews', 'categoryRelation', 'taxonomyTags'],
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
      relations: ['store', 'images', 'variants', 'reviews', 'categoryRelation', 'taxonomyTags'],
    });

    const byId = new Map(products.map((product) => [product.id, product]));
    return ids.map((id) => byId.get(id)).filter((product): product is Product => product != null);
  }

  // Find product by slug
  async findBySlug(storeId: string, slug: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { storeId, slug },
      relations: ['store', 'images', 'variants', 'reviews', 'categoryRelation', 'taxonomyTags'],
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
    return this.productRepository.save(product);
  }

  // Update product
  async update(id: string, userId: string, updateProductDto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    await this.assertStoreAccess(userId, product.storeId, 'update products');

    const { categoryId, tagIds, category, tags, ...rest } = updateProductDto;
    const taxonomy = await this.resolveTaxonomyFields({
      category,
      categoryId,
      tags,
      tagIds,
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

    return this.productRepository.save(product);
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

    await this.variantRepository.softDelete(variantId);
  }

  async syncVariants(
    productId: string,
    userId: string,
    items: Array<{
      id?: string;
      sku: string;
      stockQuantity: number;
      priceModifier?: number;
      attributes: Record<string, string>;
    }>,
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

    for (const existing of existingVariants) {
      if (!keepIds.has(existing.id)) {
        await this.variantRepository.softDelete(existing.id);
      }
    }

    return savedVariants;
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
