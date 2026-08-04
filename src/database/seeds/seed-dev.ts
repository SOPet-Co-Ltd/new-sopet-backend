import { config } from 'dotenv';
import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { Store, StoreStatus } from '../entities/store.entity';
import { Product, ProductStatus } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductImage } from '../entities/product-image.entity';
import { Promotion, PromotionScope, PromotionType } from '../entities/promotion.entity';
import { StoreShippingOption } from '../entities/store-shipping-option.entity';
import { StoreMember, StoreMemberRole } from '../entities/store-member.entity';
import { Category } from '../entities/category.entity';
import { Brand } from '../entities/brand.entity';
import { PetType } from '../entities/pet-type.entity';
import { Tag } from '../entities/tag.entity';
import { ShippingProvider } from '../entities/shipping-provider.entity';
import { DEV_ADMIN_EMAIL, DEV_VENDOR_EMAIL, SEED_PASSWORD } from './constants';
import {
  DEV_BRANDS,
  DEV_CATEGORIES,
  DEV_PET_TYPES,
  DEV_PRODUCT_CATALOG,
  DEV_SHIPPING_PROVIDERS,
  DEV_STORE_SHIPPING,
  DEV_TAGS,
} from './dev-catalog';
import { assertLocalDevOnly } from './guards';
import { createDataSource, findOrCreateTaxonomyBySlug, findOrCreateUser } from './helpers';

config();

type TaxonomyMaps = {
  categories: Map<string, Category>;
  petTypes: Map<string, PetType>;
  brands: Map<string, Brand>;
  tags: Map<string, Tag>;
};

export async function runDevSeed(): Promise<void> {
  assertLocalDevOnly('dev seed');
  const dataSource = await createDataSource();

  try {
    const userRepo = dataSource.getRepository(User);
    const storeRepo = dataSource.getRepository(Store);
    const memberRepo = dataSource.getRepository(StoreMember);
    const productRepo = dataSource.getRepository(Product);
    const variantRepo = dataSource.getRepository(ProductVariant);
    const imageRepo = dataSource.getRepository(ProductImage);
    const promotionRepo = dataSource.getRepository(Promotion);
    const shippingOptionRepo = dataSource.getRepository(StoreShippingOption);
    const categoryRepo = dataSource.getRepository(Category);
    const brandRepo = dataSource.getRepository(Brand);
    const petTypeRepo = dataSource.getRepository(PetType);
    const tagRepo = dataSource.getRepository(Tag);
    const shippingProviderRepo = dataSource.getRepository(ShippingProvider);

    const { user: admin, created: adminCreated } = await findOrCreateUser(userRepo, {
      email: DEV_ADMIN_EMAIL,
      password: SEED_PASSWORD,
      fullName: 'Admin SOPet',
      role: UserRole.ADMIN,
    });
    if (adminCreated) {
      console.log(`Created admin user (${DEV_ADMIN_EMAIL})`);
    }

    const { user: vendor, created: vendorCreated } = await findOrCreateUser(userRepo, {
      email: DEV_VENDOR_EMAIL,
      password: SEED_PASSWORD,
      fullName: 'Vendor SOPet',
      role: UserRole.VENDOR,
    });
    if (vendorCreated) {
      console.log(`Created vendor user (${DEV_VENDOR_EMAIL})`);
    }

    let approvedStore = await storeRepo.findOne({
      where: { slug: 'sopet-pet-shop' },
    });
    if (!approvedStore) {
      approvedStore = await storeRepo.save(
        storeRepo.create({
          ownerId: vendor.id,
          name: 'SOPet Pet Shop',
          slug: 'sopet-pet-shop',
          description: 'Your trusted Bangkok pet supplies store.',
          status: StoreStatus.APPROVED,
          approvedBy: admin.id,
          approvedAt: new Date(),
          contactEmail: DEV_VENDOR_EMAIL,
          contactPhone: '+66812345678',
          address: '123 Sukhumvit Rd, Bangkok',
        }),
      );
      console.log('Created approved store');
    }

    const existingMembership = await memberRepo.findOne({
      where: { storeId: approvedStore.id, userId: vendor.id },
    });
    if (!existingMembership) {
      await memberRepo.save(
        memberRepo.create({
          storeId: approvedStore.id,
          userId: vendor.id,
          role: StoreMemberRole.OWNER,
        }),
      );
      console.log('Created store owner membership');
    }

    const taxonomy = await seedTaxonomy(admin.id, categoryRepo, brandRepo, petTypeRepo, tagRepo);

    const providersByName = await seedShippingProviders(shippingProviderRepo);

    await seedDevCatalog(approvedStore.id, taxonomy, productRepo, variantRepo, imageRepo);

    await seedDevPromotion(promotionRepo);
    await seedDevShipping(shippingOptionRepo, approvedStore.id, providersByName);

    console.log('\n--- Dev seed complete ---');
    console.log(`Admin:  ${DEV_ADMIN_EMAIL} / ${SEED_PASSWORD}`);
    console.log(`Vendor: ${DEV_VENDOR_EMAIL} / ${SEED_PASSWORD}`);
    console.log(`Store:  ${approvedStore.name} (${approvedStore.slug})`);
    console.log(`Catalog: ${DEV_PRODUCT_CATALOG.length} products (published)`);
    console.log(
      `Taxonomy: ${DEV_CATEGORIES.length} categories, ${DEV_PET_TYPES.length} pet types, ` +
        `${DEV_BRANDS.length} brands, ${DEV_TAGS.length} tags`,
    );
    console.log(`Shipping providers: ${DEV_SHIPPING_PROVIDERS.length}`);
    console.log('Storefront: http://localhost:3000');
    console.log('Admin:      http://localhost:3001');
    console.log('Promo code: WELCOME10 (10% off, min ฿200)');
  } finally {
    await dataSource.destroy();
  }
}

