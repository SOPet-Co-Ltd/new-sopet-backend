import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../../database/entities/inventory-transaction.entity';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /**
   * Returns stock deducted at order creation. Idempotent per order line —
   * skips variants that already have a RETURN transaction for this order.
   */
  async restoreOrderStock(
    orderId: string,
    manager: EntityManager,
    notes?: string,
  ): Promise<boolean> {
    const items = await manager.find(OrderItem, { where: { orderId } });
    if (items.length === 0) {
      return false;
    }

    let restoredAny = false;

    for (const item of items) {
      const alreadyRestored = await manager.exists(InventoryTransaction, {
        where: {
          referenceId: orderId,
          referenceType: 'order',
          variantId: item.variantId,
          type: InventoryTransactionType.RETURN,
        },
      });

      if (alreadyRestored) {
        continue;
      }

      const variant = await manager.findOne(ProductVariant, {
        where: { id: item.variantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!variant) {
        this.logger.warn(
          `Skipping stock restore for order ${orderId}: variant ${item.variantId} not found`,
        );
        continue;
      }

      const newStock = variant.stockQuantity + item.quantity;

      await manager.update(ProductVariant, variant.id, {
        stockQuantity: newStock,
      });

      await manager.save(
        InventoryTransaction,
        manager.create(InventoryTransaction, {
          variantId: variant.id,
          type: InventoryTransactionType.RETURN,
          quantityChange: item.quantity,
          quantityAfter: newStock,
          referenceId: orderId,
          referenceType: 'order',
          notes: notes ?? 'Order stock restored',
        }),
      );

      restoredAny = true;
    }

    return restoredAny;
  }
}
