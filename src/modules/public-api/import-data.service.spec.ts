import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource as TypeOrmDataSource } from 'typeorm';
import { ImportDataService } from './import-data.service';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { DataSource } from '../../database/entities/enums/data-source.enums';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { StoresService } from '../stores/stores.service';

// Re-export helper is not exported — test via createImportedOrder order number conflict path.

describe('ImportDataService', () => {
  let service: ImportDataService;

  const customerRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn(async (x: object) => ({ id: 'cust-1', ...x, createdAt: new Date() })),
  };
  const addressRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn(async (x: object) => ({ id: 'addr-1', ...x, createdAt: new Date() })),
  };
  const orderRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const productRepo = {
    findOne: jest.fn(),
  };
  const variantRepo = {
    createQueryBuilder: jest.fn(),
  };
  const storesService = {
    assertStoreAccess: jest.fn().mockResolvedValue(undefined),
  };

  const manager = {
    create: jest.fn((_entity: unknown, data: object) => data),
    save: jest.fn(async (_entity: unknown, data: object | object[]) => {
      if (Array.isArray(data)) {
        return data.map((row, i) => ({ id: `item-${i}`, ...row }));
      }
      return { id: 'ord-1', ...data };
    }),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({
      id: 'ord-1',
      orderNumber: 'VI-test',
      source: DataSource.VENDOR_IMPORT,
      items: [],
      customer: null,
      shippingAddress: null,
      createdAt: new Date(),
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => Promise<unknown>) => fn(manager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportDataService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(SavedAddress), useValue: addressRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
        { provide: StoresService, useValue: storesService },
        { provide: TypeOrmDataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ImportDataService);
  });

  describe('createImportedCustomer', () => {
    it('creates a new vendor_import customer with normalized local phone', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      const result = await service.createImportedCustomer('store-1', 'user-1', {
        phone: '+66812345678',
        fullName: 'สมชาย',
        externalId: 'ERP-1',
      });

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('user-1', 'store-1');
      expect(customerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '0812345678',
          source: DataSource.VENDOR_IMPORT,
          importStoreId: 'store-1',
          isVerified: false,
          externalId: 'ERP-1',
        }),
      );
      expect(result.id).toBe('cust-1');
    });

    it('upserts existing customer and sets importStoreId', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-existing',
        phone: '0812345678',
        fullName: 'Old',
        email: null,
        source: DataSource.PLATFORM,
        importStoreId: null,
        externalId: null,
      });
      customerRepo.save.mockImplementation(async (x: object) => ({
        id: 'cust-existing',
        createdAt: new Date(),
        ...x,
      }));

      const result = await service.createImportedCustomer('store-1', 'user-1', {
        phone: '+66812345678',
        fullName: 'สมชาย',
        externalId: 'ERP-2',
      });

      expect(result.importStoreId).toBe('store-1');
      expect(result.externalId).toBe('ERP-2');
      expect(result.source).toBe(DataSource.PLATFORM);
      expect(result.phone).toBe('0812345678');
    });
  });

  describe('createImportedAddress', () => {
    it('creates address under imported customer with normalized phone', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        importStoreId: 'store-1',
      });

      const result = await service.createImportedAddress('store-1', 'user-1', 'cust-1', {
        fullName: 'A',
        phone: '+66812345678',
        addressLine1: '1',
        amphoe: 'a',
        district: 'd',
        province: 'p',
        postalCode: '10110',
      });

      expect(addressRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          phone: '0812345678',
          addressLine1: '1',
        }),
      );
      expect(result.id).toBe('addr-1');
    });

    it('throws when customer is not for this store', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        importStoreId: 'other-store',
      });

      await expect(
        service.createImportedAddress('store-1', 'user-1', 'cust-1', {
          fullName: 'A',
          phone: '+66812345678',
          addressLine1: '1',
          amphoe: 'a',
          district: 'd',
          province: 'p',
          postalCode: '10110',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createImportedOrder', () => {
    it('rejects duplicate external order number', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createImportedOrder('store-1', 'user-1', {
          externalOrderNumber: 'OLD-1',
          placedAt: '2024-01-01T00:00:00.000Z',
          items: [{ productName: 'X', quantity: 1, unitPrice: 10, productId: 'prod-1' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects unresolved items', async () => {
      orderRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(null);
      variantRepo.createQueryBuilder.mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.createImportedOrder('store-1', 'user-1', {
          externalOrderNumber: 'OLD-2',
          placedAt: '2024-01-01T00:00:00.000Z',
          items: [{ productName: 'X', quantity: 1, unitPrice: 10 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inserts delivered vendor_import order without going through OrdersService', async () => {
      orderRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue({
        id: 'prod-1',
        storeId: 'store-1',
        variants: [{ id: 'var-1', options: {}, deletedAt: null }],
      });

      const order = await service.createImportedOrder('store-1', 'user-1', {
        externalOrderNumber: 'OLD-3',
        placedAt: '2024-06-15T10:00:00.000Z',
        items: [{ productName: 'Food', quantity: 2, unitPrice: 100, productId: 'prod-1' }],
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(
        Order,
        expect.objectContaining({
          source: DataSource.VENDOR_IMPORT,
          status: OrderStatus.DELIVERED,
        }),
      );
      expect(order.id).toBe('ord-1');
    });
  });
});
