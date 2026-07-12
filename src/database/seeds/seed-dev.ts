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
import { DEV_ADMIN_EMAIL, DEV_VENDOR_EMAIL, SEED_PASSWORD } from './constants';
import { DEV_PRODUCT_CATALOG } from './dev-catalog';
import { assertLocalDevOnly } from './guards';
import { createDataSource, findOrCreateUser } from './helpers';

config();

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

    await seedDevCatalog(approvedStore.id, productRepo, variantRepo, imageRepo);

    await seedDevPromotion(promotionRepo);
    await seedDevShipping(shippingOptionRepo, approvedStore.id);

    console.log('\n--- Dev seed complete ---');
    console.log(`Admin:  ${DEV_ADMIN_EMAIL} / ${SEED_PASSWORD}`);
    console.log(`Vendor: ${DEV_VENDOR_EMAIL} / ${SEED_PASSWORD}`);
    console.log('Storefront: http://localhost:3000');
    console.log('Admin:      http://localhost:3001');
    console.log('Promo code: WELCOME10 (10% off, min ฿200)');
  } finally {
    await dataSource.destroy();
  }
}

async function seedDevCatalog(
  storeId: string,
  productRepo: Repository<Product>,
  variantRepo: Repository<ProductVariant>,
  imageRepo: Repository<ProductImage>,
): Promise<void> {
  for (const item of DEV_PRODUCT_CATALOG) {
    const existing = await productRepo.findOne({
      where: { storeId, slug: item.slug },
    });
    if (existing) {
      continue;
    }

    const product = await productRepo.save(
      productRepo.create({
        storeId,
        name: item.name,
        slug: item.slug,
        description: item.description,
        basePrice: item.basePrice,
        category: item.category,
        status: ProductStatus.DRAFT,
        tags: ['pet', item.category],
      }),
    );

    await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: item.sku,
        options: { default: 'standard' },
        priceAdjustment: 0,
        stockQuantity: 100,
      }),
    );

    await imageRepo.save(
      imageRepo.create({
        productId: product.id,
        url: item.imageUrl,
        altText: item.name,
        sortOrder: 0,
      }),
    );
  }
  console.log('Seeded products with variants and images');
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
): Promise<void> {
  const existingShipping = await shippingOptionRepo.findOne({
    where: { storeId, name: 'Standard Delivery' },
  });
  if (existingShipping) {
    return;
  }

  await shippingOptionRepo.save(
    shippingOptionRepo.create({
      storeId,
      name: 'Standard Delivery',
      description: 'Nationwide delivery 3-5 business days',
      price: 50,
      sortOrder: 0,
      isActive: true,
    }),
  );
  await shippingOptionRepo.save(
    shippingOptionRepo.create({
      storeId,
      name: 'Express Delivery',
      description: 'Bangkok metro 1-2 business days',
      price: 100,
      sortOrder: 1,
      isActive: true,
    }),
  );
  console.log('Seeded store shipping options');
}

if (require.main === module) {
  runDevSeed().catch((error) => {
    console.error('Dev seed failed:', error);
    process.exit(1);
  });
}
