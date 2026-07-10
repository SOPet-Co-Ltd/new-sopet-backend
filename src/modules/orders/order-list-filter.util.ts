import { registerEnumType } from '@nestjs/graphql';
import { SelectQueryBuilder } from 'typeorm';
import { Order } from '../../database/entities/order.entity';

export enum CustomerOrderListFilter {
  ALL = 'ALL',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

registerEnumType(CustomerOrderListFilter, {
  name: 'CustomerOrderListFilter',
});

const FILTER_STATUS_MAP: Record<CustomerOrderListFilter, string[] | null> = {
  [CustomerOrderListFilter.ALL]: null,
  [CustomerOrderListFilter.PENDING_PAYMENT]: ['pending_payment'],
  [CustomerOrderListFilter.IN_PROGRESS]: ['paid', 'processing', 'shipped'],
  [CustomerOrderListFilter.DELIVERED]: ['delivered'],
  [CustomerOrderListFilter.CANCELLED]: ['cancelled', 'refunded'],
};

export const DEFAULT_CUSTOMER_ORDERS_PAGE = 1;
export const DEFAULT_CUSTOMER_ORDERS_LIMIT = 10;
export const MAX_CUSTOMER_ORDERS_LIMIT = 50;

export function statusesForCustomerOrderListFilter(
  filter: CustomerOrderListFilter,
): string[] | null {
  return FILTER_STATUS_MAP[filter] ?? null;
}

export function applyCustomerOrderListFilter(
  query: SelectQueryBuilder<Order>,
  filter: CustomerOrderListFilter,
): void {
  const statuses = statusesForCustomerOrderListFilter(filter);
  if (statuses?.length) {
    query.andWhere('order.status IN (:...statuses)', { statuses });
  }
}

export function normalizeCustomerOrdersPage(page?: number): number {
  return Math.max(page ?? DEFAULT_CUSTOMER_ORDERS_PAGE, 1);
}

export function normalizeCustomerOrdersLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_CUSTOMER_ORDERS_LIMIT, 1), MAX_CUSTOMER_ORDERS_LIMIT);
}
