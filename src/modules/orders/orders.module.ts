import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StoresModule } from '../stores/stores.module';
import { OrdersService } from './orders.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { StoreSuspensionHoldService } from './store-suspension-hold.service';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { OrderShippingAddress } from '../../database/entities/order-shipping-address.entity';
import { OrderStoreShipping } from '../../database/entities/order-store-shipping.entity';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { Product } from '../../database/entities/product.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { User } from '../../database/entities/user.entity';
import { Customer } from '../../database/entities/customer.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { OrdersResolver } from './orders.resolver';
import { GuestOrderLinkModule } from './guest-order-link.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { CartModule } from '../cart/cart.module';
import { VendorWebhooksModule } from '../vendor-webhooks/vendor-webhooks.module';
import { SaleCampaignPricingModule } from '../sale-campaigns/sale-campaign-pricing.module';
@Module({
  imports: [
    AuthModule,
    GuestOrderLinkModule,
    ProductsModule,
    PromotionsModule,
    NotificationsModule,
    VendorWebhooksModule,
    forwardRef(() => StoresModule),
    InventoryModule,
    forwardRef(() => PaymentsModule),
    CartModule,
    SaleCampaignPricingModule,
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderStatusHistory,
      OrderShippingAddress,
      OrderStoreShipping,
      SavedAddress,
      ProductVariant,
      Product,
      StoreShippingOption,
      Store,
      StoreMember,
      User,
      Customer,
    ]),
  ],
  providers: [
    OrdersService,
    OrderFulfillmentService,
    StoreSuspensionHoldService,
    OrdersResolver,
    CustomerRepository,
  ],
  exports: [OrdersService, OrderFulfillmentService, StoreSuspensionHoldService],
})
export class OrdersModule {}
