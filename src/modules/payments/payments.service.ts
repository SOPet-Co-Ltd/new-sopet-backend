import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { CreateChargeDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { verifyOmiseWebhookSignature } from './omise-webhook.util';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';

interface OmiseCharge {
  id: string;
  status: string;
  authorize_uri?: string;
  source?: { scannable_code?: { image?: { download_uri?: string } } };
  failure_code?: string;
  failure_message?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private omiseSecretKey: string;
  private omisePublicKey: string;
  private omiseWebhookSecret: string;

  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(SavedPaymentMethod)
    private savedPaymentMethodRepository: Repository<SavedPaymentMethod>,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {
    this.omiseSecretKey = this.configService.get<string>('omise.secretKey') ?? '';
    this.omisePublicKey = this.configService.get<string>('omise.publicKey') ?? '';
    this.omiseWebhookSecret = this.configService.get<string>('omise.webhookSecret') ?? '';
  }

  private async omiseRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.omise.co${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.omiseSecretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      this.logger.error(`Omise error: ${JSON.stringify(data)}`);
      throw new BadRequestException({
        code: 'OMISE_ERROR',
        message: (data as { message?: string }).message ?? 'Payment provider error',
      });
    }
    return data;
  }

  async assertCanPayForOrder(orderId: string, customerId?: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new BadRequestException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    if (order.customerId && order.customerId !== customerId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to pay for this order',
      });
    }

    return order;
  }

  async findById(id: string, customerId?: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id } });
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }

    await this.assertCanPayForOrder(payment.orderId, customerId);
    return payment;
  }

  async findLatestByOrderId(orderId: string, customerId?: string): Promise<Payment> {
    await this.assertCanPayForOrder(orderId, customerId);

    const payment = await this.paymentRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found for this order',
      });
    }

    return payment;
  }

  async createCharge(createChargeDto: CreateChargeDto): Promise<{
    paymentId: string;
    status: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    authorizeUri?: string;
    qrCodeUrl?: string;
  }> {
    const {
      orderId,
      amount,
      paymentMethod: rawPaymentMethod,
      currency,
      omiseToken,
      savedPaymentMethodId,
      customerId,
    } = createChargeDto;
    const paymentMethod = normalizeCheckoutPaymentMethod(rawPaymentMethod);

    const order = await this.assertCanPayForOrder(orderId, customerId);

    if (paymentMethod === 'cod') {
      const payment = this.paymentRepository.create({
        orderId,
        amount,
        currency,
        paymentMethod: paymentMethod as Payment['paymentMethod'],
        status: 'pending',
      });
      await this.paymentRepository.save(payment);
      return {
        paymentId: payment.id,
        status: 'pending',
        amount,
        currency,
        paymentMethod,
      };
    }

    if (!this.omiseSecretKey) {
      throw new BadRequestException({
        code: 'OMISE_NOT_CONFIGURED',
        message: 'Payment provider is not configured',
      });
    }

    const amountSatang = Math.round(Number(amount) * 100);

    // Check for duplicate charge on this order (idempotency)
    const existingPayment = await this.paymentRepository.findOne({
      where: {
        orderId,
        amount,
        paymentMethod: paymentMethod as Payment['paymentMethod'],
      },
    });
    if (existingPayment && existingPayment.status === 'pending') {
      return {
        paymentId: existingPayment.id,
        status: existingPayment.status,
        amount,
        currency,
        paymentMethod,
        authorizeUri: existingPayment.authorizeUri ?? undefined,
        qrCodeUrl: existingPayment.qrCodeUrl ?? undefined,
      };
    }

    const payment = this.paymentRepository.create({
      orderId,
      amount,
      currency,
      paymentMethod: paymentMethod as Payment['paymentMethod'],
      status: 'pending',
    });
    await this.paymentRepository.save(payment);

    const chargeBody: Record<string, unknown> = {
      amount: amountSatang,
      currency: currency.toLowerCase(),
    };

    if (paymentMethod === 'promptpay') {
      chargeBody.source = { type: 'promptpay' };
    } else if (paymentMethod === 'credit_card') {
      let cardToken = omiseToken;

      if (savedPaymentMethodId) {
        if (!customerId) {
          throw new BadRequestException({
            code: 'CUSTOMER_REQUIRED',
            message: 'Customer ID required for saved payment method',
          });
        }
        const saved = await this.savedPaymentMethodRepository.findOne({
          where: { id: savedPaymentMethodId, customerId },
        });
        if (!saved) {
          throw new BadRequestException({
            code: 'PAYMENT_METHOD_NOT_FOUND',
            message: 'Saved payment method not found',
          });
        }
        cardToken = saved.omiseCardToken;
      }

      if (!cardToken) {
        throw new BadRequestException({
          code: 'CARD_TOKEN_REQUIRED',
          message: 'Credit card payments require an Omise token or saved payment method',
        });
      }

      chargeBody.card = cardToken;
    }

    const charge = await this.omiseRequest<OmiseCharge>('/charges', chargeBody);

    const authorizeUri = charge.authorize_uri ?? null;
    const qrCodeUrl = charge.source?.scannable_code?.image?.download_uri ?? null;

    order.paymentReference = charge.id;
    await this.orderRepository.save(order);

    if (charge.status === 'successful') {
      await this.markOrderPaid(order, payment, charge.id);
    } else {
      payment.status = charge.status === 'failed' ? 'failed' : 'pending';
      payment.authorizeUri = authorizeUri;
      payment.qrCodeUrl = qrCodeUrl;
      await this.paymentRepository.save(payment);
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      amount,
      currency,
      paymentMethod,
      authorizeUri: authorizeUri ?? undefined,
      qrCodeUrl: qrCodeUrl ?? undefined,
    };
  }

  verifyOmiseWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
    timestamp: string | undefined,
  ): boolean {
    if (!this.omiseWebhookSecret) {
      this.logger.warn('OMISE_WEBHOOK_SECRET not set — rejecting webhook');
      return false;
    }

    const bodyStr = rawBody.toString('utf8');
    return verifyOmiseWebhookSignature(bodyStr, timestamp, signature, this.omiseWebhookSecret);
  }

  async handleWebhook(payload: {
    key?: string;
    data?: { object?: string; id?: string; status?: string };
  }): Promise<void> {
    this.logger.log(`Omise webhook: ${payload.key}`);

    const charge = payload.data;
    if (!charge?.id) {
      return;
    }

    const order = await this.orderRepository.findOne({
      where: { paymentReference: charge.id },
    });
    if (!order) {
      this.logger.warn(`No order for Omise charge ${charge.id}`);
      return;
    }

    const payment = await this.paymentRepository.findOne({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
    if (!payment) {
      return;
    }

    if (payload.key === 'charge.complete') {
      if (order.status === OrderStatus.PAID || payment.status === 'paid') {
        this.logger.log(`Order ${order.id} already paid — ignoring duplicate webhook`);
        return;
      }
    }

    const isFailEvent = payload.key === 'charge.fail' || charge.status === 'failed';
    if (isFailEvent) {
      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        this.logger.log(`Order ${order.id} already ${order.status} — ignoring fail webhook`);
        return;
      }
    }

    let chargeStatus = charge.status;
    if (this.omiseSecretKey) {
      try {
        const apiCharge = await this.omiseRequest<OmiseCharge>(`/charges/${charge.id}`);
        chargeStatus = apiCharge.status;
      } catch (error) {
        this.logger.error(`Failed to re-fetch Omise charge ${charge.id}: ${error}`);
        return;
      }
    }

    if (payload.key === 'charge.complete' && chargeStatus === 'successful') {
      await this.markOrderPaid(order, payment, charge.id);
      return;
    }

    if (payload.key === 'charge.fail' || chargeStatus === 'failed') {
      payment.status = 'failed';
      await this.paymentRepository.save(payment);
      order.status = OrderStatus.CANCELLED;
      await this.orderRepository.save(order);
    }
  }

  private async markOrderPaid(order: Order, payment: Payment, chargeId: string): Promise<void> {
    await this.paymentRepository.manager.transaction(async (trx) => {
      payment.status = 'paid';
      await trx.save(payment);

      order.status = OrderStatus.PAID;
      order.paymentReference = chargeId;
      order.paidAt = new Date();
      await trx.save(order);
    });

    await this.notificationsService.notifyOrderPaid(order);
  }

  async refund(paymentId: string, amount?: number): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
      relations: ['order'],
    });

    if (!payment) {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }

    if (this.omiseSecretKey && payment.order.paymentReference) {
      await this.omiseRequest('/refunds', {
        charge: payment.order.paymentReference,
        amount: amount ? Math.round(amount * 100) : undefined,
      });
    }

    await this.paymentRepository.manager.transaction(async (trx) => {
      payment.status = 'refunded';
      await trx.save(payment);

      payment.order.status = OrderStatus.REFUNDED;
      await trx.save(payment.order);
    });

    return payment;
  }
}
