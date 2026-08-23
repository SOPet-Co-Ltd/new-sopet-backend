import { Order } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { mapPublicApiOrder } from './public-api-order.mapper';

describe('mapPublicApiOrder', () => {
  it('maps store-scoped fields including sku, customer, and shipping', () => {
    const order = {
      id: 'ord-1',
      orderNumber: 'ORD-1',
      status: 'paid',
      paymentMethod: 'promptpay',
      paidAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-02T00:00:00Z'),
      guestName: 'Somchai',
      guestPhone: '0812345678',
      guestEmail: null,
      customer: null,
      shippingAddress: {
        fullName: 'Somchai',
        phone: '0812345678',
        addressLine1: '1 Road',
        addressLine2: null,
        tumbon: 'Khlong Tan',
        amphoe: 'Khlong Toei',
        province: 'Bangkok',
        postalCode: '10110',
      },
      items: [
        {
          id: 'item-1',
          storeId: 'store-1',
          productName: 'Cat Food',
          variantId: 'var-1',
          variantOptions: { Size: '2kg' },
          quantity: 2,
          unitPrice: 100,
          subtotal: 200,
          fulfillmentStatus: FulfillmentStatus.PENDING,
          trackingNumber: null,
          fulfillmentProvider: null,
          trackingUrl: null,
          shippedAt: null,
          productVariant: { sku: 'CAT-1' },
        },
        {
          id: 'item-2',
          storeId: 'store-2',
          productName: 'Dog Food',
          variantId: 'var-2',
          variantOptions: {},
          quantity: 1,
          unitPrice: 50,
          subtotal: 50,
          fulfillmentStatus: FulfillmentStatus.PENDING,
          trackingNumber: null,
          fulfillmentProvider: null,
          trackingUrl: null,
          shippedAt: null,
          productVariant: { sku: 'DOG-1' },
        },
      ],
    } as unknown as Order;

    const mapped = mapPublicApiOrder(order, 'store-1');

    expect(mapped.id).toBe('ord-1');
    expect(mapped.orderId).toBe('ord-1');
    expect(mapped.currency).toBe('THB');
    expect(mapped.customer.name).toBe('Somchai');
    expect(mapped.shippingAddress?.tumbon).toBe('Khlong Tan');
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0].sku).toBe('CAT-1');
    expect(mapped.itemsSubtotal).toBe(200);
  });
});
