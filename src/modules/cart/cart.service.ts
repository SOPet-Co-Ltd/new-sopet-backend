import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { StoreStatus } from '../../database/entities/store.entity';

export type CartWarning = {
  code: string;
  message: string;
  variantId?: string | null;
};

export type CartWithWarnings = Cart & { warnings: CartWarning[] };

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
  ) {}

  private async resolveCart(customerId?: string, sessionId?: string): Promise<Cart> {
    if (!customerId && !sessionId) {
      throw new BadRequestException({
        code: 'CART_IDENTITY_REQUIRED',
        message: 'Customer login or sessionId is required',
      });
    }

    const where = customerId ? { customerId } : { sessionId };
    let cart = await this.cartRepository.findOne({
      where,
      relations: [
        'items',
        'items.productVariant',
        'items.productVariant.product',
        'items.productVariant.product.store',
        'items.productVariant.product.images',
      ],
    });

    if (!cart) {
      cart = await this.cartRepository.save(
        this.cartRepository.create({
          customerId: customerId ?? null,
          sessionId: customerId ? null : (sessionId ?? null),
        }),
      );
      cart.items = [];
    }

    return cart;
  }

  private isSuspendedStoreItem(item: CartItem): boolean {
    return item.productVariant?.product?.store?.status === StoreStatus.SUSPENDED;
  }

  private isRetiredVariantItem(item: CartItem): boolean {
    return !!item.productVariant?.retiredAt;
  }

  /** Remove suspended-store and retired-SKU lines; attach ephemeral warnings. */
  private async purgeUnavailableItems(cart: Cart): Promise<CartWithWarnings> {
    const items = cart.items ?? [];
    const suspended = items.filter((item) => this.isSuspendedStoreItem(item));
    const retired = items.filter(
      (item) => !this.isSuspendedStoreItem(item) && this.isRetiredVariantItem(item),
    );
    const warnings: CartWarning[] = [
      ...suspended.map((item) => ({
        code: 'SUSPENDED_STORE_ITEM_REMOVED',
        message: 'An item from a suspended store was removed from your cart',
        variantId: item.variantId,
      })),
      ...retired.map((item) => ({
        code: 'RETIRED_VARIANT_REMOVED',
        message: 'A discontinued product option was removed from your cart',
        variantId: item.variantId,
      })),
    ];

    const toRemove = [...suspended, ...retired];
    if (toRemove.length > 0) {
      await this.cartItemRepository.delete({
        id: In(toRemove.map((item) => item.id)),
      });
    }
    cart.items = items.filter(
      (item) => !this.isSuspendedStoreItem(item) && !this.isRetiredVariantItem(item),
    );

    return Object.assign(cart, { warnings });
  }

  /**
   * Persist qty ≤ remaining stock when stock dropped below cart qty (stock > 0).
   * Stock 0 lines are left for the client to flag as out of stock.
   */
  private async capQuantitiesToStock(cart: CartWithWarnings): Promise<CartWithWarnings> {
    const warnings = [...(cart.warnings ?? [])];
    const items = cart.items ?? [];

    for (const item of items) {
      const stock = item.productVariant?.stockQuantity;
      if (stock == null || stock <= 0 || item.quantity <= stock) {
        continue;
      }

      item.quantity = stock;
      await this.cartItemRepository.save(item);
      warnings.push({
        code: 'QUANTITY_CAPPED',
        message: `Quantity reduced to available stock (${stock})`,
        variantId: item.variantId,
      });
    }

    return Object.assign(cart, { warnings });
  }

  async getCart(customerId?: string, sessionId?: string): Promise<CartWithWarnings> {
    const cart = await this.resolveCart(customerId, sessionId);
    const purged = await this.purgeUnavailableItems(cart);
    return this.capQuantitiesToStock(purged);
  }

  async addItem(
    variantId: string,
    quantity: number,
    customerId?: string,
    sessionId?: string,
  ): Promise<CartWithWarnings> {
    const cart = await this.resolveCart(customerId, sessionId);
    const existing = cart.items?.find((item) => item.variantId === variantId);
    const totalQuantity = existing ? existing.quantity + quantity : quantity;

    await this.variantRepository.manager.transaction(async (trx) => {
      // Lock variant only — FOR UPDATE cannot target nullable sides of outer joins
      // (TypeORM relations: product / product.store would LEFT JOIN).
      const variant = await trx.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!variant || variant.retiredAt) {
        throw new NotFoundException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Product variant not found',
        });
      }

      const product = await trx.findOne(Product, {
        where: { id: variant.productId },
        relations: ['store'],
      });

      if (product?.store?.status === StoreStatus.SUSPENDED) {
        throw new BadRequestException({
          code: 'STORE_SUSPENDED',
          message: 'Cannot add items from a suspended store',
        });
      }

      if (variant.stockQuantity < totalQuantity) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_STOCK',
          message: 'Insufficient stock',
        });
      }

      if (existing) {
        existing.quantity += quantity;
        await trx.save(existing);
      } else {
        await trx.save(
          trx.create(CartItem, {
            cartId: cart.id,
            variantId,
            quantity,
          }),
        );
      }
    });

    return this.getCart(customerId, sessionId);
  }

  async updateItem(
    itemId: string,
    quantity: number,
    customerId?: string,
    sessionId?: string,
  ): Promise<CartWithWarnings> {
    const cart = await this.resolveCart(customerId, sessionId);
    const item = await this.cartItemRepository.findOne({
      where: { id: itemId, cartId: cart.id },
      relations: ['productVariant'],
    });

    if (!item) {
      throw new NotFoundException({
        code: 'CART_ITEM_NOT_FOUND',
        message: 'Cart item not found',
      });
    }

    if (quantity <= 0) {
      await this.cartItemRepository.delete(item.id);
    } else {
      const stock = item.productVariant?.stockQuantity;
      const capped = stock != null && stock > 0 && quantity > stock ? stock : quantity;
      item.quantity = capped;
      await this.cartItemRepository.save(item);
    }

    return this.getCart(customerId, sessionId);
  }

  async removeItem(
    itemId: string,
    customerId?: string,
    sessionId?: string,
  ): Promise<CartWithWarnings> {
    const cart = await this.resolveCart(customerId, sessionId);
    await this.cartItemRepository.delete({ id: itemId, cartId: cart.id });
    return this.getCart(customerId, sessionId);
  }

  async removeItems(
    itemIds: string[],
    customerId?: string,
    sessionId?: string,
  ): Promise<CartWithWarnings> {
    if (itemIds.length === 0) {
      return this.getCart(customerId, sessionId);
    }

    const cart = await this.resolveCart(customerId, sessionId);
    await this.cartItemRepository.delete({
      id: In(itemIds),
      cartId: cart.id,
    });
    return this.getCart(customerId, sessionId);
  }

  async mergeGuestCart(customerId: string, sessionId: string): Promise<CartWithWarnings> {
    const guestCart = await this.cartRepository.findOne({
      where: { sessionId },
      relations: ['items'],
    });

    if (!guestCart?.items?.length) {
      return this.getCart(customerId);
    }

    const customerCart = await this.resolveCart(customerId);

    for (const guestItem of guestCart.items) {
      const existing = customerCart.items?.find((item) => item.variantId === guestItem.variantId);

      if (existing) {
        existing.quantity += guestItem.quantity;
        await this.cartItemRepository.save(existing);
      } else {
        await this.cartItemRepository.save(
          this.cartItemRepository.create({
            cartId: customerCart.id,
            variantId: guestItem.variantId,
            quantity: guestItem.quantity,
          }),
        );
      }
    }

    await this.cartItemRepository.delete({ cartId: guestCart.id });
    await this.cartRepository.delete({ id: guestCart.id });

    return this.getCart(customerId);
  }
}
