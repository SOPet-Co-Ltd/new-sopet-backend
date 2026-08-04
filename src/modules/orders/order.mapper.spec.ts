import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import {
  mapOrder,
  mapOrderItem,
  mapOrderTrackingItem,
  serializeVariantOptions,
} from './order.mapper';

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

  describe('mapOrderItem/mapOrder redaction for sibling-store items on shared orders (QA-hunt: cross-vendor data leak)', () => {
    it('does not redact items when no viewerStoreId is given (customer/admin/tracking contexts)', () => {
      const mapped = mapOrderItem({ ...baseItem, productVariant: undefined } as never);
      expect(mapped.productName).toBe('Dog Food');
      expect(mapped.unitPrice).toBe(100);
    });

    it('does not redact items that belong to the viewing store', () => {
      const mapped = mapOrderItem({ ...baseItem, productVariant: undefined } as never, 'store-1');
      expect(mapped.productName).toBe('Dog Food');
      expect(mapped.unitPrice).toBe(100);
      expect(mapped.subtotal).toBe(200);
    });

    it('redacts product identity, pricing, and shipment details for items belonging to a different store', () => {
      const mapped = mapOrderItem(
        { ...baseItem, storeId: 'store-2', productVariant: undefined } as never,
        'store-1',
      );

      expect(mapped.storeId).toBe('store-2');
      expect(mapped.id).toBe('item-1');
      expect(mapped.productName).toBe('');
      expect(mapped.productId).toBeNull();
      expect(mapped.productImageUrl).toBeNull();
      expect(mapped.unitPrice).toBe(0);
      expect(mapped.quantity).toBe(0);
      expect(mapped.subtotal).toBe(0);
      expect(mapped.trackingNumber).toBeNull();
      expect(mapped.fulfillmentProvider).toBeNull();
      expect(mapped.trackingUrl).toBeNull();
    });

    it('mapOrder redacts sibling-store items and storeShippings but keeps whole-order aggregates and storeIds', () => {
      const order = {
        id: 'ord-1',
        orderNumber: 'SP-1',
        status: 'paid',
        subtotal: 500,
        shippingFee: 80,
        discountAmount: 20,
        total: 560,
        paymentMethod: 'card',
        guestPhone: null,
        guestName: null,
        guestEmail: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        items: [
          { ...baseItem, id: 'item-1', storeId: 'store-1', productVariant: undefined },
          {
            ...baseItem,
            id: 'item-2',
            storeId: 'store-2',
            productName: "Competitor's Secret Sauce",
            unitPrice: 999,
            trackingNumber: 'TRACK-SECRET',
            productVariant: undefined,
          },
        ],
        storeShippings: [
          { storeId: 'store-1', optionName: 'Standard', shippingFee: 40 },
          { storeId: 'store-2', optionName: 'Kerry Express Premium', shippingFee: 40 },
        ],
        shippingAddress: null,
      } as never;

      const mapped = mapOrder(order, 'store-1');

      // Whole-order aggregates are left intact - the admin UI relies on these for
      // "shared multi-vendor order" context and discount proration.
      expect(mapped.subtotal).toBe(500);
      expect(mapped.total).toBe(560);

      const ownItem = mapped.items.find((item) => item.id === 'item-1');
      const foreignItem = mapped.items.find((item) => item.id === 'item-2');
      expect(ownItem?.productName).toBe('Dog Food');
      expect(foreignItem?.storeId).toBe('store-2');
      expect(foreignItem?.productName).toBe('');
      expect(foreignItem?.unitPrice).toBe(0);
      expect(foreignItem?.trackingNumber).toBeNull();
      expect(JSON.stringify(mapped.items)).not.toContain('Secret Sauce');
      expect(JSON.stringify(mapped.items)).not.toContain('TRACK-SECRET');

      const ownShipping = mapped.storeShippings.find((s) => s.storeId === 'store-1');
      const foreignShipping = mapped.storeShippings.find((s) => s.storeId === 'store-2');
      expect(ownShipping?.optionName).toBe('Standard');
      expect(foreignShipping?.optionName).toBe('');
      expect(foreignShipping?.shippingFee).toBe(0);
    });
  });
});
