import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import {
  CreateProductVariantInput,
  UpdateProductVariantInput,
  SyncProductVariantItemInput,
} from './products.inputs';

// QA-hunt regression: SyncProductVariantItemInput.priceModifier was missing the @Min(0) guard
// that CreateProductVariantInput/UpdateProductVariantInput both already enforce, letting a
// negative priceModifier through the batch syncProductVariants mutation and push a variant's
// final price (basePrice + priceAdjustment) to zero or negative.
describe('priceModifier @Min(0) consistency across variant inputs', () => {
  const validationPipe = new ValidationPipe();
  const validate = (metatype: new () => object, value: unknown) =>
    validationPipe.transform(value, { metatype, type: 'body' } as never);

  it('rejects a negative priceModifier on CreateProductVariantInput', async () => {
    await expect(
      validate(CreateProductVariantInput, {
        sku: 'SKU-1',
        priceModifier: -50,
        stockQuantity: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a negative priceModifier on UpdateProductVariantInput', async () => {
    await expect(
      validate(UpdateProductVariantInput, {
        priceModifier: -50,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a negative priceModifier on SyncProductVariantItemInput (batch sync path)', async () => {
    await expect(
      validate(SyncProductVariantItemInput, {
        sku: 'SKU-1',
        stockQuantity: 10,
        priceModifier: -50,
        attributes: '{}',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a zero or positive priceModifier on SyncProductVariantItemInput', async () => {
    const result = await validate(SyncProductVariantItemInput, {
      sku: 'SKU-1',
      stockQuantity: 10,
      priceModifier: 0,
      attributes: '{}',
    });
    expect(result).toBeDefined();
  });
});
