import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { mapOrderItem, mapOrderTrackingItem, serializeVariantOptions } from './order.mapper';

describe('order.mapper', () => {
  const baseItem = {
    id: 'item-1',
    orderId: 'ord-1',
    storeId: 'store-1',
    variantId: 'var-1',
    productName: 'Dog Food',
    unitPrice: 100,
    quantity: 2,
    subtotal: 200,
    fulfillmentStatus: FulfillmentStatus.PENDING,
    trackingNumber: null,
    fulfillmentProvider: null,
    trackingUrl: null,
    shippedAt: null,
    deliveredAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('serializeVariantOptions returns "{}" for empty snapshot', () => {
    expect(serializeVariantOptions({})).toBe('{}');
    expect(serializeVariantOptions(null)).toBe('{}');
    expect(serializeVariantOptions(undefined)).toBe('{}');
  });

  it('mapOrderItem includes variantOptions from snapshot JSON string', () => {
    const mapped = mapOrderItem({
      ...baseItem,
      variantOptions: { ขนาด: '1kg', สี: 'แดง' },
      productVariant: {
        id: 'var-1',
        productId: 'prod-1',
        imageUrl: null,
        product: { images: [] },
      } as never,
    } as never);

    expect(mapped.variantOptions).toBe(JSON.stringify({ ขนาด: '1kg', สี: 'แดง' }));
    expect(mapped.productId).toBe('prod-1');
  });

  it('mapOrderItem keeps snapshot options when live variant is missing', () => {
    const mapped = mapOrderItem({
      ...baseItem,
      variantOptions: { Size: 'M' },
      productVariant: undefined,
    } as never);

    expect(mapped.variantOptions).toBe(JSON.stringify({ Size: 'M' }));
    expect(mapped.productId).toBeNull();
    expect(mapped.productImageUrl).toBeNull();
  });

  it('mapOrderTrackingItem includes variantOptions from snapshot', () => {
    const mapped = mapOrderTrackingItem({
      ...baseItem,
      variantOptions: { Flavor: 'Chicken' },
      productVariant: {
        id: 'var-1',
        productId: 'prod-1',
        imageUrl: 'https://cdn/variant.jpg',
      } as never,
    } as never);

    expect(mapped.variantOptions).toBe(JSON.stringify({ Flavor: 'Chicken' }));
    expect(mapped.productImageUrl).toBe('https://cdn/variant.jpg');
  });
});