async function seedTaxonomy(
  createdBy: string,
  categoryRepo: Repository<Category>,
  brandRepo: Repository<Brand>,
  petTypeRepo: Repository<PetType>,
  tagRepo: Repository<Tag>,
): Promise<TaxonomyMaps> {
  const categories = new Map<string, Category>();
  const petTypes = new Map<string, PetType>();
  const brands = new Map<string, Brand>();
  const tags = new Map<string, Tag>();

  let createdCategories = 0;
  for (const item of DEV_CATEGORIES) {
    const { entity, created } = await findOrCreateTaxonomyBySlug(categoryRepo, {
      name: item.name,
      slug: item.slug,
      createdBy,
      imageUrl: item.imageUrl ?? null,
    });
    categories.set(item.slug, entity);
    if (created) createdCategories += 1;
  }

  let createdPetTypes = 0;
  for (const item of DEV_PET_TYPES) {
    const { entity, created } = await findOrCreateTaxonomyBySlug(petTypeRepo, {
      name: item.name,
      slug: item.slug,
      createdBy,
      imageUrl: item.imageUrl ?? null,
    });
    petTypes.set(item.slug, entity);
    if (created) createdPetTypes += 1;
  }

  let createdBrands = 0;
  for (const item of DEV_BRANDS) {
    const { entity, created } = await findOrCreateTaxonomyBySlug(brandRepo, {
      name: item.name,
      slug: item.slug,
      createdBy,
    });
    brands.set(item.slug, entity);
    if (created) createdBrands += 1;
  }

  let createdTags = 0;
  for (const item of DEV_TAGS) {
    const { entity, created } = await findOrCreateTaxonomyBySlug(tagRepo, {
      name: item.name,
      slug: item.slug,
      createdBy,
    });
    tags.set(item.slug, entity);
    if (created) createdTags += 1;
  }

  console.log(
    `Seeded taxonomy (new: ${createdCategories} categories, ${createdPetTypes} pet types, ` +
      `${createdBrands} brands, ${createdTags} tags)`,
  );

  return { categories, petTypes, brands, tags };
}

async function seedShippingProviders(
  shippingProviderRepo: Repository<ShippingProvider>,
): Promise<Map<string, ShippingProvider>> {
  const byName = new Map<string, ShippingProvider>();
  let createdCount = 0;

  for (const item of DEV_SHIPPING_PROVIDERS) {
    let provider = await shippingProviderRepo.findOne({ where: { name: item.name } });
    if (!provider) {
      provider = await shippingProviderRepo.save(
        shippingProviderRepo.create({
          name: item.name,
          isActive: true,
        }),
      );
      createdCount += 1;
    } else if (!provider.isActive) {
      provider.isActive = true;
      provider = await shippingProviderRepo.save(provider);
    }
    byName.set(item.name, provider);
  }

  console.log(`Seeded shipping providers (new: ${createdCount})`);
  return byName;
}

