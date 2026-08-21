import { BadRequestException } from '@nestjs/common';
import { assertSafeRemoteUrl } from '../../common/utils/safe-remote-url.util';
import { VendorWebhooksService } from './vendor-webhooks.service';

const mockLookup = jest.fn();

jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

describe('VendorWebhooksService SSRF (SOPET-H-03)', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  it('rejects non-https webhook URLs', async () => {
    await expect(
      assertSafeRemoteUrl('http://hooks.example.com/orders', {
        allowedProtocols: ['https:'],
        errorCode: 'INVALID_WEBHOOK_URL',
        errorMessagePrefix: 'Webhook URL',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_WEBHOOK_URL' } });
  });

  it('rejects private hosts on upsert path', async () => {
    const service = Object.create(VendorWebhooksService.prototype) as VendorWebhooksService;
    await expect(
      (
        service as unknown as { assertSafeWebhookUrl: (url: string) => Promise<URL> }
      ).assertSafeWebhookUrl('https://127.0.0.1/hook'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('re-checks URL before deliverNow fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;

    const service = Object.create(VendorWebhooksService.prototype) as VendorWebhooksService;
    await (
      service as unknown as {
        deliverNow: (job: {
          url: string;
          secret: string;
          payloadJson: string;
          event: string;
          deliveryId: string;
        }) => Promise<void>;
      }
    ).deliverNow({
      url: 'https://hooks.example.com/orders',
      secret: 'whsec_test',
      payloadJson: '{"ok":true}',
      event: 'order.paid',
      deliveryId: 'del-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/orders',
      expect.objectContaining({ method: 'POST' }),
    );

    fetchMock.mockClear();
    await expect(
      (
        service as unknown as {
          deliverNow: (job: {
            url: string;
            secret: string;
            payloadJson: string;
            event: string;
            deliveryId: string;
          }) => Promise<void>;
        }
      ).deliverNow({
        url: 'https://192.168.1.10/hook',
        secret: 'whsec_test',
        payloadJson: '{"ok":true}',
        event: 'order.paid',
        deliveryId: 'del-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
