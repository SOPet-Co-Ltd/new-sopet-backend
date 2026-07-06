import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ShippingOptionsService } from './shipping-options.service';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';

describe('ShippingOptionsService', () => {
  let service: ShippingOptionsService;

  const shippingOptionRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x: StoreShippingOption) => ({
      ...x,
      id: x.id ?? 'opt-1',
    })),
    softRemove: jest.fn(async (x: StoreShippingOption) => x),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingOptionsService,
        {
          provide: getRepositoryToken(StoreShippingOption),
          useValue: shippingOptionRepo,
        },
      ],
    }).compile();

    service = module.get(ShippingOptionsService);
  });

  describe('findByStore', () => {
    it('returns all options when activeOnly is false', async () => {
      const options = [{ id: 'opt-1', storeId: 'store-1', isActive: true }];
      shippingOptionRepo.find.mockResolvedValue(options);

      const result = await service.findByStore('store-1', false);

      expect(result).toEqual(options);
      expect(shippingOptionRepo.find).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });

    it('filters to active options when activeOnly is true', async () => {
      shippingOptionRepo.find.mockResolvedValue([]);

      await service.findByStore('store-1', true);

      expect(shippingOptionRepo.find).toHaveBeenCalledWith({
        where: { storeId: 'store-1', isActive: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('saves option with defaults', async () => {
      const result = await service.create('store-1', {
        name: 'Standard',
        price: 50,
      });

      expect(shippingOptionRepo.create).toHaveBeenCalledWith({
        storeId: 'store-1',
        name: 'Standard',
        description: null,
        price: 50,
        sortOrder: 0,
        isActive: true,
        providerId: null,
      });
      expect(shippingOptionRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('opt-1');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when option not in store', async () => {
      shippingOptionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('opt-missing', 'store-1', { name: 'Updated' }),
      ).rejects.toMatchObject({
        response: { code: 'SHIPPING_OPTION_NOT_FOUND' },
      });
    });

    it('updates option belonging to store', async () => {
      const option = {
        id: 'opt-1',
        storeId: 'store-1',
        name: 'Old',
        price: 50,
      };
      shippingOptionRepo.findOne.mockResolvedValue(option);

      const result = await service.update('opt-1', 'store-1', {
        name: 'New',
        price: 75,
      });

      expect(result.name).toBe('New');
      expect(result.price).toBe(75);
      expect(shippingOptionRepo.save).toHaveBeenCalledWith(option);
    });
  });

  describe('delete', () => {
    it('soft-removes option belonging to store', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);

      await service.delete('opt-1', 'store-1');

      expect(shippingOptionRepo.softRemove).toHaveBeenCalledWith(option);
    });
  });

  describe('adminUpdate', () => {
    it('updates option by id without store scoping', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', name: 'Old' };
      shippingOptionRepo.findOne.mockResolvedValue(option);

      const result = await service.adminUpdate('opt-1', { name: 'Admin Updated' });

      expect(result.name).toBe('Admin Updated');
      expect(shippingOptionRepo.save).toHaveBeenCalledWith(option);
    });

    it('throws NotFoundException when option does not exist', async () => {
      shippingOptionRepo.findOne.mockResolvedValue(null);

      await expect(service.adminUpdate('opt-missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adminDelete', () => {
    it('soft-removes option by id', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);

      await service.adminDelete('opt-1');

      expect(shippingOptionRepo.softRemove).toHaveBeenCalledWith(option);
    });
  });
});
