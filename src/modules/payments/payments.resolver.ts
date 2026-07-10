import { Args, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentEventsService, type PaymentStatusUpdatedPayload } from './payment-events.service';
import { PaymentType } from '../../graphql/models/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { CreatePaymentInput } from './payments.inputs';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';

@Resolver()
export class PaymentsResolver {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentEventsService: PaymentEventsService,
  ) {}

  private mapPayment(payment: {
    id: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
    paymentMethod: string;
    authorizeUri?: string | null;
    qrCodeUrl?: string | null;
    expiresAt?: Date | null;
  }): PaymentType {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      authorizeUri: payment.authorizeUri ?? null,
      qrCodeUrl: payment.qrCodeUrl ?? null,
      expiresAt: payment.expiresAt ?? null,
    };
  }

  @Query(() => PaymentType)
  @Public()
  async payment(
    @Args('id') id: string,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<PaymentType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;
    const payment = await this.paymentsService.findById(id, effectiveCustomerId);
    return this.mapPayment(payment);
  }

  @Query(() => PaymentType)
  @Public()
  async paymentByOrderId(
    @Args('orderId') orderId: string,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<PaymentType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;
    const payment = await this.paymentsService.findLatestByOrderId(orderId, effectiveCustomerId);
    return this.mapPayment(payment);
  }

  @Subscription(() => PaymentType, {
    filter: (
      payload: PaymentStatusUpdatedPayload,
      variables: { paymentId?: string; orderId?: string },
    ) => {
      const payment = payload.paymentStatusUpdated;
      if (variables.paymentId) {
        return payment.id === variables.paymentId;
      }
      if (variables.orderId) {
        return payment.orderId === variables.orderId;
      }
      return false;
    },
    resolve: (payload: PaymentStatusUpdatedPayload) => payload.paymentStatusUpdated,
  })
  @Public()
  paymentStatusUpdated(
    @Args('paymentId', { type: () => String, nullable: true }) paymentId?: string,
    @Args('orderId', { type: () => String, nullable: true }) orderId?: string,
  ) {
    if (!paymentId && !orderId) {
      throw new BadRequestException({
        code: 'PAYMENT_SUBSCRIPTION_TARGET_REQUIRED',
        message: 'Either paymentId or orderId is required',
      });
    }

    return this.paymentEventsService.paymentStatusUpdatedIterator();
  }

  @Mutation(() => PaymentType)
  @Public()
  async createPayment(
    @Args('input') input: CreatePaymentInput,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<PaymentType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;

    const result = await this.paymentsService.createCharge({
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      paymentMethod: normalizeCheckoutPaymentMethod(input.paymentMethod),
      omiseToken: input.omiseToken,
      savedPaymentMethodId: input.savedPaymentMethodId,
      customerId: effectiveCustomerId,
    });

    const payment = await this.paymentsService.findById(result.paymentId, effectiveCustomerId);

    return this.mapPayment(payment);
  }

  @Mutation(() => PaymentType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async refundPayment(@Args('paymentId') paymentId: string): Promise<PaymentType> {
    const payment = await this.paymentsService.refund(paymentId);

    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
    };
  }
}
