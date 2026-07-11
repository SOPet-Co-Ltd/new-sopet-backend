import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ShippingProvidersService } from './shipping-providers.service';
import { ShippingProvider } from '../../database/entities/shipping-provider.entity';

describe('ShippingProvidersService', () => {
  let service: ShippingProvidersService;

  const shippingProviderRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x: ShippingProvider) => ({
      ...x,
      id: x.id ?? 'provider-1',
    })),
    remove: jest.fn(async (x: ShippingProvider) => x),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingProvidersService,
        {
          provide: getRepositoryToken(ShippingProvider),
          useValue: shippingProviderRepo,
        },
      ],
    }).compile();

    service = module.get(ShippingProvidersService);
  });

  describe('findAll', () => {
    it('returns only active providers by default', async () => {
      const providers = [{ id: 'p-1', name: 'Kerry', isActive: true }];
      shippingProviderRepo.find.mockResolvedValue(providers);

      const result = await service.findAll();

      expect(result).toEqual(providers);
      expect(shippingProviderRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
    });

    it('includes inactive providers when requested', async () => {
      shippingProviderRepo.find.mockResolvedValue([]);

      await service.findAll(true);

      expect(shippingProviderRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('creates active provider', async () => {
      const result = await service.create({ name: 'Flash' });

      expect(shippingProviderRepo.create).toHaveBeenCalledWith({
        name: 'Flash',
        isActive: true,
      });
      expect(shippingProviderRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('provider-1');
    });
  });

  describe('update', () => {
    it('updates name and isActive', async () => {
      const provider = { id: 'p-1', name: 'Old', isActive: true };
      shippingProviderRepo.findOne.mockResolvedValue(provider);

      const result = await service.update('p-1', {
        name: 'New',
        isActive: false,
      });

      expect(result.name).toBe('New');
      expect(result.isActive).toBe(false);
      expect(shippingProviderRepo.save).toHaveBeenCalledWith(provider);
    });

    it('throws NotFoundException when provider missing', async () => {
      shippingProviderRepo.findOne.mockResolvedValue(null);

      await expect(service.update('p-missing', { name: 'X' })).rejects.toMatchObject({
        response: { code: 'SHIPPING_PROVIDER_NOT_FOUND' },
      });
    });
  });

  describe('delete', () => {
    it('removes provider', async () => {
      const provider = { id: 'p-1', name: 'Kerry' };
      shippingProviderRepo.findOne.mockResolvedValue(provider);

      await service.delete('p-1');

      expect(shippingProviderRepo.remove).toHaveBeenCalledWith(provider);
    });
  });
});
