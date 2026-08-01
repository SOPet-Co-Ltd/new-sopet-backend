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
    count: jest.fn(),
    create: jest.fn((x: Partial<StoreShippingOption>): Partial<StoreShippingOption> => x),
    save: jest.fn((x: StoreShippingOption) =>
      Promise.resolve({
        ...x,
        id: x.id ?? 'opt-1',
      }),
    ),
    softRemove: jest.fn((x: StoreShippingOption) => Promise.resolve(x)),
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

  describe('hasShippingOptions', () => {
    it('returns true when the store has at least one active shipping option', async () => {
      shippingOptionRepo.count.mockResolvedValue(1);

      await expect(service.hasShippingOptions('store-1')).resolves.toBe(true);
      expect(shippingOptionRepo.count).toHaveBeenCalledWith({
        where: { storeId: 'store-1', isActive: true },
      });
    });

    it('returns false when the store has shipping option rows but all are inactive', async () => {
      // countByStore (used elsewhere for the "last option" delete guard) would
      // see these rows and return >0, but hasShippingOptions must not - a
      // fully-disabled shipping setup means the store still can't actually ship.
      shippingOptionRepo.count.mockResolvedValue(0);

      await expect(service.hasShippingOptions('store-1')).resolves.toBe(false);
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

    /**
     * Regression (QA-hunt): deactivating shipping options had no guard at all - a vendor
     * could turn off every option one by one (the delete guard only blocks removing ROWS,
     * not toggling isActive) and end up with zero shippable options while products stayed
     * published, silently breaking checkout for that store.
     */
    it('rejects deactivating the only active shipping option', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', name: 'Standard', isActive: true };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(1); // only this option is active

      await expect(service.update('opt-1', 'store-1', { isActive: false })).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_SHIPPING_OPTION' },
      });
      expect(shippingOptionRepo.save).not.toHaveBeenCalled();
    });

    it('allows deactivating one option when another active option remains', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', name: 'Standard', isActive: true };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(2); // this one + at least one other active

      const result = await service.update('opt-1', 'store-1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(shippingOptionRepo.save).toHaveBeenCalled();
    });

    it('allows re-activating an already-inactive option without checking active count', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', name: 'Standard', isActive: false };
      shippingOptionRepo.findOne.mockResolvedValue(option);

      const result = await service.update('opt-1', 'store-1', { isActive: true });

      expect(result.isActive).toBe(true);
      expect(shippingOptionRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft-removes option belonging to store when more than one exists', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(2);

      await service.delete('opt-1', 'store-1');

      expect(shippingOptionRepo.softRemove).toHaveBeenCalledWith(option);
    });

    it('rejects deleting the last shipping option', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(1);

      await expect(service.delete('opt-1', 'store-1')).rejects.toMatchObject({
        response: { code: 'LAST_SHIPPING_OPTION' },
      });
      expect(shippingOptionRepo.softRemove).not.toHaveBeenCalled();
    });

    /**
     * Regression (QA-hunt): the row-count guard alone lets a vendor delete their one
     * remaining ACTIVE option as long as other (already-inactive) rows exist, leaving
     * zero shippable options even though countByStore() > 1.
     */
    it('rejects deleting the only active option even when inactive rows also exist', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', isActive: true };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count
        .mockResolvedValueOnce(3) // countByStore: 3 total rows
        .mockResolvedValueOnce(1); // active-only count: only this one is active

      await expect(service.delete('opt-1', 'store-1')).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_SHIPPING_OPTION' },
      });
      expect(shippingOptionRepo.softRemove).not.toHaveBeenCalled();
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

    it('rejects admin deactivating the only active shipping option', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', isActive: true };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(1);

      await expect(service.adminUpdate('opt-1', { isActive: false })).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_SHIPPING_OPTION' },
      });
      expect(shippingOptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('adminDelete', () => {
    it('soft-removes option by id when more than one exists', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(2);

      await service.adminDelete('opt-1');

      expect(shippingOptionRepo.softRemove).toHaveBeenCalledWith(option);
    });

    it('rejects deleting the last shipping option', async () => {
      const option = { id: 'opt-1', storeId: 'store-1' };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValue(1);

      await expect(service.adminDelete('opt-1')).rejects.toMatchObject({
        response: { code: 'LAST_SHIPPING_OPTION' },
      });
    });

    it('rejects admin deleting the only active option even when inactive rows also exist', async () => {
      const option = { id: 'opt-1', storeId: 'store-1', isActive: true };
      shippingOptionRepo.findOne.mockResolvedValue(option);
      shippingOptionRepo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

      await expect(service.adminDelete('opt-1')).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_SHIPPING_OPTION' },
      });
      expect(shippingOptionRepo.softRemove).not.toHaveBeenCalled();
    });
  });
});
