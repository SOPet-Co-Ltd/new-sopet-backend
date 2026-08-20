import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { VendorWebhooksService } from './vendor-webhooks.service';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;

describe('VendorWebhooksService SSRF guards', () => {
  const service = new VendorWebhooksService({} as never, {} as never, undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-HTTPS URLs', async () => {
    await expect(service.assertSafeWebhookUrl('http://example.com/hook')).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_URL' },
    });
  });

  it('rejects localhost hostnames', async () => {
    await expect(service.assertSafeWebhookUrl('https://localhost/hook')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects URLs that resolve to private IPs', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);

    await expect(service.assertSafeWebhookUrl('https://evil.example/hook')).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_URL', message: 'Webhook URL host is not allowed' },
    });
  });

  it('rejects literal private IP hosts', async () => {
    await expect(service.assertSafeWebhookUrl('https://192.168.1.10/hook')).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_URL' },
    });
  });

  it('allows public HTTPS destinations', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

    await expect(service.assertSafeWebhookUrl('https://example.com/hook')).resolves.toMatchObject({
      address: '93.184.216.34',
      family: 4,
      parsed: expect.any(URL),
    });
  });

  it('deliverNow refuses private destinations before fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    await expect(
      service.deliverNow({
        deliveryId: 'd1',
        storeId: 's1',
        event: 'order.paid',
        url: 'https://127.0.0.1/hook',
        secret: 'whsec_test',
        payloadJson: '{}',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_URL' },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
