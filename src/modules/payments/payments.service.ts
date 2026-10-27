import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { CreateChargeDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentEventsService } from './payment-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { PayoutsService } from '../payouts/payouts.service';
import { StoresService } from '../stores/stores.service';
import { buildPaymentReturnUri } from './build-payment-return-uri';
import { verifyBeamWebhookSignature } from './beam-webhook.util';
import { BeamService, type BeamCharge, type BeamCreateChargeBody } from '../beam/beam.service';
import {
  CheckoutPaymentMethod,
  isNonOmiseCheckoutPaymentMethod,
  normalizeCheckoutPaymentMethod,
} from '../../common/utils/checkout-payment.util';
import { orderHasHeldItems } from '../orders/order-totals.util';
import { deriveOrderStatusFromFulfillment } from '../orders/order-fulfillment.util';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { assertGuestPayTokenAccess } from '../../common/utils/guest-pay-token.util';
import { BankTransferSettingsService } from '../platform/bank-transfer-settings.service';
import { OrderAuditLogsService } from '../order-audit-logs/order-audit-logs.service';
import {
  MANUAL_BANK_TRANSFER_APPROVAL,
  OrderAuditActorType,
  OrderAuditEventType,
  VENDOR_ADMIN_ACTOR_LABEL,
} from '../order-audit-logs/order-audit-log.constants';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
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
    private beamService: BeamService,
  ) {}

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

      // Clear paymentReference so a late provider webhook cannot match and invent paid
      // (same orphan defense as card→COD).
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

    const providerChargeId = payment.pspChargeId ?? payment.omiseChargeId;

    await this.paymentRepository.manager.transaction(async (manager) => {
      payment.status = 'failed';
      await manager.save(payment);

      if (
        order.paymentReference &&
        (!providerChargeId || order.paymentReference === providerChargeId)
      ) {
        order.paymentReference = null;
        await manager.save(order);
      }
    });

    await this.paymentEventsService.publishPaymentStatusUpdated(payment);
    this.vendorWebhooksService.dispatchOrderEvent(order.id, 'order.payment_failed').catch(() => {});
    return payment;
  }

  /**
   * Cancel PENDING_PAYMENT orders older than unpaidOrderCancelAfterMs with no paid payment.
   * Also cancels unpaid legacy guest orders (null guestPayTokenHash) with no age cutoff.
   * This is the order-level 24h hygiene path (distinct from QR ~15m payment expiry).
   */
  async cancelStaleUnpaidOrders(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.getUnpaidOrderCancelAfterMs());
    const candidates = await this.orderRepository.find({
      where: [
        {
          status: OrderStatus.PENDING_PAYMENT,
          createdAt: LessThanOrEqual(cutoff),
        },
        {
          status: OrderStatus.PENDING_PAYMENT,
          guestPhone: Not(IsNull()),
          guestPayTokenHash: IsNull(),
        },
      ],
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
   * Does not cancel the order or restore stock. No PSP cancel call is made.
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
    if (method === 'truemoney') return PaymentMethod.TRUEMONEY;
    if (method === 'shopeepay') return PaymentMethod.SHOPEEPAY;
    return PaymentMethod.COD;
  }

  private applyPaymentReturnUri(paymentId: string): string {
    const storefrontUrl = this.configService.get<string>('app.storefrontUrl');
    if (!storefrontUrl?.trim()) {
      throw new BadRequestException({
        code: 'STOREFRONT_URL_NOT_CONFIGURED',
        message: 'Storefront URL is not configured',
      });
    }
    try {
      return buildPaymentReturnUri(storefrontUrl, paymentId);
    } catch {
      throw new BadRequestException({
        code: 'STOREFRONT_URL_NOT_CONFIGURED',
        message: 'Storefront URL is not configured',
      });
    }
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

  async assertCanPayForOrder(
    orderId: string,
    customerId?: string,
    guestPayToken?: string,
  ): Promise<Order> {
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

    // Authenticated order owner — JWT is sufficient (no guest pay token).
    if (customerId && order.customerId === customerId) {
      return order;
    }

    // Authenticated non-owner is always denied (including guest-linked member orders).
    if (customerId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to pay for this order',
      });
    }

    // Unauthenticated: guest-originated orders only (matching guest pay token required).
    if (!order.guestPhone) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to pay for this order',
      });
    }

    assertGuestPayTokenAccess(order, guestPayToken);
    return order;
  }

  async assertCanAccessPayment(
    paymentId: string,
    customerId?: string,
    guestPayToken?: string,
  ): Promise<void> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
      select: ['id', 'orderId'],
    });
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    await this.assertCanPayForOrder(payment.orderId, customerId, guestPayToken);
  }

  async findById(id: string, customerId?: string, guestPayToken?: string): Promise<Payment> {
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

    await this.assertCanPayForOrder(payment.orderId, customerId, guestPayToken);
    return this.expirePendingQrPaymentIfNeeded(payment);
  }

  async findLatestByOrderId(
    orderId: string,
    customerId?: string,
    guestPayToken?: string,
  ): Promise<Payment> {
    await this.assertCanPayForOrder(orderId, customerId, guestPayToken);

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
    qrCodeImage?: string;
    expiresAt?: Date;
  }> {
    const {
      orderId,
      paymentMethod: rawPaymentMethod,
      currency,
      cardToken,
      cardSecurityCode,
      savedPaymentMethodId,
      customerId,
      guestPayToken,
    } = createChargeDto;
    const paymentMethod = normalizeCheckoutPaymentMethod(rawPaymentMethod);

    const order = await this.assertCanPayForOrder(orderId, customerId, guestPayToken);

    // Eligibility gate (all methods, including COD) — unpaid-switch Backend DD.
    const latestPayment = await this.paymentRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    this.assertOrderPayableForCreate(order, latestPayment);

    // Short FOR UPDATE: re-check → local supersede → insert payment → Beam charge.
    type CreateChargeResult = {
      paymentId: string;
      status: string;
      amount: number;
      currency: string;
      paymentMethod: string;
      authorizeUri?: string;
      qrCodeUrl?: string;
      qrCodeImage?: string;
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

        // Always charge the locked order total — ignore client-supplied CreatePaymentInput.amount.
        const orderAmount = Number(lockedOrder.total);
        if (!Number.isFinite(orderAmount) || orderAmount < 0) {
          throw new BadRequestException({
            code: 'INVALID_ORDER_TOTAL',
            message: 'Order total is invalid',
          });
        }

        const previousPaymentMethod = lockedOrder.paymentMethod;
        const orderPaymentMethod = this.toOrderPaymentMethod(paymentMethod);

        if (isNonOmiseCheckoutPaymentMethod(paymentMethod)) {
          if (paymentMethod === 'bank_transfer') {
            // Ensure display config is present before accepting the method.
            await this.assertBankTransferConfigured();
          }

          const payment = manager.create(Payment, {
            orderId,
            amount: orderAmount,
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
            amount: orderAmount,
            currency,
            paymentMethod,
          };
        }

        if (!this.beamService.hasCredentials()) {
          throw new BadRequestException({
            code: 'BEAM_NOT_CONFIGURED',
            message: 'Payment provider is not configured',
          });
        }

        const amountSatang = Math.round(orderAmount * 100);

        const payment = manager.create(Payment, {
          orderId,
          amount: orderAmount,
          currency,
          paymentMethod: orderPaymentMethod,
          status: 'pending',
        });
        await manager.save(payment);

        const qrExpiresAt = paymentMethod === 'promptpay' ? this.computeQrExpiresAt() : null;
        const chargeBody: BeamCreateChargeBody = {
          amount: amountSatang,
          currency: 'THB',
          referenceId: payment.id,
          returnUrl: this.applyPaymentReturnUri(payment.id),
          skip3dsFlow: false,
          paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY' },
        };

        if (paymentMethod === 'promptpay') {
          chargeBody.paymentMethod = {
            paymentMethodType: 'QR_PROMPT_PAY',
            qrPromptPay: { expiryTime: (qrExpiresAt as Date).toISOString() },
          };
        } else if (paymentMethod === 'credit_card') {
          let cardTokenId = cardToken;
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
            if (saved.psp !== 'beam') {
              throw new BadRequestException({
                code: 'SAVED_CARD_PROVIDER_UNSUPPORTED',
                message: 'This saved card cannot be used with the current payment provider',
              });
            }
            cardTokenId = cardToken ?? saved.pspCardToken ?? undefined;
          }

          if (!cardTokenId) {
            throw new BadRequestException({
              code: 'CARD_TOKEN_REQUIRED',
              message: 'Credit card payments require a card token or saved payment method',
            });
          }
          if (!cardSecurityCode?.trim()) {
            throw new BadRequestException({
              code: 'CARD_SECURITY_CODE_REQUIRED',
              message: 'Credit card payments require a security code',
            });
          }

          chargeBody.paymentMethod = {
            paymentMethodType: 'CARD_TOKEN',
            cardToken: { cardTokenId, securityCode: cardSecurityCode.trim() },
          };
        } else if (paymentMethod === 'truemoney') {
          chargeBody.paymentMethod = { paymentMethodType: 'TRUE_MONEY', trueMoney: {} };
        } else if (paymentMethod === 'shopeepay') {
          chargeBody.paymentMethod = { paymentMethodType: 'SHOPEE_PAY', shopeePay: {} };
        }

        const charge = await this.beamService.createCharge(chargeBody);

        const authorizeUri = charge.redirect?.redirectUrl ?? null;
        const qrCodeImage = charge.encodedImage?.imageBase64Encoded ?? null;
        const expiresAt = qrExpiresAt;
        const chargeStatus = (charge.status ?? '').toUpperCase();

        payment.psp = 'beam';
        payment.pspChargeId = charge.chargeId;
        payment.status = chargeStatus === 'FAILED' ? 'failed' : 'pending';
        payment.authorizeUri = authorizeUri;
        payment.qrCodeImage = qrCodeImage;
        payment.expiresAt = expiresAt;
        await manager.save(payment);

        lockedOrder.paymentMethod = orderPaymentMethod;
        lockedOrder.paymentReference = charge.chargeId;
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
          amount: orderAmount,
          currency,
          paymentMethod,
          authorizeUri: authorizeUri ?? undefined,
          qrCodeImage: qrCodeImage ?? undefined,
          expiresAt: expiresAt ?? undefined,
        };

        if (chargeStatus === 'SUCCEEDED') {
          response.status = 'paid';
          response.paidImmediately = {
            order: lockedOrder,
            payment,
            chargeId: charge.chargeId,
          };
        }
        // actionRequired NONE with non-succeeded status: stay pending; webhook finalizes.

        return response;
      },
    );

    if (result.paidImmediately) {
      await this.markOrderPaid(
        result.paidImmediately.order,
        result.paidImmediately.payment,
        result.paidImmediately.chargeId,
      );
    }

    return {
      paymentId: result.paymentId,
      status: result.status,
      amount: result.amount,
      currency: result.currency,
      paymentMethod: result.paymentMethod,
      authorizeUri: result.authorizeUri,
      qrCodeUrl: result.qrCodeUrl,
      qrCodeImage: result.qrCodeImage,
      expiresAt: result.expiresAt,
    };
  }

  verifyBeamWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = this.configService.get<string>('beam.webhookSecret') ?? '';
    if (!secret) {
      this.logger.warn('BEAM_WEBHOOK_SECRET not set — rejecting webhook');
      return false;
    }
    return verifyBeamWebhookSignature(rawBody, signature, secret);
  }

  async handleBeamWebhook(payload: Record<string, unknown>): Promise<void> {
    const chargeId = this.extractBeamChargeId(payload);
    if (!chargeId) {
      this.logger.warn('Beam webhook without chargeId — ignoring');
      return;
    }

    // Prefer psp=beam rows; fall back to order.paymentReference.
    let payment = await this.paymentRepository.findOne({
      where: { pspChargeId: chargeId, psp: 'beam' },
      order: { createdAt: 'DESC' },
    });
    let order: Order | null = null;
    if (payment) {
      order = await this.orderRepository.findOne({ where: { id: payment.orderId } });
    } else {
      order = await this.orderRepository.findOne({ where: { paymentReference: chargeId } });
      if (order) {
        payment = await this.paymentRepository.findOne({
          where: { orderId: order.id },
          order: { createdAt: 'DESC' },
        });
      }
    }
    if (!order || !payment) {
      this.logger.warn(`No order/payment for Beam charge ${chargeId}`);
      return;
    }

    if (order.status === OrderStatus.PAID || payment.status === 'paid') {
      this.logger.log(`Order ${order.id} already paid — ignoring duplicate Beam webhook`);
      return;
    }
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
      this.logger.log(`Order ${order.id} is ${order.status} — ignoring Beam webhook`);
      return;
    }

    let apiCharge: BeamCharge;
    try {
      apiCharge = await this.beamService.getCharge(chargeId);
    } catch (error) {
      this.logger.error(`Failed to re-fetch Beam charge ${chargeId}: ${error}`);
      return;
    }

    const chargeStatus = (apiCharge.status ?? '').toUpperCase();

    if (chargeStatus === 'SUCCEEDED') {
      const expectedSatang = Math.round(Number(order.total) * 100);
      const apiAmount = apiCharge.amount;
      if (
        typeof apiAmount !== 'number' ||
        !Number.isFinite(apiAmount) ||
        apiAmount !== expectedSatang
      ) {
        this.logger.warn(
          JSON.stringify({
            event: 'payment_amount_mismatch',
            orderId: order.id,
            paymentId: payment.id,
            beamChargeId: chargeId,
            expectedSatang,
            beamAmountSatang: apiAmount ?? null,
          }),
        );
        return;
      }
      await this.markOrderPaid(order, payment, chargeId);
      return;
    }

    if (chargeStatus === 'FAILED') {
      if (payment.status !== 'pending') {
        return;
      }
      await this.paymentRepository.manager.transaction(async (manager) => {
        payment.status = 'failed';
        await manager.save(payment);

        if (order.paymentReference === chargeId) {
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

  private extractBeamChargeId(payload: Record<string, unknown>): string | null {
    const candidates: unknown[] = [payload.chargeId];
    const data = payload.data as Record<string, unknown> | undefined;
    const charge = payload.charge as Record<string, unknown> | undefined;
    candidates.push(data?.chargeId, charge?.chargeId);
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
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
