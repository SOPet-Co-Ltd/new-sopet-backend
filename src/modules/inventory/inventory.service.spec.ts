import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../../database/entities/inventory-transaction.entity';

describe('InventoryService', () => {
  let service: InventoryService;

  const manager = {
    find: jest.fn(),
    exists: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn((_entity, data) => data),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(OrderItem), useValue: {} },
        { provide: getRepositoryToken(ProductVariant), useValue: {} },
        { provide: getRepositoryToken(InventoryTransaction), useValue: {} },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  it('restores stock for each order item and logs RETURN transactions', async () => {
    manager.find.mockResolvedValue([
      { id: 'item-1', orderId: 'order-1', variantId: 'var-1', quantity: 2 },
    ]);
    manager.exists.mockResolvedValue(false);
    manager.findOne.mockResolvedValue({ id: 'var-1', stockQuantity: 3 });
    manager.update.mockResolvedValue(undefined);
    manager.save.mockResolvedValue(undefined);

    const restored = await service.restoreOrderStock('order-1', manager as never, 'Payment failed');

    expect(restored).toBe(true);
    expect(manager.update).toHaveBeenCalledWith(ProductVariant, 'var-1', {
      stockQuantity: 5,
    });
    expect(manager.save).toHaveBeenCalledWith(
      InventoryTransaction,
      expect.objectContaining({
        variantId: 'var-1',
        type: InventoryTransactionType.RETURN,
        quantityChange: 2,
        quantityAfter: 5,
        referenceId: 'order-1',
        referenceType: 'order',
        notes: 'Payment failed',
      }),
    );
  });

  it('is idempotent when stock was already restored', async () => {
    manager.find.mockResolvedValue([
      { id: 'item-1', orderId: 'order-1', variantId: 'var-1', quantity: 2 },
    ]);
    manager.exists.mockResolvedValue(true);

    const restored = await service.restoreOrderStock('order-1', manager as never);

    expect(restored).toBe(false);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  describe('restoreItemStock', () => {
    it('restores stock only for the given item ids', async () => {
      // Query is item-scoped: find returns only the requested ids (not the whole order).
      manager.find.mockResolvedValue([
        { id: 'item-1', orderId: 'order-1', variantId: 'var-1', quantity: 2 },
      ]);
      manager.exists.mockResolvedValue(false);
      manager.findOne.mockResolvedValue({ id: 'var-1', stockQuantity: 1 });
      manager.update.mockResolvedValue(undefined);
      manager.save.mockResolvedValue(undefined);

      const restored = await service.restoreItemStock(
        'order-1',
        ['item-1'],
        manager as never,
        'Hold SLA cancel',
      );

      expect(restored).toBe(true);
      expect(manager.find).toHaveBeenCalledWith(
        OrderItem,
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order-1', id: expect.anything() }),
        }),
      );
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(ProductVariant, 'var-1', {
        stockQuantity: 3,
      });
      expect(manager.save).toHaveBeenCalledWith(
        InventoryTransaction,
        expect.objectContaining({
          variantId: 'var-1',
          quantityChange: 2,
          notes: 'Hold SLA cancel',
        }),
      );
    });

    it('is idempotent when selected items already have RETURN transactions', async () => {
      manager.find.mockResolvedValue([
        { id: 'item-1', orderId: 'order-1', variantId: 'var-1', quantity: 2 },
      ]);
      manager.exists.mockResolvedValue(true);

      const restored = await service.restoreItemStock('order-1', ['item-1'], manager as never);

      expect(restored).toBe(false);
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns false when itemIds is empty', async () => {
      const restored = await service.restoreItemStock('order-1', [], manager as never);

      expect(restored).toBe(false);
      expect(manager.find).not.toHaveBeenCalled();
    });
  });
});
