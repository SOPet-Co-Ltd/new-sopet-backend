import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_FIELDS, PRODUCT_TYPE_FORBIDDEN_FIELDS } from './products';

/** Allowed scalar/list fields on ProductType (schema.gql). Nested objects omitted from flat PRODUCT_FIELDS. */
const PRODUCT_TYPE_ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'slug',
  'description',
  'basePrice',
  'compareAtPrice',
  'status',
  'storeId',
  'categoryId',
  'category',
  'petTypeId',
  'brandId',
  'brandName',
  'warning',
  'expiryDate',
  'thumbnailUrl',
  'tagIds',
  'tags',
  'averageRating',
  'reviewCount',
  'soldCount',
]);

function tokensFromSelection(selection: string): string[] {
  return selection
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

describe('MCP ProductType selection guard', () => {
  it('PRODUCT_FIELDS only uses fields that exist on ProductType', () => {
    const tokens = tokensFromSelection(PRODUCT_FIELDS);
    expect(tokens.length).toBeGreaterThan(0);
    for (const field of tokens) {
      expect(PRODUCT_TYPE_ALLOWED_FIELDS.has(field)).toBe(true);
    }
  });

  it('PRODUCT_FIELDS never includes known-invalid ProductType fields', () => {
    const tokens = new Set(tokensFromSelection(PRODUCT_FIELDS));
    for (const bad of PRODUCT_TYPE_FORBIDDEN_FIELDS) {
      expect(tokens.has(bad)).toBe(false);
    }
  });

  it('product tool source does not select invalid ProductType / variant / image fields', () => {
    const source = readFileSync(join(__dirname, 'products.ts'), 'utf8');

    for (const bad of PRODUCT_TYPE_FORBIDDEN_FIELDS) {
      // PRODUCT_FIELDS block must not list these (other GraphQL types may still use them elsewhere)
      expect(PRODUCT_FIELDS.includes(bad)).toBe(false);
      expect(source).not.toMatch(new RegExp(`PRODUCT_FIELDS[\\s\\S]{0,200}\\b${bad}\\b`));
    }

    // ProductVariantType exposes optionsJson, not attributes
    expect(source).toMatch(/optionsJson/);
    expect(source).not.toMatch(/syncProductVariants\([\s\S]*?\)\s*\{\s*[\s\S]*?\battributes\b/);

    // ProductImageType exposes imageUrl, not url / altText
    expect(source).toMatch(/imageUrl/);
    expect(source).not.toMatch(/addProductImage\([\s\S]*?\)\s*\{\s*[\s\S]*?\burl\b/);
    expect(source).not.toMatch(/addProductImage\([\s\S]*?\)\s*\{\s*[\s\S]*?\baltText\b/);
  });
});
