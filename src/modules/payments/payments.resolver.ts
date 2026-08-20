import { Args, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentEventsService, type PaymentStatusUpdatedPayload } from './payment-events.service';
import { BankTransferDetailsType, PaymentType } from '../../graphql/models/types';
import { CurrentUser, Public } from '../../common/decorators';
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
    order?: { orderNumber?: string | null } | null;
  }): PaymentType {
    return {
      id: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.order?.orderNumber ?? null,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      authorizeUri: payment.authorizeUri ?? null,
      qrCodeUrl: payment.qrCodeUrl ?? null,
      expiresAt: payment.expiresAt ?? null,
    };
  }

  @Query(() => BankTransferDetailsType, { nullable: true })
  @Public()
  async bankTransferDetails(): Promise<BankTransferDetailsType | null> {
    return this.paymentsService.getBankTransferDetails();
  }

  @Query(() => PaymentType)
  @Public()
  async payment(
    @Args('id') id: string,
    @Args('orderNumber', { type: () => String, nullable: true }) orderNumber?: string,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<PaymentType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;
    const guestOrderNumber = effectiveCustomerId ? undefined : orderNumber?.trim();
    const payment = await this.paymentsService.findById(id, effectiveCustomerId, guestOrderNumber);
    return this.mapPayment(payment);
  }

  @Query(() => PaymentType)
  @Public()
  async paymentByOrderId(
    @Args('orderId') orderId: string,
    @Args('orderNumber', { type: () => String, nullable: true }) orderNumber?: string,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<PaymentType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;
    const guestOrderNumber = effectiveCustomerId ? undefined : orderNumber?.trim();
    const payment = await this.paymentsService.findLatestByOrderId(
      orderId,
      effectiveCustomerId,
      guestOrderNumber,
    );
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
  async paymentStatusUpdated(
    @Args('paymentId', { type: () => String, nullable: true }) paymentId?: string,
    @Args('orderId', { type: () => String, nullable: true }) orderId?: string,
    @CurrentUser('id') userId?: string,
    @CurrentUser('role') role?: string,
  ) {
    if (!paymentId && !orderId) {
      throw new BadRequestException({
        code: 'PAYMENT_SUBSCRIPTION_TARGET_REQUIRED',
        message: 'Either paymentId or orderId is required',
      });
    }

    await this.paymentsService.assertCanSubscribeToPaymentStatus({
      paymentId,
      orderId,
      userId: role === 'customer' ? userId : undefined,
    });

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
      orderNumber: effectiveCustomerId ? undefined : input.orderNumber?.trim(),
    });

    const payment = await this.paymentsService.findById(result.paymentId, effectiveCustomerId);

    return this.mapPayment(payment);
  }
}
