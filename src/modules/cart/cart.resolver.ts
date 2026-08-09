import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CartService, CartWithWarnings } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CartType, CartItemType, CartWarningType } from '../../graphql/models/types';
import { mapVariant } from '../../graphql/models/mappers';
import { Public, CurrentUser } from '../../common/decorators';
import { AddToCartInput, RemoveCartItemInput, UpdateCartItemInput } from './cart.inputs';
import { honestDisplayCompareAt } from '../sale-campaigns/sale-campaign-pricing';
import { SaleCampaignPricingService } from '../sale-campaigns/sale-campaign-pricing.service';

async function mapCart(
  cart: CartWithWarnings,
  saleCampaignPricing: SaleCampaignPricingService,
): Promise<CartType> {
  const priced = await saleCampaignPricing.resolveEffectiveUnitPrices(
    (cart.items ?? [])
      .filter((item) => item.productVariant)
      .map((item) => ({
        productId: item.productVariant.productId || item.productVariant.product?.id || '',
        variantId: item.productVariant.id,
        catalogUnit:
          Number(item.productVariant.product?.basePrice ?? 0) +
          Number(item.productVariant.priceAdjustment ?? 0),
      })),
  );

  return {
    id: cart.id,
    customerId: cart.customerId,
    sessionId: cart.sessionId,
    items:
      cart.items?.map((item): CartItemType => {
        const mappedVariant = item.productVariant
          ? mapVariant(item.productVariant, Number(item.productVariant.product?.basePrice ?? 0))
          : null;
        if (mappedVariant && item.productVariant) {
          const resolved = priced.get(item.productVariant.id);
          if (resolved) {
            mappedVariant.price = resolved.unitPrice;
            const productCompareAt =
              item.productVariant.product?.compareAtPrice != null
                ? Number(item.productVariant.product.compareAtPrice)
                : null;
            const staticCompareAt = mappedVariant.compareAtPrice ?? productCompareAt;
            mappedVariant.compareAtPrice = honestDisplayCompareAt(resolved, staticCompareAt);
          }
        }
        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          productVariant: mappedVariant,
        };
      }) ?? [],
    warnings:
      cart.warnings?.map((warning): CartWarningType => ({
        code: warning.code,
        message: warning.message,
        variantId: warning.variantId ?? null,
      })) ?? [],
  };
}

@Resolver()
export class CartResolver {
  constructor(
    private readonly cartService: CartService,
    private readonly saleCampaignPricing: SaleCampaignPricingService,
  ) {}

  @Query(() => CartType)
  @Public()
  async cart(
    @CurrentUser('id') customerId?: string,
    @Args('sessionId', { nullable: true }) sessionId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.getCart(customerId, sessionId);
    return mapCart(cart, this.saleCampaignPricing);
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
    return mapCart(cart, this.saleCampaignPricing);
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
    return mapCart(cart, this.saleCampaignPricing);
  }

  @Mutation(() => CartType)
  @Public()
  async removeCartItem(
    @Args('input') input: RemoveCartItemInput,
    @CurrentUser('id') customerId?: string,
  ): Promise<CartType> {
    const cart = await this.cartService.removeItem(input.itemId, customerId, input.sessionId);
    return mapCart(cart, this.saleCampaignPricing);
  }

  @Mutation(() => CartType)
  @UseGuards(JwtAuthGuard)
  async mergeCart(
    @CurrentUser('id') customerId: string,
    @Args('sessionId') sessionId: string,
  ): Promise<CartType> {
    const cart = await this.cartService.mergeGuestCart(customerId, sessionId);
    return mapCart(cart, this.saleCampaignPricing);
  }
}
