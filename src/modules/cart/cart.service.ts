import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';

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

  async getCart(customerId?: string, sessionId?: string): Promise<Cart> {
    return this.resolveCart(customerId, sessionId);
  }

  async addItem(
    variantId: string,
    quantity: number,
    customerId?: string,
    sessionId?: string,
  ): Promise<Cart> {
    const cart = await this.resolveCart(customerId, sessionId);
    const existing = cart.items?.find((item) => item.variantId === variantId);
    const totalQuantity = existing ? existing.quantity + quantity : quantity;

    await this.variantRepository.manager.transaction(async (trx) => {
      const variant = await trx.findOne(ProductVariant, {
        where: { id: variantId },
        lock: { mode: 'optimistic', version: 1 },
      });

      if (!variant) {
        throw new NotFoundException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Product variant not found',
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
  ): Promise<Cart> {
    const cart = await this.resolveCart(customerId, sessionId);
    const item = await this.cartItemRepository.findOne({
      where: { id: itemId, cartId: cart.id },
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
      item.quantity = quantity;
      await this.cartItemRepository.save(item);
    }

    return this.getCart(customerId, sessionId);
  }

  async removeItem(itemId: string, customerId?: string, sessionId?: string): Promise<Cart> {
    const cart = await this.resolveCart(customerId, sessionId);
    await this.cartItemRepository.delete({ id: itemId, cartId: cart.id });
    return this.getCart(customerId, sessionId);
  }

  async mergeGuestCart(customerId: string, sessionId: string): Promise<Cart> {
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
