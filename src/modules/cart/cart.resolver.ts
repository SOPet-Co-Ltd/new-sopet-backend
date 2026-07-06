import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CartType, CartItemType } from '../../graphql/models/types';
import { mapVariant } from '../../graphql/models/mappers';
import { Public, CurrentUser } from '../../common/decorators';
import { AddToCartInput, RemoveCartItemInput, UpdateCartItemInput } from './cart.inputs';
import { Cart } from '../../database/entities/cart.entity';

function mapCart(cart: Cart): CartType {
  return {
    id: cart.id,
    customerId: cart.customerId,
    sessionId: cart.sessionId,
    items:
      cart.items?.map((item): CartItemType => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        productVariant: item.productVariant
          ? mapVariant(item.productVariant, Number(item.productVariant.product?.basePrice ?? 0))
          : null,
      })) ?? [],
  };
}

@Resolver()
export class CartResolver {
  constructor(private readonly cartService: CartService) {}

  @Query(() => CartType)
  @Public()
  async cart(
    @CurrentUser('id') customerId?: string,
    @Args('sessionId', { nullable: true }) sessionId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.getCart(customerId, sessionId);
    return mapCart(cart);
  }

  @Mutation(() => CartType)
  @Public()
  async addToCart(
    @Args('input') input: AddToCartInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.addItem(
      input.variantId,
      input.quantity,
      customerId,
      input.sessionId,
    );
    return mapCart(cart);
  }

  @Mutation(() => CartType)
  @Public()
  async updateCartItem(
    @Args('input') input: UpdateCartItemInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.updateItem(
      input.itemId,
      input.quantity,
      customerId,
      input.sessionId,
    );
    return mapCart(cart);
  }

  @Mutation(() => CartType)
  @Public()
  async removeCartItem(
    @Args('input') input: RemoveCartItemInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.removeItem(input.itemId, customerId, input.sessionId);
    return mapCart(cart);
  }

  @Mutation(() => CartType)
  @UseGuards(JwtAuthGuard)
  async mergeCart(
    @CurrentUser('id') customerId: string,
    @Args('sessionId') sessionId: string,
  ): Promise<CartType> {
    const cart = await this.cartService.mergeGuestCart(customerId, sessionId);
    return mapCart(cart);
  }
}
