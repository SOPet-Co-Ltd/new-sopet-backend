import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
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
import {
  CheckoutPaymentMethod,
  isNonOmiseCheckoutPaymentMethod,
  normalizeCheckoutPaymentMethod,
} from '../../common/utils/checkout-payment.util';
import { orderHasHeldItems } from '../orders/order-totals.util';
import { deriveOrderStatusFromFulfillment } from '../orders/order-fulfillment.util';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { scrubJsonForLog } from '../../common/utils/scrub-for-log.util';
import { BankTransferSettingsService } from '../platform/bank-transfer-settings.service';
import { OrderAuditLogsService } from '../order-audit-logs/order-audit-logs.service';
import {
  MANUAL_BANK_TRANSFER_APPROVAL,
  OrderAuditActorType,
  OrderAuditEventType,
  VENDOR_ADMIN_ACTOR_LABEL,
} from '../order-audit-logs/order-audit-log.constants';

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
    private vendorWebhooksService: VendorWebhooksService,
    private bankTransferSettingsService: BankTransferSettingsService,
    private orderAuditLogsService: OrderAuditLogsService,
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

  private getUnpaidOrderCancelAfterMs(): number {
    const configured = this.configService.get<number>('payment.unpaidOrderCancelAfterMs');
    return configured && configured > 0 ? configured : 86_400_000;
  }

  /**
   * Shared cancel+stock-restore transaction used by 24h unpaid cancel.
   * QR ~15m expiry fails the payment only (see finalizeExpiredPayment) so the customer can
   * create a new QR while the order remains pending_payment within the 24h window.
   */
  private async cancelOrderRestoreStockAndFailPayments(
    order: Order,
    paymentsToFail: Payment[],
    restoreReason: string,
  ): Promise<void> {
    await this.paymentRepository.manager.transaction(async (manager) => {
      for (const payment of paymentsToFail) {
        if (payment.status === 'pending') {
          payment.status = 'failed';
          await manager.save(payment);
        }
      }

      // Clear paymentReference so a late Omise webhook cannot match and invent paid
      // (same orphan defense as Omise→COD).
      order.status = OrderStatus.CANCELLED;
      order.paymentReference = null;
      await manager.save(order);

      await this.inventoryService.restoreOrderStock(order.id, manager, restoreReason);
    });

    for (const payment of paymentsToFail) {
      if (payment.status === 'failed') {
        await this.paymentEventsService.publishPaymentStatusUpdated(payment);
      }
    }
    this.vendorWebhooksService.dispatchOrderEvent(order.id, 'order.cancelled').catch(() => {});
  }

  /**
   * PromptPay QR window elapsed: mark payment failed and clear paymentReference, but keep the
   * order pending_payment so the customer can createPayment for a new QR until the 24h job.
   */
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

    const chargeId = payment.omiseChargeId ?? order.paymentReference;

    await this.paymentRepository.manager.transaction(async (manager) => {
      payment.status = 'failed';
      await manager.save(payment);

      if (
        order.paymentReference &&
        (!payment.omiseChargeId || order.paymentReference === payment.omiseChargeId)
      ) {
        order.paymentReference = null;
        await manager.save(order);
      }
    });

    if (chargeId && this.omiseSecretKey) {
      await this.cancelOmiseChargeBestEffort(chargeId, payment.paymentMethod);
    }

    await this.paymentEventsService.publishPaymentStatusUpdated(payment);
    this.vendorWebhooksService.dispatchOrderEvent(order.id, 'order.payment_failed').catch(() => {});
    return payment;
  }

  /**
   * Cancel PENDING_PAYMENT orders older than unpaidOrderCancelAfterMs with no paid payment.
   * This is the order-level 24h hygiene path (distinct from QR ~15m payment expiry).
   */
  async cancelStaleUnpaidOrders(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.getUnpaidOrderCancelAfterMs());
    const candidates = await this.orderRepository.find({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: LessThanOrEqual(cutoff),
      },
      relations: ['items'],
    });

    let cancelledCount = 0;
    for (const order of candidates) {
      try {
        if (order.status !== OrderStatus.PENDING_PAYMENT) {
          continue;
        }

        if (orderHasHeldItems(order.items)) {
          this.logger.log(
            `Skipping stale unpaid cancel for order ${order.id}: one or more items on_hold`,
          );
          continue;
        }

        const paidPayment = await this.paymentRepository.findOne({
          where: { orderId: order.id, status: 'paid' },
        });
        if (paidPayment) {
          continue;
        }

        const orderPayments = await this.paymentRepository.find({
          where: { orderId: order.id },
        });
        const pendingPayments = orderPayments.filter((p) => p.status === 'pending');

        await this.cancelOrderRestoreStockAndFailPayments(
          order,
          pendingPayments,
          'Unpaid order expired',
        );
        cancelledCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to cancel stale unpaid order ${order.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return cancelledCount;
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
   * Does not cancel the order or restore stock. Omise cancel runs in Phase A (outside the lock).
   */
  private async supersedePendingPaymentsForOrder(
    orderId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const pendingPayments = manager
      ? await manager.find(Payment, { where: { orderId, status: 'pending' } })
      : await this.paymentRepository.find({ where: { orderId, status: 'pending' } });

    for (const pending of pendingPayments) {
      pending.status = 'failed';
      if (manager) {
        await manager.save(pending);
      } else {
        await this.paymentRepository.save(pending);
      }
      await this.paymentEventsService.publishPaymentStatusUpdated(pending);
    }
  }

  private getOmiseCancelTimeoutMs(): number {
    const configured = this.configService.get<number>('payment.omiseCancelTimeoutMs');
    return configured && configured > 0 ? configured : 4000;
  }

  private formatCaughtErrorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') {
          return message;
        }
      }
      return 'BadRequestException';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'unknown';
  }

  /**
   * Best-effort Omise expire/reverse within omiseCancelTimeoutMs. Never throws for cleanup failure.
   * PromptPay: POST /charges/{id}/expire (Omise support varies; may fail — fail-open).
   * Card: expire then reverse. Fail-open otherwise.
   */
  private async cancelOmiseChargeBestEffort(
    chargeId: string,
    paymentMethod: PaymentMethod,
  ): Promise<'cancelled' | 'failed_open'> {
    if (!this.omiseSecretKey || !chargeId) {
      return 'failed_open';
    }

    const timeoutMs = this.getOmiseCancelTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const expireCharge = async (): Promise<void> => {
      // Empty body so POST is unambiguous (some Omise paths reject GET-style empty posts).
      await this.omiseRequest(`/charges/${chargeId}/expire`, {}, 'POST', controller.signal);
    };

    try {
      const isPromptPay = paymentMethod === PaymentMethod.PROMPTPAY;

      if (isPromptPay) {
        await expireCharge();
        return 'cancelled';
      }

      try {
        await expireCharge();
        return 'cancelled';
      } catch (expireError) {
        if (controller.signal.aborted) {
          this.logger.warn(
            JSON.stringify({
              event: 'omise_cancel_timeout',
              omiseChargeId: chargeId,
              paymentMethod,
            }),
          );
          return 'failed_open';
        }
        this.logger.warn(
          JSON.stringify({
            event: 'omise_expire_failed_try_reverse',
            omiseChargeId: chargeId,
            paymentMethod,
            message: this.formatCaughtErrorMessage(expireError),
          }),
        );
        await this.omiseRequest(`/charges/${chargeId}/reverse`, {}, 'POST', controller.signal);
        return 'cancelled';
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'omise_cancel_failed',
          omiseChargeId: chargeId,
          paymentMethod,
          message: this.formatCaughtErrorMessage(error),
        }),
      );
      return 'failed_open';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Phase A: cancel every known Omise charge for pending payments (outside FOR UPDATE).
   * Collects omiseChargeId on each pending row plus order.paymentReference so multi-pending
   * switches still expire the active webhook pointer even when some rows lack omiseChargeId.
   */
  private async cancelPendingOmiseChargesForOrder(order: Order): Promise<void> {
    const pendingPayments = await this.paymentRepository.find({
      where: { orderId: order.id, status: 'pending' },
    });
    if (pendingPayments.length === 0 || !this.omiseSecretKey) {
      return;
    }

    const chargeTargets = new Map<string, PaymentMethod>();
    for (const pending of pendingPayments) {
      if (pending.omiseChargeId) {
        chargeTargets.set(pending.omiseChargeId, pending.paymentMethod);
      }
    }

    // Include order.paymentReference when any pending row still lacks omiseChargeId
    // (legacy rows) or when no charge ids were collected at all. Do not cancel a
    // stale paymentReference when every pending row already has omiseChargeId.
    const needsPaymentReferenceFallback =
      pendingPayments.some((p) => !p.omiseChargeId) || chargeTargets.size === 0;
    if (
      needsPaymentReferenceFallback &&
      order.paymentReference &&
      !chargeTargets.has(order.paymentReference)
    ) {
      const matching =
        pendingPayments.find((p) => !p.omiseChargeId) ??
        pendingPayments.find((p) => p.paymentMethod === PaymentMethod.PROMPTPAY) ??
        pendingPayments[0];
      chargeTargets.set(order.paymentReference, matching?.paymentMethod ?? PaymentMethod.PROMPTPAY);
    }

    for (const [chargeId, paymentMethod] of chargeTargets) {
      const pending = pendingPayments.find(
        (p) => p.omiseChargeId === chargeId || order.paymentReference === chargeId,
      );
      const result = await this.cancelOmiseChargeBestEffort(chargeId, paymentMethod);
      if (result === 'failed_open') {
        this.logger.warn(
          JSON.stringify({
            event: 'omise_cancel_fail_open',
            orderId: order.id,
            paymentId: pending?.id ?? null,
            omiseChargeId: chargeId,
            paymentMethod,
            reason: 'cancel_failed_unsupported_or_timeout',
          }),
        );
      } else {
        this.logger.log(
          JSON.stringify({
            event: 'omise_cancel_ok',
            orderId: order.id,
            paymentId: pending?.id ?? null,
            omiseChargeId: chargeId,
            paymentMethod,
          }),
        );
      }
    }
  }

  private assertOrderPayableForCreate(order: Order, latestPayment: Payment | null): void {
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException({
        code: 'ORDER_NOT_PAYABLE',
        message: 'This order is no longer awaiting payment',
      });
    }
    if (latestPayment && latestPayment.status !== 'pending' && latestPayment.status !== 'failed') {
      throw new BadRequestException({
        code: 'ORDER_NOT_PAYABLE',
        message: 'This order is no longer awaiting payment',
      });
    }
    if (orderHasHeldItems(order.items)) {
      throw new BadRequestException({
        code: 'PAYMENT_HELD_PORTION_BLOCKED',
        message: 'Payment is blocked while any order item is on hold',
      });
    }
  }

  private async loadOrderItemsIfNeeded(
    order: Order,
    manager?: EntityManager,
  ): Promise<OrderItem[]> {
    if (order.items?.length) {
      return order.items;
    }
    const items = manager
      ? await manager.find(OrderItem, { where: { orderId: order.id } })
      : await this.orderRepository.manager.find(OrderItem, { where: { orderId: order.id } });
    order.items = items;
    return items;
  }

  private toOrderPaymentMethod(method: CheckoutPaymentMethod): PaymentMethod {
    if (method === 'promptpay') return PaymentMethod.PROMPTPAY;
    if (method === 'credit_card') return PaymentMethod.CREDIT_CARD;
    if (method === 'bank_transfer') return PaymentMethod.BANK_TRANSFER;
    return PaymentMethod.COD;
  }

  async getBankTransferDetails(): Promise<{
    bankName: string;
    accountName: string;
    accountNumber: string;
    branchName: string | null;
  } | null> {
    const value = await this.bankTransferSettingsService.get();
    if (!this.bankTransferSettingsService.isAvailable(value)) {
      return null;
    }
    return {
      bankName: value.bankName,
      accountName: value.accountName,
      accountNumber: value.accountNumber,
      branchName: value.branchName,
    };
  }

  async assertBankTransferConfigured(): Promise<void> {
    await this.bankTransferSettingsService.getConfigured();
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
    signal?: AbortSignal,
  ): Promise<T> {
    const resolvedMethod = method ?? (body !== undefined ? 'POST' : 'GET');
    const response = await fetch(`https://api.omise.co${path}`, {
      method: resolvedMethod,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.omiseSecretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
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
      this.logger.error(`Omise ${method} ${path} failed: ${scrubJsonForLog(data)}`);
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

  private extractCardFromCustomer(
    omiseCustomer: OmiseCustomer,
    preferredCard?: OmiseCard,
  ): OmiseCard {
    const cards = omiseCustomer.cards?.data ?? [];

    // Prefer the card matching the just-used token. Omise keeps `default_card` on the
    // previous default when attaching an additional card via PATCH `{ card: token }`.
    if (preferredCard) {
      const matched = cards.find((item) => this.isSameCard(item, preferredCard));
      if (matched) {
        return matched;
      }
    }

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

    const card = this.extractCardFromCustomer(omiseCustomer, token.card);

    return this.mapOmiseCardToSavedDetails(card, token.card.fingerprint);
  }

  async assertCanPayForOrder(orderId: string, customerId?: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order) {
      throw new BadRequestException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    if (order.customerId && order.customerId !== customerId) {
      // Guest checkouts placed with an existing member's phone are linked to that
      // member's account at creation time. Such orders still carry a guestPhone, so
      // the unauthenticated buyer (identified by possession of the order UUID) must
      // keep access to pay for and view them. Pure member orders (no guestPhone)
      // remain accessible only to their owning customer.
      const isGuestOriginatedOrder = Boolean(order.guestPhone);
      const isUnauthenticatedGuest = !customerId;
      if (!(isGuestOriginatedOrder && isUnauthenticatedGuest)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have access to pay for this order',
        });
      }
    }

    return order;
  }

  async findById(id: string, customerId?: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id },
      relations: ['order'],
    });
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
      relations: ['order'],
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

    // Eligibility gate (all methods, including COD) — unpaid-switch Backend DD.
    const latestPayment = await this.paymentRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    this.assertOrderPayableForCreate(order, latestPayment);

    // Phase A — Omise cancel outside FOR UPDATE (fail-open).
    await this.cancelPendingOmiseChargesForOrder(order);

    // Phase B — short FOR UPDATE: re-check → local supersede → insert payment.
    type CreateChargeResult = {
      paymentId: string;
      status: string;
      amount: number;
      currency: string;
      paymentMethod: string;
      authorizeUri?: string;
      qrCodeUrl?: string;
      expiresAt?: Date;
      paidImmediately?: { order: Order; payment: Payment; chargeId: string };
    };

    const result = await this.paymentRepository.manager.transaction(
      async (manager): Promise<CreateChargeResult> => {
        const lockedOrder = await manager.findOne(Order, {
          where: { id: orderId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedOrder) {
          throw new BadRequestException({
            code: 'ORDER_NOT_FOUND',
            message: 'Order not found',
          });
        }

        await this.loadOrderItemsIfNeeded(lockedOrder, manager);

        const latestUnderLock = await manager.findOne(Payment, {
          where: { orderId },
          order: { createdAt: 'DESC' },
        });
        this.assertOrderPayableForCreate(lockedOrder, latestUnderLock);

        await this.supersedePendingPaymentsForOrder(orderId, manager);

        const previousPaymentMethod = lockedOrder.paymentMethod;
        const orderPaymentMethod = this.toOrderPaymentMethod(paymentMethod);

        if (isNonOmiseCheckoutPaymentMethod(paymentMethod)) {
          if (paymentMethod === 'bank_transfer') {
            // Ensure display config is present before accepting the method.
            await this.assertBankTransferConfigured();
          }

          const payment = manager.create(Payment, {
            orderId,
            amount,
            currency,
            paymentMethod: orderPaymentMethod,
            status: 'pending',
            omiseChargeId: null,
          });
          await manager.save(payment);

          lockedOrder.paymentMethod = orderPaymentMethod;
          lockedOrder.paymentReference = null;
          await manager.save(lockedOrder);
          await this.appendPaymentMethodChangedIfNeeded(
            manager,
            lockedOrder,
            previousPaymentMethod,
            orderPaymentMethod,
          );

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

        const payment = manager.create(Payment, {
          orderId,
          amount,
          currency,
          paymentMethod: orderPaymentMethod,
          status: 'pending',
        });
        await manager.save(payment);

        const chargeBody: Record<string, unknown> = {
          amount: amountSatang,
          currency: currency.toLowerCase(),
        };

        if (paymentMethod === 'promptpay') {
          chargeBody.source = { type: 'promptpay' };
          // Omise default PromptPay QR lives ~24h; bind to our QR window so abandoned
          // charges die even when POST /charges/{id}/expire is unsupported.
          chargeBody.expires_at = this.computeQrExpiresAt().toISOString();
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

        payment.omiseChargeId = charge.id;
        payment.status = charge.status === 'failed' ? 'failed' : 'pending';
        payment.authorizeUri = authorizeUri;
        payment.qrCodeUrl = qrCodeUrl;
        payment.expiresAt = expiresAt;
        await manager.save(payment);

        lockedOrder.paymentMethod = orderPaymentMethod;
        lockedOrder.paymentReference = charge.id;
        await manager.save(lockedOrder);
        await this.appendPaymentMethodChangedIfNeeded(
          manager,
          lockedOrder,
          previousPaymentMethod,
          orderPaymentMethod,
        );

        if (payment.status === 'failed') {
          await this.paymentEventsService.publishPaymentStatusUpdated(payment);
          this.vendorWebhooksService
            .dispatchOrderEvent(lockedOrder.id, 'order.payment_failed')
            .catch(() => {});
        }

        const response: CreateChargeResult = {
          paymentId: payment.id,
          status: payment.status,
          amount,
          currency,
          paymentMethod,
          authorizeUri: authorizeUri ?? undefined,
          qrCodeUrl: qrCodeUrl ?? undefined,
          expiresAt: expiresAt ?? undefined,
        };

        if (charge.status === 'successful') {
          response.status = 'paid';
          response.paidImmediately = {
            order: lockedOrder,
            payment,
            chargeId: charge.id,
          };
        }

        return response;
      },
    );

    if (result.paidImmediately) {
      await this.markOrderPaid(
        result.paidImmediately.order,
        result.paidImmediately.payment,
        result.paidImmediately.chargeId,
      );
      return {
        paymentId: result.paymentId,
        status: 'paid',
        amount: result.amount,
        currency: result.currency,
        paymentMethod: result.paymentMethod,
        authorizeUri: result.authorizeUri,
        qrCodeUrl: result.qrCodeUrl,
        expiresAt: result.expiresAt,
      };
    }

    return {
      paymentId: result.paymentId,
      status: result.status,
      amount: result.amount,
      currency: result.currency,
      paymentMethod: result.paymentMethod,
      authorizeUri: result.authorizeUri,
      qrCodeUrl: result.qrCodeUrl,
      expiresAt: result.expiresAt,
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
      // Defense-in-depth: cancelled/refunded orders must never be invented paid by a late webhook
      // (primary defense: cancelOrderRestoreStockAndFailPayments nulls paymentReference).
      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        this.logger.warn(`Order ${order.id} is ${order.status} — ignoring charge.complete webhook`);
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
      await this.paymentRepository.manager.transaction(async (manager) => {
        payment.status = 'failed';
        await manager.save(payment);

        // Keep PENDING_PAYMENT for card and PromptPay so same-order retry / new QR works within
        // the 24h unpaid window. Stock restore happens only via cancelStaleUnpaidOrders.
        if (order.paymentReference === charge.id) {
          order.paymentReference = null;
          await manager.save(order);
        }
      });
      await this.paymentEventsService.publishPaymentStatusUpdated(payment);
      this.vendorWebhooksService
        .dispatchOrderEvent(order.id, 'order.payment_failed')
        .catch(() => {});
      this.logger.log(
        `Payment ${payment.id} failed; order ${order.id} left PENDING_PAYMENT for retry`,
      );
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
    this.vendorWebhooksService.dispatchOrderEvent(order.id, 'order.paid').catch(() => {});
  }

  private async appendPaymentMethodChangedIfNeeded(
    manager: EntityManager,
    order: Order,
    previousPaymentMethod: PaymentMethod,
    nextPaymentMethod: PaymentMethod,
  ): Promise<void> {
    if (previousPaymentMethod === nextPaymentMethod) {
      return;
    }

    await this.orderAuditLogsService.append(manager, {
      orderId: order.id,
      eventType: OrderAuditEventType.PAYMENT_METHOD_CHANGED,
      actorType: OrderAuditActorType.customer,
      actorId: order.customerId,
      actorLabel: await this.orderAuditLogsService.resolveCustomerActorLabel(manager, order),
      details: {
        previousPaymentMethod,
        newPaymentMethod: nextPaymentMethod,
      },
    });
  }

  /**
   * Platform-admin confirmation for Direct Bank Transfer.
   * Updates Payment + Order (unlike vendor mark-paid which only flips order status).
   */
  async confirmBankTransferPaid(
    orderId: string,
    adminUserId: string,
    note?: string,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items', 'shippingAddress', 'storeShippings', 'customer'],
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    if (order.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
      throw new BadRequestException({
        code: 'NOT_BANK_TRANSFER',
        message: 'Order is not a bank transfer payment',
      });
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Only pending payment bank transfer orders can be confirmed',
      });
    }

    const payment = await this.paymentRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    if (!payment || payment.status === 'paid') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_CONFIRMABLE',
        message: 'No pending bank transfer payment to confirm',
      });
    }
    if (payment.paymentMethod !== PaymentMethod.BANK_TRANSFER) {
      throw new BadRequestException({
        code: 'NOT_BANK_TRANSFER',
        message: 'Latest payment is not bank transfer',
      });
    }

    await this.loadOrderItemsIfNeeded(order);

    const nextStatus = deriveOrderStatusFromFulfillment(
      OrderStatus.PAID,
      (order.items ?? []).map((item) => item.fulfillmentStatus),
    );

    const reference = `bank_transfer:${adminUserId}`;
    const historyNote = note?.trim()
      ? `Admin confirmed bank transfer: ${note.trim()}`
      : 'Admin confirmed bank transfer paid';

    await this.paymentRepository.manager.transaction(async (trx) => {
      payment.status = 'paid';
      await trx.save(payment);

      order.status = nextStatus;
      order.paymentReference = reference;
      order.paidAt = order.paidAt ?? new Date();
      await trx.save(order);

      await trx.save(
        OrderStatusHistory,
        trx.create(OrderStatusHistory, {
          orderId: order.id,
          status: nextStatus,
          changedBy: adminUserId,
          notes: historyNote,
        }),
      );

      await this.orderAuditLogsService.append(trx, {
        orderId: order.id,
        eventType: OrderAuditEventType.PAYMENT_APPROVED,
        actorType: OrderAuditActorType.admin,
        actorId: adminUserId,
        actorLabel: VENDOR_ADMIN_ACTOR_LABEL,
        details: {
          approvalMethod: MANUAL_BANK_TRANSFER_APPROVAL,
          note: note?.trim() || null,
        },
      });
    });

    await this.paymentEventsService.publishPaymentStatusUpdated(payment);
    await this.notificationsService.notifyOrderPaid(order);
    this.vendorWebhooksService.dispatchOrderEvent(order.id, 'order.paid').catch(() => {});

    return order;
  }
}