async function seedDevCatalog(
  storeId: string,
  taxonomy: TaxonomyMaps,
  productRepo: Repository<Product>,
  variantRepo: Repository<ProductVariant>,
  imageRepo: Repository<ProductImage>,
): Promise<void> {
  let createdProducts = 0;

  for (const item of DEV_PRODUCT_CATALOG) {
    const category = taxonomy.categories.get(item.categorySlug);
    const petType = taxonomy.petTypes.get(item.petTypeSlug);
    const brand = taxonomy.brands.get(item.brandSlug);
    if (!category || !petType || !brand) {
      throw new Error(
        `Missing taxonomy for product "${item.slug}" ` +
          `(category=${item.categorySlug}, petType=${item.petTypeSlug}, brand=${item.brandSlug})`,
      );
    }

    const productTags = item.tagSlugs.map((slug) => {
      const tag = taxonomy.tags.get(slug);
      if (!tag) {
        throw new Error(`Missing tag "${slug}" for product "${item.slug}"`);
      }
      return tag;
    });

    let product = await productRepo.findOne({
      where: { storeId, slug: item.slug },
      relations: ['taxonomyTags'],
    });

    if (!product) {
      product = await productRepo.save(
        productRepo.create({
          storeId,
          name: item.name,
          slug: item.slug,
          description: item.description,
          basePrice: item.basePrice,
          compareAtPrice: item.compareAtPrice ?? null,
          category: item.category,
          categoryId: category.id,
          petTypeId: petType.id,
          brandId: brand.id,
          status: ProductStatus.PUBLISHED,
          tags: [item.category, ...item.tagSlugs],
          taxonomyTags: productTags,
        }),
      );
      createdProducts += 1;

      for (const variant of item.variants) {
        await variantRepo.save(
          variantRepo.create({
            productId: product.id,
            sku: variant.sku,
            options: variant.options,
            priceAdjustment: variant.priceAdjustment,
            stockQuantity: variant.stockQuantity,
            lowStockThreshold: variant.lowStockThreshold ?? 10,
            weight: variant.weight ?? null,
          }),
        );
      }

      await imageRepo.save(
        imageRepo.create({
          productId: product.id,
          url: item.imageUrl,
          altText: item.name,
          sortOrder: 0,
          isThumbnail: true,
        }),
      );
      continue;
    }

    // Keep existing products aligned with taxonomy + published status on re-seed.
    product.name = item.name;
    product.description = item.description;
    product.basePrice = item.basePrice;
    product.compareAtPrice = item.compareAtPrice ?? null;
    product.category = item.category;
    product.categoryId = category.id;
    product.petTypeId = petType.id;
    product.brandId = brand.id;
    product.status = ProductStatus.PUBLISHED;
    product.tags = [item.category, ...item.tagSlugs];
    product.taxonomyTags = productTags;
    await productRepo.save(product);

    const existingVariants = await variantRepo.find({ where: { productId: product.id } });
    const existingBySku = new Map(existingVariants.map((variant) => [variant.sku, variant]));

    for (const variant of item.variants) {
      const current = existingBySku.get(variant.sku);
      if (current) {
        current.options = variant.options;
        current.priceAdjustment = variant.priceAdjustment;
        current.stockQuantity = variant.stockQuantity;
        current.lowStockThreshold = variant.lowStockThreshold ?? current.lowStockThreshold;
        current.weight = variant.weight ?? current.weight;
        await variantRepo.save(current);
        continue;
      }

      await variantRepo.save(
        variantRepo.create({
          productId: product.id,
          sku: variant.sku,
          options: variant.options,
          priceAdjustment: variant.priceAdjustment,
          stockQuantity: variant.stockQuantity,
          lowStockThreshold: variant.lowStockThreshold ?? 10,
          weight: variant.weight ?? null,
        }),
      );
    }

    const existingImage = await imageRepo.findOne({
      where: { productId: product.id },
      order: { sortOrder: 'ASC' },
    });
    if (!existingImage) {
      await imageRepo.save(
        imageRepo.create({
          productId: product.id,
          url: item.imageUrl,
          altText: item.name,
          sortOrder: 0,
          isThumbnail: true,
        }),
      );
    }
  }

  console.log(
    `Seeded products with variants and images (new: ${createdProducts} / total: ${DEV_PRODUCT_CATALOG.length})`,
  );
}

async function seedDevPromotion(promotionRepo: Repository<Promotion>): Promise<void> {
  const promo = await promotionRepo.findOne({ where: { code: 'WELCOME10' } });
  if (promo) {
    return;
  }

  await promotionRepo.save(
    promotionRepo.create({
      code: 'WELCOME10',
      name: 'Welcome 10% Off',
      description: '10% off your first order',
      type: PromotionType.PERCENTAGE,
      scope: PromotionScope.PLATFORM,
      discountValue: 10,
      minPurchaseAmount: 200,
      usageLimit: 1000,
      usagePerCustomer: 1,
      isActive: true,
      autoApply: false,
      priority: 10,
    }),
  );
  console.log('Created promotion WELCOME10');
}

async function seedDevShipping(
  shippingOptionRepo: Repository<StoreShippingOption>,
  storeId: string,
  providersByName: Map<string, ShippingProvider>,
): Promise<void> {
  let createdCount = 0;

  for (const option of DEV_STORE_SHIPPING) {
    const existing = await shippingOptionRepo.findOne({
      where: { storeId, name: option.name },
    });
    const provider = providersByName.get(option.providerName) ?? null;

    if (existing) {
      existing.description = option.description;
      existing.price = option.price;
      existing.sortOrder = option.sortOrder;
      existing.isActive = true;
      existing.providerId = provider?.id ?? null;
      await shippingOptionRepo.save(existing);
      continue;
    }

    await shippingOptionRepo.save(
      shippingOptionRepo.create({
        storeId,
        name: option.name,
        description: option.description,
        price: option.price,
        sortOrder: option.sortOrder,
        isActive: true,
        providerId: provider?.id ?? null,
      }),
    );
    createdCount += 1;
  }

  console.log(`Seeded store shipping options (new: ${createdCount})`);
}

if (require.main === module) {
  runDevSeed().catch((error) => {
    console.error('Dev seed failed:', error);
    process.exit(1);
  });
}
