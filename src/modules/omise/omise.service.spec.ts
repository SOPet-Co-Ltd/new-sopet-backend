import { BadRequestException } from '@nestjs/common';
import { OmiseService } from './omise.service';

describe('OmiseService', () => {
  let service: OmiseService;
  let configService: { get: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = { get: jest.fn() };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('hasCredentials', () => {
    it('returns true when secret key is configured', () => {
      configService.get.mockReturnValue('sk_test_abc123');
      service = new OmiseService(configService as never);

      expect(service.hasCredentials()).toBe(true);
      expect(configService.get).toHaveBeenCalledWith('omise.secretKey');
    });

    it('returns false when secret key is missing', () => {
      configService.get.mockReturnValue('');
      service = new OmiseService(configService as never);

      expect(service.hasCredentials()).toBe(false);
    });
  });

  describe('request error handling', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('sk_test_abc123');
      service = new OmiseService(configService as never);
    });

    it('throws BadRequestException on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ message: 'invalid bank account' }),
      });

      await expect(
        service.createRecipient({
          name: 'Test Store',
          bankBrand: 'bbl',
          bankNumber: '1234567890',
          bankName: 'Test Account',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createRecipient({
          name: 'Test Store',
          bankBrand: 'bbl',
          bankNumber: '1234567890',
          bankName: 'Test Account',
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'OMISE_ERROR',
          message: 'invalid bank account',
        },
      });
    });
  });

  describe('createRecipient', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('sk_test_abc123');
      service = new OmiseService(configService as never);
    });

    it('delegates to Omise recipients API', async () => {
      const recipient = {
        id: 'recp_123',
        verified: true,
        active: true,
      };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(recipient),
      });

      const result = await service.createRecipient({
        name: 'Test Store',
        email: 'store@example.com',
        bankBrand: 'bbl',
        bankNumber: '1234567890',
        bankName: 'Test Account',
      });

      expect(result).toEqual(recipient);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.omise.co/recipients',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Test Store',
            email: 'store@example.com',
            type: 'individual',
            tax_id: undefined,
            bank_account: {
              brand: 'bbl',
              number: '1234567890',
              name: 'Test Account',
            },
          }),
        }),
      );
    });
  });

  describe('createTransfer', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('sk_test_abc123');
      service = new OmiseService(configService as never);
    });

    it('delegates to Omise transfers API', async () => {
      const transfer = {
        id: 'trsf_123',
        amount: 50000,
        currency: 'thb',
        sent: true,
        paid: false,
      };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(transfer),
      });

      const result = await service.createTransfer('recp_123', 50000);

      expect(result).toEqual(transfer);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.omise.co/transfers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            recipient: 'recp_123',
            amount: 50000,
          }),
        }),
      );
    });
  });
});
