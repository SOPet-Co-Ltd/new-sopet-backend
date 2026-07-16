import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { StoresModule } from '../stores/stores.module';
import { PaymentsService } from './payments.service';
import { PaymentEventsService } from './payment-events.service';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { Payment } from '../../database/entities/payment.entity';
import { Order } from '../../database/entities/order.entity';
import { Customer } from '../../database/entities/customer.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { PaymentsResolver } from './payments.resolver';
import { PaymentExpiryScheduler } from './payment-expiry.scheduler';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    InventoryModule,
    forwardRef(() => PayoutsModule),
    StoresModule,
    TypeOrmModule.forFeature([Payment, Order, Customer, SavedPaymentMethod]),
  ],
  controllers: [PaymentsWebhookController],
  providers: [PaymentsService, PaymentEventsService, PaymentsResolver, PaymentExpiryScheduler],
  exports: [PaymentsService, PaymentEventsService],
})
export class PaymentsModule {}
