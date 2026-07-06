import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentType } from '../../graphql/models/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { CreatePaymentInput } from './payments.inputs';

@Resolver()
export class PaymentsResolver {
  constructor(private readonly paymentsService: PaymentsService) {}

  private mapPayment(payment: {
    id: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
    paymentMethod: string;
  }): PaymentType {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      authorizeUri: null,
      qrCodeUrl: null,
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
      paymentMethod: input.paymentMethod as 'promptpay' | 'credit_card' | 'cod',
      omiseToken: input.omiseToken,
      savedPaymentMethodId: input.savedPaymentMethodId,
      customerId: effectiveCustomerId,
    });

    return {
      id: result.paymentId,
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      status: result.status,
      paymentMethod: input.paymentMethod,
      authorizeUri: result.authorizeUri ?? null,
      qrCodeUrl: result.qrCodeUrl ?? null,
    };
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
