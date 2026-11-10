import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { BeamService } from './beam.service';

describe('BeamService', () => {
  let service: BeamService;
  let configService: { get: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          'beam.apiBaseUrl': 'https://api.beamcheckout.com',
          'beam.merchantId': 'merchant_test',
          'beam.apiKey': 'api_key_test',
          'beam.webhookSecret': Buffer.from('webhook-secret').toString('base64'),
        };
        return map[key] ?? '';
      }),
    };
    global.fetch = jest.fn();
    service = new BeamService(configService as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('hasCredentials', () => {
    it('returns true when merchant id and api key are set', () => {
      expect(service.hasCredentials()).toBe(true);
    });

    it('returns false when api key is missing', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'beam.apiKey' ? '' : 'merchant_test',
      );
      service = new BeamService(configService as never);
      expect(service.hasCredentials()).toBe(false);
    });
  });

  describe('createCharge', () => {
    it('POSTs to /api/v1/charges with Basic auth merchantId:apiKey', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          chargeId: 'ch_test_1',
          actionRequired: 'NONE',
          status: 'PENDING',
        }),
      });

      const body = {
        amount: 10000,
        currency: 'THB',
        referenceId: 'pay_1',
        returnUrl: 'https://storefront.example/payment/pay_1',
        skip3dsFlow: false,
        paymentMethod: {
          paymentMethodType: 'CARD_TOKEN' as const,
          cardToken: { cardTokenId: 'tok_1', securityCode: '123' },
        },
      };

      const result = await service.createCharge(body, { idempotencyKey: 'pay_1' });

      expect(result.chargeId).toBe('ch_test_1');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.beamcheckout.com/api/v1/charges',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Basic ${Buffer.from('merchant_test:api_key_test').toString('base64')}`,
            'Content-Type': 'application/json',
            'x-beam-idempotency-key': 'pay_1',
          }),
          body: JSON.stringify(body),
        }),
      );
    });

    it('throws BadRequestException on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ message: 'invalid card' }),
      });

      await expect(
        service.createCharge({
          amount: 100,
          currency: 'THB',
          referenceId: 'pay_1',
          returnUrl: 'https://example/payment/pay_1',
          paymentMethod: {
            paymentMethodType: 'QR_PROMPT_PAY',
            qrPromptPay: { expiryTime: new Date().toISOString() },
          },
        }),
      ).rejects.toMatchObject({
        response: { code: 'BEAM_ERROR', message: 'invalid card' },
      });
      await expect(
        service.createCharge({
          amount: 100,
          currency: 'THB',
          referenceId: 'pay_1',
          returnUrl: 'https://example/payment/pay_1',
          paymentMethod: {
            paymentMethodType: 'QR_PROMPT_PAY',
            qrPromptPay: { expiryTime: new Date().toISOString() },
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCharge', () => {
    it('GETs /api/v1/charges/{chargeId}', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ chargeId: 'ch_1', status: 'SUCCEEDED', amount: 5000 }),
      });

      const result = await service.getCharge('ch_1');
      expect(result.status).toBe('SUCCEEDED');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.beamcheckout.com/api/v1/charges/ch_1',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts valid HMAC-SHA256 base64 signature of raw body', () => {
      const rawBody = '{"event":"charge.succeeded"}';
      const secret = Buffer.from('webhook-secret');
      const signature = createHmac('sha256', secret).update(rawBody).digest('base64');
      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects missing or invalid signature', () => {
      expect(service.verifyWebhookSignature('{}', undefined)).toBe(false);
      expect(service.verifyWebhookSignature('{}', 'bad')).toBe(false);
    });
  });
});
