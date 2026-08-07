import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SaleCampaignsService } from './sale-campaigns.service';
import { CreateSaleCampaignInput } from './sale-campaigns.inputs';

describe('SaleCampaignsService', () => {
  const storesService = {
    assertStoreAccess: jest.fn().mockResolvedValue(undefined),
  };

  const campaignRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'camp-1', ...row })),
    softDelete: jest.fn().mockResolvedValue(undefined),
  };

  const itemRepository = {
    delete: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((row) => row),
    save: jest.fn(async (rows) => rows),
    createQueryBuilder: jest.fn(),
  };

  const productRepository = {
    findOne: jest.fn(),
  };

  const variantRepository = {
    findOne: jest.fn(),
  };

  let service: SaleCampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SaleCampaignsService(
      campaignRepository as never,
      itemRepository as never,
      productRepository as never,
      variantRepository as never,
      storesService as never,
    );
  });

  describe('findActiveForStore', () => {
    it('filters out campaigns outside the active window', async () => {
      const now = Date.now();
      campaignRepository.find.mockResolvedValue([
        {
          id: 'live',
          isActive: true,
          startsAt: new Date(now - 60_000),
          expiresAt: new Date(now + 60_000),
          items: [],
        },
        {
          id: 'future',
          isActive: true,
          startsAt: new Date(now + 60_000),
          expiresAt: new Date(now + 120_000),
          items: [],
        },
        {
          id: 'expired',
          isActive: true,
          startsAt: new Date(now - 120_000),
          expiresAt: new Date(now - 60_000),
          items: [],
        },
      ]);

      const result = await service.findActiveForStore('store-1');
      expect(result.map((c) => c.id)).toEqual(['live']);
    });
  });

  describe('findActiveItemsForProducts', () => {
    it('returns empty when productIds is empty', async () => {
      await expect(service.findActiveItemsForProducts([])).resolves.toEqual([]);
      expect(itemRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects invalid date ranges', async () => {
      const input: CreateSaleCampaignInput = {
        name: 'Flash',
        startsAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:00.000Z',
        items: [{ productId: 'prod-1', discountPercent: 20 }],
      };

      await expect(service.create('user-1', 'store-1', input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects items without discount fields', async () => {
      const input: CreateSaleCampaignInput = {
        name: 'Flash',
        items: [{ productId: 'prod-1' }],
      };

      await expect(service.create('user-1', 'store-1', input)).rejects.toMatchObject({
        response: { code: 'SALE_CAMPAIGN_ITEM_DISCOUNT_REQUIRED' },
      });
    });

    it('creates campaign and replaces items', async () => {
      productRepository.findOne.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' });
      campaignRepository.findOne.mockResolvedValue({
        id: 'camp-1',
        storeId: 'store-1',
        name: 'Flash',
        description: null,
        startsAt: null,
        expiresAt: null,
        isActive: true,
        priority: 0,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const input: CreateSaleCampaignInput = {
        name: 'Flash',
        items: [{ productId: 'prod-1', discountPercent: 25 }],
      };

      const result = await service.create('user-1', 'store-1', input);
      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('user-1', 'store-1');
      expect(itemRepository.delete).toHaveBeenCalledWith({ campaignId: 'camp-1' });
      expect(itemRepository.save).toHaveBeenCalled();
      expect(result.id).toBe('camp-1');
    });
  });

  describe('findOne', () => {
    it('throws when missing', async () => {
      campaignRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
