import {
  adminInviteTemplate,
  emailVerificationTemplate,
  orderPaidTemplate,
  orderStatusChangedTemplate,
  passwordResetTemplate,
  storeMemberInviteTemplate,
  vendorInviteTemplate,
} from './email-templates';

const brand = { logoUrl: 'https://example.com/logo.svg' };

const templates = [
  ['vendor invite', () => vendorInviteTemplate(brand, { inviteUrl: 'https://example.com/invite' })],
  ['admin invite', () => adminInviteTemplate(brand, { inviteUrl: 'https://example.com/invite' })],
  [
    'store member invite',
    () =>
      storeMemberInviteTemplate(brand, {
        inviteUrl: 'https://example.com/invite',
        storeName: 'Test Store',
      }),
  ],
  ['password reset', () => passwordResetTemplate(brand, { resetUrl: 'https://example.com/reset' })],
  [
    'email verification',
    () => emailVerificationTemplate(brand, { verifyUrl: 'https://example.com/verify' }),
  ],
  [
    'order paid',
    () =>
      orderPaidTemplate(brand, {
        orderNumber: 'ORD-1',
        orderDate: '1 ม.ค. 2569',
        paymentMethod: 'promptpay',
        items: [
          {
            productName: 'Dog Food',
            quantity: 1,
            unitPrice: 100,
            subtotal: 100,
          },
        ],
        subtotal: 100,
        discountAmount: 0,
        shippingFee: 50,
        total: 150,
        orderUrl: 'https://example.com/orders/1',
      }),
  ],
  [
    'order status changed',
    () =>
      orderStatusChangedTemplate(brand, {
        orderNumber: 'ORD-1',
        status: 'shipped',
        orderUrl: 'https://example.com/orders/1',
      }),
  ],
] as const;

describe('email templates', () => {
  it.each(templates)('%s uses shared branded layout', (_name, buildTemplate) => {
    const template = buildTemplate();

    expect(template.html).toContain('SOPet');
    expect(template.html).toContain('Marketplace สำหรับคนรักสัตว์เลี้ยง');
    expect(template.html).toContain('อีเมลนี้ส่งจาก SOPet Marketplace');
    expect(template.html).toContain(brand.logoUrl);
    expect(template.subject.length).toBeGreaterThan(0);
    expect(template.text.length).toBeGreaterThan(0);
  });
});
