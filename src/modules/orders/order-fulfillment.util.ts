import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>([OrderStatus.CANCELLED, OrderStatus.REFUNDED]);

export const VENDOR_CANCELLABLE_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
]);

export function validateOptionalTrackingUrl(trackingUrl?: string | null): string | null {
  const trimmed = (trackingUrl ?? '').trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2048) {
    throw new BadRequestException({
      code: 'TRACKING_URL_TOO_LONG',
      message: 'Tracking URL must be at most 2048 characters',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException({
      code: 'TRACKING_URL_INVALID',
      message: 'Tracking URL must be a valid URL',
    });
  }

  if (parsed.protocol !== 'https:') {
    // Tracking links are rendered in customer emails; require HTTPS to avoid mixed-content blocks.
    throw new BadRequestException({
      code: 'TRACKING_URL_INSECURE',
      message: 'Tracking URL must use HTTPS',
    });
  }

  return parsed.toString();
}

/** @deprecated Use validateOptionalTrackingUrl — kept for existing tests */
export function validateTrackingUrl(trackingUrl: string): string {
  const normalized = validateOptionalTrackingUrl(trackingUrl);
  if (!normalized) {
    throw new BadRequestException({
      code: 'TRACKING_URL_REQUIRED',
      message: 'Tracking URL is required',
    });
  }
  return normalized;
}

export function validateTrackingNumber(trackingNumber: string): string {
  const trimmed = trackingNumber.trim();
  if (!trimmed) {
    throw new BadRequestException({
      code: 'TRACKING_NUMBER_REQUIRED',
      message: 'Tracking number is required',
    });
  }
  if (trimmed.length > 100) {
    throw new BadRequestException({
      code: 'TRACKING_NUMBER_TOO_LONG',
      message: 'Tracking number must be at most 100 characters',
    });
  }
  return trimmed;
}

export function validateFulfillmentProvider(fulfillmentProvider: string): string {
  const trimmed = fulfillmentProvider.trim();
  if (!trimmed) {
    throw new BadRequestException({
      code: 'FULFILLMENT_PROVIDER_REQUIRED',
      message: 'Fulfillment provider is required',
    });
  }
  if (trimmed.length > 100) {
    throw new BadRequestException({
      code: 'FULFILLMENT_PROVIDER_TOO_LONG',
      message: 'Fulfillment provider must be at most 100 characters',
    });
  }
  return trimmed;
}

/**
 * Derive order header status from item fulfillment statuses (Model 5C).
 *
 * Precedence (Design Doc §2 / Decision #15):
 * 1. Terminal order statuses unchanged
 * 2. Sticky unpaid: pending_payment never elevates to on_hold
 * 3. N = statuses excluding cancelled; all N on_hold → order on_hold
 * 4. P = N excluding on_hold; ship/deliver/processing ladder on P only
 */
export function deriveOrderStatusFromFulfillment(
  currentOrderStatus: OrderStatus,
  fulfillmentStatuses: FulfillmentStatus[],
): OrderStatus {
  if (TERMINAL_ORDER_STATUSES.has(currentOrderStatus)) {
    return currentOrderStatus;
  }
  // Sticky unpaid: on_hold items do not change payment obligation header (Decision #15).
  if (currentOrderStatus === OrderStatus.PENDING_PAYMENT) {
    return OrderStatus.PENDING_PAYMENT;
  }

  const nonTerminalStatuses = fulfillmentStatuses.filter(
    (status) => status !== FulfillmentStatus.CANCELLED,
  );
  if (nonTerminalStatuses.length === 0) {
    return OrderStatus.PAID;
  }

  if (nonTerminalStatuses.every((status) => status === FulfillmentStatus.ON_HOLD)) {
    return OrderStatus.ON_HOLD;
  }

  // Progressing peers only — held items must not invent or block ship/deliver aggregates.
  const progressingStatuses = nonTerminalStatuses.filter(
    (status) => status !== FulfillmentStatus.ON_HOLD,
  );
  if (progressingStatuses.length === 0) {
    return OrderStatus.PAID;
  }

  if (progressingStatuses.every((status) => status === FulfillmentStatus.DELIVERED)) {
    return OrderStatus.DELIVERED;
  }
  if (
    progressingStatuses.every(
      (status) => status === FulfillmentStatus.SHIPPED || status === FulfillmentStatus.DELIVERED,
    )
  ) {
    return OrderStatus.SHIPPED;
  }
  if (
    progressingStatuses.some(
      (status) =>
        status === FulfillmentStatus.PROCESSING ||
        status === FulfillmentStatus.SHIPPED ||
        status === FulfillmentStatus.DELIVERED,
    )
  ) {
    return OrderStatus.PROCESSING;
  }

  return OrderStatus.PAID;
}

export function assertVendorItemsUniform(
  fulfillmentStatuses: FulfillmentStatus[],
  expected: FulfillmentStatus,
): void {
  if (fulfillmentStatuses.length === 0) {
    throw new BadRequestException({
      code: 'NO_STORE_ITEMS',
      message: 'No items found for this store in the order',
    });
  }
  if (!fulfillmentStatuses.every((status) => status === expected)) {
    throw new BadRequestException({
      code: 'INVALID_FULFILLMENT_STATE',
      message: `Store items must all be in ${expected} status for this action`,
    });
  }
}
