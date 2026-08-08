import { ConfigService } from '@nestjs/config';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailService } from './email.service';
import { EmailTemplateRendererService } from './email-template-renderer.service';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

function createDeliveryService() {
  const emailService = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
  const renderer = { renderForSend: jest.fn() };
  const configService = {
    get: (key: string) => {
      if (key === 'app.adminPanelUrl') return 'https://admin.sopet.co.th';
      if (key === 'app.apiUrl') return 'https://api.sopet.co.th';
      return undefined;
    },
  } as unknown as ConfigService;

  const delivery = new EmailDeliveryService(
    emailService as unknown as EmailService,
    configService,
    renderer as unknown as EmailTemplateRendererService,
  );

  return { delivery, emailService, renderer };
}

const DB_RESULT = { subject: 'DB subject', html: '<p>DB html</p>', text: 'DB text' };

describe('EmailDeliveryService', () => {
  it('sendVendorInvite builds inviteUrl vars/fallbackParams and forwards renderer output to EmailService', async () => {
    const { delivery, emailService, renderer } = createDeliveryService();
    renderer.renderForSend.mockResolvedValue(DB_RESULT);

    await delivery.sendVendorInvite('vendor@example.com', 'tok123');

    expect(renderer.renderForSend).toHaveBeenCalledWith(EmailTemplateKey.VENDOR_INVITE, {
      vars: { inviteUrl: 'https://admin.sopet.co.th/register?token=tok123' },
      fallbackParams: { inviteUrl: 'https://admin.sopet.co.th/register?token=tok123' },
    });
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vendor@example.com',
        subject: 'DB subject',
        html: '<p>DB html</p>',
      }),
    );
  });

  it('sendPasswordReset preserves its public signature and uses the renderer result', async () => {
    const { delivery, emailService, renderer } = createDeliveryService();
    renderer.renderForSend.mockResolvedValue(DB_RESULT);

    await delivery.sendPasswordReset('user@example.com', 'reset-token');

    expect(renderer.renderForSend).toHaveBeenCalledWith(EmailTemplateKey.PASSWORD_RESET, {
      vars: { resetUrl: 'https://admin.sopet.co.th/reset-password?token=reset-token' },
      fallbackParams: { resetUrl: 'https://admin.sopet.co.th/reset-password?token=reset-token' },
    });
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('sendOrderPaid builds formatted string vars and a trusted itemsHtml block', async () => {
    const { delivery, renderer } = createDeliveryService();
    renderer.renderForSend.mockResolvedValue(DB_RESULT);

    const params = {
      orderNumber: 'ORD-1',
      orderDate: '1 ม.ค. 2569',
      paymentMethod: 'promptpay',
      customerName: 'คุณลูกค้า',
      items: [{ productName: 'Dog Food', quantity: 1, unitPrice: 100, subtotal: 100 }],
      subtotal: 100,
      discountAmount: 0,
      shippingFee: 50,
      total: 150,
      orderUrl: 'https://sopet.co.th/orders/1',
    };

    await delivery.sendOrderPaid('customer@example.com', params);

    expect(renderer.renderForSend).toHaveBeenCalledTimes(1);
    const [key, options] = renderer.renderForSend.mock.calls[0];
    expect(key).toBe(EmailTemplateKey.ORDER_PAID);
    expect(options.vars).toMatchObject({
      orderNumber: 'ORD-1',
      paymentMethod: 'พร้อมเพย์',
      subtotal: '฿100',
      total: '฿150',
      customerName: 'คุณลูกค้า',
    });
    expect(options.vars.itemsHtml).toContain('Dog Food');
    expect(options.fallbackParams).toBe(params);
  });

  it('sendOrderStatusChanged builds the Thai statusLabel var', async () => {
    const { delivery, renderer } = createDeliveryService();
    renderer.renderForSend.mockResolvedValue(DB_RESULT);

    await delivery.sendOrderStatusChanged('customer@example.com', {
      orderNumber: 'ORD-1',
      status: 'shipped',
      orderUrl: 'https://sopet.co.th/orders/1',
    });

    const [, options] = renderer.renderForSend.mock.calls[0];
    expect(options.vars.statusLabel).toBe('จัดส่งแล้ว');
  });

  it('sendVendorAccountSuspended defaults vendorName when not provided (matches legacy TS fallback default)', async () => {
    const { delivery, renderer } = createDeliveryService();
    renderer.renderForSend.mockResolvedValue(DB_RESULT);

    await delivery.sendVendorAccountSuspended('vendor@example.com');

    const [key, options] = renderer.renderForSend.mock.calls[0];
    expect(key).toBe(EmailTemplateKey.VENDOR_ACCOUNT_SUSPENDED);
    expect(options.vars.vendorName).toBe('ผู้ขาย');
    expect(options.vars.storeName).toBeUndefined();
  });

  it('propagates whatever the renderer returns (DB merge or TS fallback) to EmailService unchanged', async () => {
    const { delivery, emailService, renderer } = createDeliveryService();
    const fallbackResult = {
      subject: 'Fallback subject',
      html: '<p>fallback</p>',
      text: 'fallback text',
    };
    renderer.renderForSend.mockResolvedValue(fallbackResult);

    await delivery.sendEmailVerification('user@example.com', 'verify-token');

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: fallbackResult.subject,
        html: fallbackResult.html,
        text: fallbackResult.text,
      }),
    );
  });
});
