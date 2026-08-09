import { buildVendorWebhookOrderPayload, signVendorWebhookPayload } from './vendor-webhook.payload';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';

describe('vendor-webhook.payload', () => {
  it('builds store-scoped payload and signs with HMAC', () => {
    const order = {
      id: 'ord-1',
      orderNumber: 'ORD-1',
      status: OrderStatus.PAID,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paidAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      guestName: 'Somchai',
      guestPhone: '0812345678',
      guestEmail: null,
      customer: null,
      shippingAddress: {
        fullName: 'Somchai',
        phone: '0812345678',
        addressLine1: '1 Road',
        addressLine2: null,
        tumbon: null,
        amphoe: 'Bang Rak',
        province: 'Bangkok',
        postalCode: '10500',
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
          productVariant: { sku: 'CAT-1' },
        } as unknown as OrderItem,
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
          productVariant: { sku: 'DOG-1' },
        } as unknown as OrderItem,
      ],
    } as Order;

    const payload = buildVendorWebhookOrderPayload(order, 'store-1', 'order.paid');
    expect(payload).not.toBeNull();
    expect(payload!.storeId).toBe('store-1');
    expect(payload!.data.items).toHaveLength(1);
    expect(payload!.data.items[0].sku).toBe('CAT-1');
    expect(payload!.data.itemsSubtotal).toBe(200);
    expect(payload!.data.customer.name).toBe('Somchai');

    const json = JSON.stringify(payload);
    const signature = signVendorWebhookPayload('whsec_test', json);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('returns null when store has no items', () => {
    const order = {
      id: 'ord-1',
      items: [{ storeId: 'other' } as OrderItem],
    } as Order;
    expect(buildVendorWebhookOrderPayload(order, 'store-1', 'order.cancelled')).toBeNull();
  });
});
