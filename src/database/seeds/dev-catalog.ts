export type DevTaxonomyItem = {
  name: string;
  slug: string;
  imageUrl?: string;
};

export type DevVariantSeed = {
  sku: string;
  options: Record<string, string>;
  priceAdjustment: number;
  stockQuantity: number;
  lowStockThreshold?: number;
  weight?: number;
};

export type DevProductSeed = {
  name: string;
  slug: string;
  description: string;
  basePrice: number;
  compareAtPrice?: number;
  /** Legacy string category (kept for backward compatibility). */
  category: string;
  categorySlug: string;
  petTypeSlug: string;
  brandSlug: string;
  tagSlugs: string[];
  imageUrl: string;
  variants: DevVariantSeed[];
};

export const DEV_CATEGORIES: DevTaxonomyItem[] = [
  {
    name: 'Food',
    slug: 'food',
    imageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc2e9?w=400',
  },
  {
    name: 'Treats',
    slug: 'treats',
    imageUrl: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400',
  },
  {
    name: 'Toys',
    slug: 'toys',
    imageUrl: 'https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?w=400',
  },
  {
    name: 'Grooming',
    slug: 'grooming',
    imageUrl: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=400',
  },
  {
    name: 'Hygiene',
    slug: 'hygiene',
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400',
  },
  {
    name: 'Accessories',
    slug: 'accessories',
    imageUrl: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=400',
  },
  {
    name: 'Health',
    slug: 'health',
    imageUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=400',
  },
];

export const DEV_PET_TYPES: DevTaxonomyItem[] = [
  {
    name: 'Dog',
    slug: 'dog',
    imageUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400',
  },
  {
    name: 'Cat',
    slug: 'cat',
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400',
  },
  {
    name: 'Bird',
    slug: 'bird',
    imageUrl: 'https://images.unsplash.com/photo-1444464666168-49d633b86797?w=400',
  },
  {
    name: 'Small Pet',
    slug: 'small-pet',
    imageUrl: 'https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=400',
  },
];

export const DEV_BRANDS: DevTaxonomyItem[] = [
  { name: 'Royal Canin', slug: 'royal-canin' },
  { name: 'Pedigree', slug: 'pedigree' },
  { name: 'Whiskas', slug: 'whiskas' },
  { name: "Hill's", slug: 'hills' },
  { name: 'Purina', slug: 'purina' },
  { name: 'Kong', slug: 'kong' },
  { name: 'Frontline', slug: 'frontline' },
  { name: 'SOPet Essentials', slug: 'sopet-essentials' },
];

export const DEV_TAGS: DevTaxonomyItem[] = [
  { name: 'Best Seller', slug: 'best-seller' },
  { name: 'New Arrival', slug: 'new-arrival' },
  { name: 'Organic', slug: 'organic' },
  { name: 'Grain Free', slug: 'grain-free' },
  { name: 'Puppy', slug: 'puppy' },
  { name: 'Kitten', slug: 'kitten' },
  { name: 'Senior', slug: 'senior' },
  { name: 'Sale', slug: 'sale' },
];

export const DEV_SHIPPING_PROVIDERS = [
  { name: 'Kerry Express' },
  { name: 'Flash Express' },
  { name: 'Thailand Post' },
  { name: 'J&T Express' },
] as const;

export const DEV_STORE_SHIPPING = [
  {
    name: 'Standard Delivery',
    description: 'Nationwide delivery 3-5 business days',
    price: 50,
    sortOrder: 0,
    providerName: 'Kerry Express',
  },
  {
    name: 'Express Delivery',
    description: 'Bangkok metro 1-2 business days',
    price: 100,
    sortOrder: 1,
    providerName: 'Flash Express',
  },
  {
    name: 'Economy Parcel',
    description: 'Thailand Post economy 5-7 business days',
    price: 35,
    sortOrder: 2,
    providerName: 'Thailand Post',
  },
] as const;

/**
 * 20 published demo products with multi-option variants for local storefront/admin testing.
 */
