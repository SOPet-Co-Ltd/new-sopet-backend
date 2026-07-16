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
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { Customer } from '../../database/entities/customer.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { CreateChargeDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentEventsService } from './payment-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { PayoutsService } from '../payouts/payouts.service';
import { StoresService } from '../stores/stores.service';
import { verifyOmiseWebhookSignature } from './omise-webhook.util';
import { buildOmiseReturnUri } from './build-omise-return-uri';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';

interface OmiseCharge {
  id: string;
  status: string;
  authorize_uri?: string;
  source?: { scannable_code?: { image?: { download_uri?: string } } };
  failure_code?: string;
  failure_message?: string;
}

interface OmiseCustomer {
  id: string;
  default_card?: string | null;
  cards?: {
    data: OmiseCard[];
  };
}

interface OmiseCard {
  id: string;
  last_digits: string;
  brand: string;
  expiration_month: number;
  expiration_year: number;
  fingerprint?: string;
}

interface OmiseToken {
  id: string;
  card: OmiseCard;
}

export interface SavedOmiseCardDetails {
  omiseCardId: string;
  cardFingerprint: string | null;
  lastFour: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
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
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(SavedPaymentMethod)
    private savedPaymentMethodRepository: Repository<SavedPaymentMethod>,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private paymentEventsService: PaymentEventsService,
    private inventoryService: InventoryService,
    private payoutsService: PayoutsService,
    private storesService: StoresService,
  ) {
    this.omiseSecretKey = this.configService.get<string>('omise.secretKey') ?? '';
    this.omisePublicKey = this.configService.get<string>('omise.publicKey') ?? '';
    this.omiseWebhookSecret = this.configService.get<string>('omise.webhookSecret') ?? '';
  }

  private getQrExpiryMinutes(): number {
    const configured = this.configService.get<number>('payment.qrExpiryMinutes');
    return configured && configured > 0 ? configured : 15;
  }

  private computeQrExpiresAt(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.getQrExpiryMinutes() * 60_000);
  }

  private getEffectiveExpiresAt(payment: Payment): Date | null {
    if (payment.expiresAt) {
      return payment.expiresAt;
    }

    if (payment.paymentMethod === PaymentMethod.PROMPTPAY && payment.status === 'pending') {
      return this.computeQrExpiresAt(payment.createdAt);
    }

    return null;
  }

  isQrPaymentExpired(payment: Payment, now: Date = new Date()): boolean {
    const expiresAt = this.getEffectiveExpiresAt(payment);
    return expiresAt !== null && expiresAt.getTime() <= now.getTime();
  }

  private async finalizeExpiredPayment(payment: Payment): Promise<Payment> {
    const order = await this.orderRepository.findOne({ where: { id: payment.orderId } });
    if (!order) {
      return payment;
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED ||
      payment.status !== 'pending'
    ) {
      return payment;
    }

    await this.paymentRepository.manager.transaction(async (manager) => {
      payment.status = 'failed';
      await manager.save(payment);

      order.status = OrderStatus.CANCELLED;
      await manager.save(order);

      await this.inventoryService.restoreOrderStock(order.id, manager, 'QR payment expired');
    });

    await this.paymentEventsService.publishPaymentStatusUpdated(payment);
    return payment;
  }

  async expirePendingQrPaymentIfNeeded(payment: Payment): Promise<Payment> {
    if (
      payment.paymentMethod !== PaymentMethod.PROMPTPAY ||
      payment.status !== 'pending' ||
      !this.isQrPaymentExpired(payment)
    ) {
      return payment;
    }

    return this.finalizeExpiredPayment(payment);
  }

  /**
   * Local abandon of pending payments for an order before creating a replacement charge.
   * Does not cancel the order or restore stock. MVP does not call Omise reverse —
   * superseded charges may remain open at Omise (ops orphan residual).
   */
  private async supersedePendingPaymentsForOrder(orderId: string): Promise<void> {
    const pendingPayments = await this.paymentRepository.find({
      where: { orderId, status: 'pending' },
    });

    for (const pending of pendingPayments) {
      pending.status = 'failed';
      await this.paymentRepository.save(pending);
      await this.paymentEventsService.publishPaymentStatusUpdated(pending);
    }
  }

  async expirePendingQrPayments(): Promise<number> {
    const pendingPayments = await this.paymentRepository.find({
      where: {
        paymentMethod: PaymentMethod.PROMPTPAY,
        status: 'pending',
      },
    });

    let expiredCount = 0;
    for (const payment of pendingPayments) {
      if (!this.isQrPaymentExpired(payment)) {
        continue;
      }

      const updated = await this.finalizeExpiredPayment(payment);
      if (updated.status === 'failed') {
        expiredCount += 1;
      }
    }

    return expiredCount;
  }

  private async omiseRequest<T>(
    path: string,
    body?: Record<string, unknown>,
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  ): Promise<T> {
    const resolvedMethod = method ?? (body !== undefined ? 'POST' : 'GET');
    const response = await fetch(`https://api.omise.co${path}`, {
      method: resolvedMethod,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.omiseSecretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return this.parseOmiseResponse<T>(response, resolvedMethod, path);
  }

  /** Token endpoints live on vault.omise.co and require the public key. */
  private async omiseVaultRequest<T>(path: string): Promise<T> {
    if (!this.omisePublicKey) {
      throw new BadRequestException({
        code: 'OMISE_NOT_CONFIGURED',
        message: 'Payment provider is not configured',
      });
    }

    const response = await fetch(`https://vault.omise.co${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.omisePublicKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    return this.parseOmiseResponse<T>(response, 'GET', path);
  }

  private async parseOmiseResponse<T>(
    response: Response,
    method: string,
    path: string,
  ): Promise<T> {
    const data = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      this.logger.error(`Omise ${method} ${path} failed: ${JSON.stringify(data)}`);
      throw new BadRequestException({
        code: 'OMISE_ERROR',
        message: (data as { message?: string }).message ?? 'Payment provider error',
      });
    }
    return data;
  }

  private isOmiseNotFoundError(error: unknown): boolean {
    if (!(error instanceof BadRequestException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response === 'Resource was not found';
    }
    return (response as { message?: string }).message === 'Resource was not found';
  }

  private extractCardFromCustomer(omiseCustomer: OmiseCustomer): OmiseCard {
    const cards = omiseCustomer.cards?.data ?? [];
    const cardId =
      typeof omiseCustomer.default_card === 'string' ? omiseCustomer.default_card : undefined;
    const card = cardId ? cards.find((item) => item.id === cardId) : cards[cards.length - 1];

    if (!card) {
      throw new BadRequestException({
        code: 'OMISE_CARD_NOT_FOUND',
        message: 'Saved card could not be retrieved from payment provider',
      });
    }

    return card;
  }

  private isSameCard(left: OmiseCard, right: OmiseCard): boolean {
    if (left.fingerprint && right.fingerprint) {
      return left.fingerprint === right.fingerprint;
    }

    return (
      left.last_digits === right.last_digits &&
      left.brand.toLowerCase() === right.brand.toLowerCase() &&
      left.expiration_month === right.expiration_month &&
      left.expiration_year === right.expiration_year
    );
  }

  private async findExistingOmiseCard(
    omiseCustomerId: string | null,
    cardFromToken: OmiseCard,
  ): Promise<OmiseCard | null> {
    if (!omiseCustomerId) {
      return null;
    }

    const omiseCustomer = await this.omiseRequest<OmiseCustomer>(
      `/customers/${omiseCustomerId}`,
      undefined,
      'GET',
    );

    return (
      (omiseCustomer.cards?.data ?? []).find((card) => this.isSameCard(card, cardFromToken)) ?? null
    );
  }

  private normalizeFingerprint(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private mapOmiseCardToSavedDetails(
    card: OmiseCard,
    fallbackFingerprint?: string,
  ): SavedOmiseCardDetails {
    return {
      omiseCardId: card.id,
      cardFingerprint: this.normalizeFingerprint(card.fingerprint ?? fallbackFingerprint),
      lastFour: card.last_digits,
      brand: card.brand.toLowerCase(),
      expiryMonth: card.expiration_month,
      expiryYear: card.expiration_year,
    };
  }

  /**
   * Remove a card from the customer's Omise profile. Best-effort; local delete should still proceed.
   */
  async deleteOmiseCustomerCard(customerId: string, omiseCardId: string): Promise<void> {
    if (!this.omiseSecretKey || !omiseCardId) {
      return;
    }

    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer?.omiseCustomerId) {
      return;
    }

    try {
      await this.omiseRequest(
        `/customers/${customer.omiseCustomerId}/cards/${omiseCardId}`,
        undefined,
        'DELETE',
      );
    } catch (error) {
      if (this.isOmiseNotFoundError(error)) {
        return;
      }

      this.logger.warn(
        `Failed to delete Omise card ${omiseCardId} for customer ${customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Attach a one-time Omise card token to the customer's Omise profile and return a reusable card id.
   */
  async saveCustomerCard(
    customerId: string,
    omiseCardToken: string,
  ): Promise<SavedOmiseCardDetails> {
    if (!this.omiseSecretKey || !this.omisePublicKey) {
      throw new BadRequestException({
        code: 'OMISE_NOT_CONFIGURED',
        message: 'Payment provider is not configured',
      });
    }

    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    const token = await this.omiseVaultRequest<OmiseToken>(`/tokens/${omiseCardToken}`);

    let omiseCustomerId = customer.omiseCustomerId;
    if (omiseCustomerId) {
      try {
        await this.omiseRequest<OmiseCustomer>(`/customers/${omiseCustomerId}`, undefined, 'GET');
      } catch (error) {
        if (!this.isOmiseNotFoundError(error)) {
          throw error;
        }
        this.logger.warn(
          `Stale Omise customer ${omiseCustomerId} for SOPET customer ${customer.id}; recreating`,
        );
        omiseCustomerId = null;
        customer.omiseCustomerId = null;
        await this.customerRepository.save(customer);
      }
    }

    const existingOmiseCard = await this.findExistingOmiseCard(omiseCustomerId, token.card);
    if (existingOmiseCard) {
      return this.mapOmiseCardToSavedDetails(existingOmiseCard, token.card.fingerprint);
    }

    let omiseCustomer: OmiseCustomer;
    if (!omiseCustomerId) {
      omiseCustomer = await this.omiseRequest<OmiseCustomer>('/customers', {
        email: customer.email ?? undefined,
        description: `SOPET customer ${customer.id}`,
        card: omiseCardToken,
        metadata: { customerId: customer.id },
      });
      customer.omiseCustomerId = omiseCustomer.id;
      await this.customerRepository.save(customer);
    } else {
      omiseCustomer = await this.omiseRequest<OmiseCustomer>(
        `/customers/${omiseCustomerId}`,
        { card: omiseCardToken },
        'PATCH',
      );
    }

    const card = this.extractCardFromCustomer(omiseCustomer);

    return this.mapOmiseCardToSavedDetails(card, token.card.fingerprint);
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
    return this.expirePendingQrPaymentIfNeeded(payment);
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

    return this.expirePendingQrPaymentIfNeeded(payment);
  }

  async createCharge(createChargeDto: CreateChargeDto): Promise<{
    paymentId: string;
    status: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    authorizeUri?: string;
    qrCodeUrl?: string;
    expiresAt?: Date;
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

    // Executable Supersede/Retry Rule (Design Doc § Executable steps; Q-PENDING-RETRY = A / I001).
    // Step 1 — PromptPay resume carve-out: only intentional pending early-return.
    if (paymentMethod === 'promptpay') {
      const existingPromptPay = await this.paymentRepository.findOne({
        where: {
          orderId,
          amount,
          paymentMethod: paymentMethod as Payment['paymentMethod'],
        },
        order: { createdAt: 'DESC' },
      });
      if (existingPromptPay && existingPromptPay.status === 'pending') {
        const activePayment = await this.expirePendingQrPaymentIfNeeded(existingPromptPay);
        if (activePayment.status === 'pending') {
          return {
            paymentId: activePayment.id,
            status: activePayment.status,
            amount,
            currency,
            paymentMethod,
            authorizeUri: activePayment.authorizeUri ?? undefined,
            qrCodeUrl: activePayment.qrCodeUrl ?? undefined,
            expiresAt: this.getEffectiveExpiresAt(activePayment) ?? undefined,
          };
        }
      }
    }

    // Step 2 — Otherwise (all credit_card creates, method switches, COD, new PromptPay):
    // supersede other pending for this order locally. Never early-return credit_card pending (step 3).
    // MVP: no Omise reverse — superseded charge may remain open at Omise (ops orphan residual).
    await this.supersedePendingPaymentsForOrder(orderId);

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

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException({
        code: 'ORDER_NOT_PAYABLE',
        message: 'This order is no longer awaiting payment',
      });
    }

    // Step 4 — Create new Payment + Omise charge (steps 3–5 continue below).
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

        const customer = await this.customerRepository.findOne({ where: { id: customerId } });
        if (!customer?.omiseCustomerId) {
          throw new BadRequestException({
            code: 'OMISE_CUSTOMER_NOT_FOUND',
            message: 'Saved card is not linked to a payment profile',
          });
        }

        // Saved methods store Omise card ids (card_test_...), not one-time tokens.
        chargeBody.customer = customer.omiseCustomerId;
        chargeBody.card = saved.omiseCardToken;
      } else if (omiseToken) {
        chargeBody.card = omiseToken;
      } else {
        throw new BadRequestException({
          code: 'CARD_TOKEN_REQUIRED',
          message: 'Credit card payments require an Omise token or saved payment method',
        });
      }

      const storefrontUrl = this.configService.get<string>('app.storefrontUrl');
      if (!storefrontUrl?.trim()) {
        throw new BadRequestException({
          code: 'STOREFRONT_URL_NOT_CONFIGURED',
          message: 'Storefront URL is not configured',
        });
      }
      try {
        chargeBody.return_uri = buildOmiseReturnUri(storefrontUrl, payment.id);
      } catch {
        throw new BadRequestException({
          code: 'STOREFRONT_URL_NOT_CONFIGURED',
          message: 'Storefront URL is not configured',
        });
      }
    }

    const charge = await this.omiseRequest<OmiseCharge>('/charges', chargeBody);

    const authorizeUri = charge.authorize_uri ?? null;
    const qrCodeUrl = charge.source?.scannable_code?.image?.download_uri ?? null;
    const expiresAt = paymentMethod === 'promptpay' ? this.computeQrExpiresAt() : null;

    // Step 5 — latest charge is active UI/webhook target (paymentReference pointer).
    order.paymentReference = charge.id;
    await this.orderRepository.save(order);

    if (charge.status === 'successful') {
      await this.markOrderPaid(order, payment, charge.id);
    } else {
      payment.status = charge.status === 'failed' ? 'failed' : 'pending';
      payment.authorizeUri = authorizeUri;
      payment.qrCodeUrl = qrCodeUrl;
      payment.expiresAt = expiresAt;
      await this.paymentRepository.save(payment);
      if (payment.status === 'failed') {
        await this.paymentEventsService.publishPaymentStatusUpdated(payment);
      }
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      amount,
      currency,
      paymentMethod,
      authorizeUri: authorizeUri ?? undefined,
      qrCodeUrl: qrCodeUrl ?? undefined,
      expiresAt: expiresAt ?? undefined,
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
    data?: {
      object?: string;
      id?: string;
      status?: string;
      paid?: boolean;
      sent?: boolean;
      verified?: boolean;
      active?: boolean;
      failure_code?: string | null;
      failure_message?: string | null;
    };
  }): Promise<void> {
    this.logger.log(`Omise webhook: ${payload.key}`);

    if (payload.key?.startsWith('transfer.')) {
      await this.payoutsService.handleOmiseTransferWebhook(payload);
      return;
    }

    if (payload.key?.startsWith('recipient.')) {
      await this.storesService.handleOmiseRecipientWebhook(payload);
      return;
    }

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
      const isCreditCard = payment.paymentMethod === PaymentMethod.CREDIT_CARD;

      await this.paymentRepository.manager.transaction(async (manager) => {
        payment.status = 'failed';
        await manager.save(payment);

        // UD-001: card/3DS fail keeps PENDING_PAYMENT so same-order retry works; no stock restore.
        if (!isCreditCard) {
          order.status = OrderStatus.CANCELLED;
          await manager.save(order);

          await this.inventoryService.restoreOrderStock(order.id, manager, 'Payment failed');
        }
      });
      await this.paymentEventsService.publishPaymentStatusUpdated(payment);
      if (isCreditCard) {
        this.logger.log(
          `Credit card payment ${payment.id} failed; order ${order.id} left PENDING_PAYMENT`,
        );
      }
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

    await this.paymentEventsService.publishPaymentStatusUpdated(payment);
    await this.notificationsService.notifyOrderPaid(order);
  }
}