export const DEV_PRODUCT_CATALOG: DevProductSeed[] = [
  {
    name: 'Royal Canin Adult Dog Food',
    slug: 'royal-canin-adult-dog-food',
    description: 'Complete dry food for adult dogs. Balanced protein and vitamins.',
    basePrice: 690,
    compareAtPrice: 790,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'dog',
    brandSlug: 'royal-canin',
    tagSlugs: ['best-seller', 'sale'],
    imageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc2e9?w=600',
    variants: [
      {
        sku: 'RC-DOG-2KG',
        options: { Size: '2kg' },
        priceAdjustment: 0,
        stockQuantity: 80,
        weight: 2,
      },
      {
        sku: 'RC-DOG-5KG',
        options: { Size: '5kg' },
        priceAdjustment: 400,
        stockQuantity: 60,
        weight: 5,
      },
      {
        sku: 'RC-DOG-15KG',
        options: { Size: '15kg' },
        priceAdjustment: 1400,
        stockQuantity: 25,
        weight: 15,
      },
    ],
  },
  {
    name: 'Pedigree Puppy Chicken',
    slug: 'pedigree-puppy-chicken',
    description: 'Chicken recipe dry food formulated for growing puppies.',
    basePrice: 320,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'dog',
    brandSlug: 'pedigree',
    tagSlugs: ['puppy', 'new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600',
    variants: [
      {
        sku: 'PDG-PUP-1KG',
        options: { Size: '1kg' },
        priceAdjustment: 0,
        stockQuantity: 100,
        weight: 1,
      },
      {
        sku: 'PDG-PUP-3KG',
        options: { Size: '3kg' },
        priceAdjustment: 280,
        stockQuantity: 70,
        weight: 3,
      },
    ],
  },
  {
    name: 'Whiskas Adult Cat Food',
    slug: 'whiskas-adult-cat-food',
    description: 'Tasty dry cat food with essential nutrients for adult cats.',
    basePrice: 180,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'cat',
    brandSlug: 'whiskas',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=600',
    variants: [
      {
        sku: 'WHS-CAT-1KG-CHK',
        options: { Size: '1kg', Flavour: 'Chicken' },
        priceAdjustment: 0,
        stockQuantity: 90,
        weight: 1,
      },
      {
        sku: 'WHS-CAT-1KG-TNA',
        options: { Size: '1kg', Flavour: 'Tuna' },
        priceAdjustment: 10,
        stockQuantity: 85,
        weight: 1,
      },
      {
        sku: 'WHS-CAT-3KG-CHK',
        options: { Size: '3kg', Flavour: 'Chicken' },
        priceAdjustment: 280,
        stockQuantity: 50,
        weight: 3,
      },
      {
        sku: 'WHS-CAT-3KG-TNA',
        options: { Size: '3kg', Flavour: 'Tuna' },
        priceAdjustment: 300,
        stockQuantity: 45,
        weight: 3,
      },
    ],
  },
  {
    name: "Hill's Science Diet Senior Dog",
    slug: 'hills-science-diet-senior-dog',
    description: 'Senior formula supporting joint health and digestion.',
    basePrice: 890,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'dog',
    brandSlug: 'hills',
    tagSlugs: ['senior', 'best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=600',
    variants: [
      {
        sku: 'HILL-SEN-3KG',
        options: { Size: '3kg' },
        priceAdjustment: 0,
        stockQuantity: 40,
        weight: 3,
      },
      {
        sku: 'HILL-SEN-7KG',
        options: { Size: '7kg' },
        priceAdjustment: 650,
        stockQuantity: 20,
        weight: 7,
      },
    ],
  },
  {
    name: 'Purina Pro Plan Kitten',
    slug: 'purina-pro-plan-kitten',
    description: 'High-protein kitten food for healthy growth.',
    basePrice: 450,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'cat',
    brandSlug: 'purina',
    tagSlugs: ['kitten', 'new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=600',
    variants: [
      {
        sku: 'PUR-KIT-1.5KG',
        options: { Size: '1.5kg' },
        priceAdjustment: 0,
        stockQuantity: 55,
        weight: 1.5,
      },
      {
        sku: 'PUR-KIT-3KG',
        options: { Size: '3kg' },
        priceAdjustment: 320,
        stockQuantity: 30,
        weight: 3,
      },
    ],
  },
  {
    name: 'Grain-Free Salmon Dog Treats',
    slug: 'grain-free-salmon-dog-treats',
    description: 'Soft training treats made with real salmon. Grain free.',
    basePrice: 149,
    compareAtPrice: 199,
    category: 'treats',
    categorySlug: 'treats',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['grain-free', 'organic', 'sale'],
    imageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc2e9?w=600',
    variants: [
      {
        sku: 'SE-TRT-SAL-100',
        options: { Size: '100g' },
        priceAdjustment: 0,
        stockQuantity: 120,
        weight: 0.1,
      },
      {
        sku: 'SE-TRT-SAL-250',
        options: { Size: '250g' },
        priceAdjustment: 120,
        stockQuantity: 80,
        weight: 0.25,
      },
    ],
  },
  {
    name: 'Catnip Crunchy Bites',
    slug: 'catnip-crunchy-bites',
    description: 'Crunchy cat treats infused with natural catnip.',
    basePrice: 99,
    category: 'treats',
    categorySlug: 'treats',
    petTypeSlug: 'cat',
    brandSlug: 'whiskas',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1511044568932-338bbba0a393?w=600',
    variants: [
      {
        sku: 'WHS-TRT-CHK',
        options: { Flavour: 'Chicken' },
        priceAdjustment: 0,
        stockQuantity: 150,
        weight: 0.06,
      },
      {
        sku: 'WHS-TRT-SAL',
        options: { Flavour: 'Salmon' },
        priceAdjustment: 10,
        stockQuantity: 140,
        weight: 0.06,
      },
    ],
  },
  {
    name: 'Kong Classic Chew Toy',
    slug: 'kong-classic-chew-toy',
    description: 'Durable rubber chew toy. Stuff with treats for longer play.',
    basePrice: 390,
    category: 'toys',
    categorySlug: 'toys',
    petTypeSlug: 'dog',
    brandSlug: 'kong',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?w=600',
    variants: [
      {
        sku: 'KONG-S-RED',
        options: { Size: 'S', Color: 'Red' },
        priceAdjustment: 0,
        stockQuantity: 60,
      },
      {
        sku: 'KONG-M-RED',
        options: { Size: 'M', Color: 'Red' },
        priceAdjustment: 80,
        stockQuantity: 70,
      },
      {
        sku: 'KONG-L-RED',
        options: { Size: 'L', Color: 'Red' },
        priceAdjustment: 160,
        stockQuantity: 40,
      },
      {
        sku: 'KONG-M-BLU',
        options: { Size: 'M', Color: 'Blue' },
        priceAdjustment: 80,
        stockQuantity: 35,
      },
    ],
  },
  {
    name: 'Feather Wand Cat Toy',
    slug: 'feather-wand-cat-toy',
    description: 'Interactive wand toy with replaceable feather attachments.',
    basePrice: 129,
    category: 'toys',
    categorySlug: 'toys',
    petTypeSlug: 'cat',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=600',
    variants: [
      { sku: 'SE-WAND-NAT', options: { Color: 'Natural' }, priceAdjustment: 0, stockQuantity: 90 },
      { sku: 'SE-WAND-PNK', options: { Color: 'Pink' }, priceAdjustment: 0, stockQuantity: 75 },
    ],
  },
  {
    name: 'Squeaky Plush Bone',
    slug: 'squeaky-plush-bone',
    description: 'Soft plush bone with squeaker for fetch and tug.',
    basePrice: 199,
    category: 'toys',
    categorySlug: 'toys',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['sale'],
    imageUrl: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=600',
    variants: [
      { sku: 'SE-BONE-S', options: { Size: 'S' }, priceAdjustment: 0, stockQuantity: 100 },
      { sku: 'SE-BONE-M', options: { Size: 'M' }, priceAdjustment: 40, stockQuantity: 90 },
      { sku: 'SE-BONE-L', options: { Size: 'L' }, priceAdjustment: 80, stockQuantity: 50 },
    ],
  },
  {
    name: 'Oatmeal Pet Shampoo',
    slug: 'oatmeal-pet-shampoo',
    description: 'Gentle oatmeal shampoo suitable for dogs and cats with sensitive skin.',
    basePrice: 250,
    category: 'grooming',
    categorySlug: 'grooming',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['organic', 'best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600',
    variants: [
      {
        sku: 'SE-SHAM-250',
        options: { Size: '250ml' },
        priceAdjustment: 0,
        stockQuantity: 80,
        weight: 0.25,
      },
      {
        sku: 'SE-SHAM-500',
        options: { Size: '500ml' },
        priceAdjustment: 120,
        stockQuantity: 60,
        weight: 0.5,
      },
    ],
  },
  {
    name: 'Deshedding Brush',
    slug: 'deshedding-brush',
    description: 'Stainless steel deshedding tool for medium to long coats.',
    basePrice: 349,
    category: 'grooming',
    categorySlug: 'grooming',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=600',
    variants: [
      { sku: 'SE-BRUSH-S', options: { Size: 'S' }, priceAdjustment: 0, stockQuantity: 45 },
      { sku: 'SE-BRUSH-L', options: { Size: 'L' }, priceAdjustment: 80, stockQuantity: 40 },
    ],
  },
  {
    name: 'Clumping Cat Litter',
    slug: 'clumping-cat-litter',
    description: 'Low-dust clumping litter with odor control.',
    basePrice: 220,
    compareAtPrice: 280,
    category: 'hygiene',
    categorySlug: 'hygiene',
    petTypeSlug: 'cat',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['best-seller', 'sale'],
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=600',
    variants: [
      {
        sku: 'SE-LIT-5L',
        options: { Size: '5L' },
        priceAdjustment: 0,
        stockQuantity: 110,
        weight: 4,
      },
      {
        sku: 'SE-LIT-10L',
        options: { Size: '10L' },
        priceAdjustment: 150,
        stockQuantity: 70,
        weight: 8,
      },
      {
        sku: 'SE-LIT-20L',
        options: { Size: '20L' },
        priceAdjustment: 350,
        stockQuantity: 30,
        weight: 16,
      },
    ],
  },
  {
    name: 'Puppy Training Pads',
    slug: 'puppy-training-pads',
    description: 'Absorbent pee pads with leak-proof backing.',
    basePrice: 189,
    category: 'hygiene',
    categorySlug: 'hygiene',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['puppy'],
    imageUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=600',
    variants: [
      { sku: 'SE-PAD-30', options: { Pack: '30pcs' }, priceAdjustment: 0, stockQuantity: 95 },
      { sku: 'SE-PAD-100', options: { Pack: '100pcs' }, priceAdjustment: 280, stockQuantity: 40 },
    ],
  },
  {
    name: 'Adjustable Nylon Dog Collar',
    slug: 'adjustable-nylon-dog-collar',
    description: 'Lightweight nylon collar with quick-release buckle.',
    basePrice: 159,
    category: 'accessories',
    categorySlug: 'accessories',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=600',
    variants: [
      {
        sku: 'SE-COL-S-BLK',
        options: { Size: 'S', Color: 'Black' },
        priceAdjustment: 0,
        stockQuantity: 70,
      },
      {
        sku: 'SE-COL-M-BLK',
        options: { Size: 'M', Color: 'Black' },
        priceAdjustment: 20,
        stockQuantity: 80,
      },
      {
        sku: 'SE-COL-L-BLK',
        options: { Size: 'L', Color: 'Black' },
        priceAdjustment: 40,
        stockQuantity: 55,
      },
      {
        sku: 'SE-COL-M-RED',
        options: { Size: 'M', Color: 'Red' },
        priceAdjustment: 20,
        stockQuantity: 50,
      },
      {
        sku: 'SE-COL-M-BLU',
        options: { Size: 'M', Color: 'Blue' },
        priceAdjustment: 20,
        stockQuantity: 50,
      },
    ],
  },
  {
    name: 'Cat Harness & Leash Set',
    slug: 'cat-harness-leash-set',
    description: 'Escape-resistant harness with matching leash for outdoor walks.',
    basePrice: 299,
    category: 'accessories',
    categorySlug: 'accessories',
    petTypeSlug: 'cat',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=600',
    variants: [
      {
        sku: 'SE-HAR-S-GRY',
        options: { Size: 'S', Color: 'Grey' },
        priceAdjustment: 0,
        stockQuantity: 40,
      },
      {
        sku: 'SE-HAR-M-GRY',
        options: { Size: 'M', Color: 'Grey' },
        priceAdjustment: 30,
        stockQuantity: 45,
      },
      {
        sku: 'SE-HAR-S-PNK',
        options: { Size: 'S', Color: 'Pink' },
        priceAdjustment: 0,
        stockQuantity: 35,
      },
    ],
  },
  {
    name: 'Stainless Steel Pet Bowl',
    slug: 'stainless-steel-pet-bowl',
    description: 'Non-slip stainless steel bowl for food or water.',
    basePrice: 129,
    category: 'accessories',
    categorySlug: 'accessories',
    petTypeSlug: 'dog',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=600',
    variants: [
      { sku: 'SE-BWL-S', options: { Size: 'S' }, priceAdjustment: 0, stockQuantity: 100 },
      { sku: 'SE-BWL-M', options: { Size: 'M' }, priceAdjustment: 40, stockQuantity: 90 },
      { sku: 'SE-BWL-L', options: { Size: 'L' }, priceAdjustment: 80, stockQuantity: 60 },
    ],
  },
  {
    name: 'Frontline Plus Spot-On',
    slug: 'frontline-plus-spot-on',
    description: 'Flea and tick protection for dogs. Apply monthly.',
    basePrice: 520,
    category: 'health',
    categorySlug: 'health',
    petTypeSlug: 'dog',
    brandSlug: 'frontline',
    tagSlugs: ['best-seller'],
    imageUrl: 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=600',
    variants: [
      { sku: 'FL-DOG-S', options: { Size: 'S (2-10kg)' }, priceAdjustment: 0, stockQuantity: 50 },
      { sku: 'FL-DOG-M', options: { Size: 'M (10-20kg)' }, priceAdjustment: 80, stockQuantity: 55 },
      {
        sku: 'FL-DOG-L',
        options: { Size: 'L (20-40kg)' },
        priceAdjustment: 160,
        stockQuantity: 40,
      },
    ],
  },
  {
    name: 'Dental Care Chews',
    slug: 'dental-care-chews',
    description: 'Daily dental chews that help reduce plaque and tartar.',
    basePrice: 279,
    category: 'health',
    categorySlug: 'health',
    petTypeSlug: 'dog',
    brandSlug: 'pedigree',
    tagSlugs: ['best-seller', 'sale'],
    imageUrl: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=600',
    variants: [
      {
        sku: 'PDG-DNT-S',
        options: { Size: 'S', Pack: '28pcs' },
        priceAdjustment: 0,
        stockQuantity: 65,
      },
      {
        sku: 'PDG-DNT-M',
        options: { Size: 'M', Pack: '28pcs' },
        priceAdjustment: 60,
        stockQuantity: 60,
      },
      {
        sku: 'PDG-DNT-L',
        options: { Size: 'L', Pack: '28pcs' },
        priceAdjustment: 120,
        stockQuantity: 40,
      },
    ],
  },
  {
    name: 'Bird Seed Mix Premium',
    slug: 'bird-seed-mix-premium',
    description: 'Fortified seed blend for parakeets and small exotic birds.',
    basePrice: 159,
    category: 'food',
    categorySlug: 'food',
    petTypeSlug: 'bird',
    brandSlug: 'sopet-essentials',
    tagSlugs: ['organic', 'new-arrival'],
    imageUrl: 'https://images.unsplash.com/photo-1444464666168-49d633b86797?w=600',
    variants: [
      {
        sku: 'SE-BRD-500',
        options: { Size: '500g' },
        priceAdjustment: 0,
        stockQuantity: 70,
        weight: 0.5,
      },
      {
        sku: 'SE-BRD-1KG',
        options: { Size: '1kg' },
        priceAdjustment: 100,
        stockQuantity: 45,
        weight: 1,
      },
    ],
  },
];
