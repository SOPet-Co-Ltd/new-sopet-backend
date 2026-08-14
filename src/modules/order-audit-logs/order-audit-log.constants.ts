export enum OrderAuditEventType {
  ORDER_PLACED = 'ORDER_PLACED',
  PAYMENT_METHOD_CHANGED = 'PAYMENT_METHOD_CHANGED',
  PAYMENT_APPROVED = 'PAYMENT_APPROVED',
  ORDER_ACCEPTED = 'ORDER_ACCEPTED',
}

export enum OrderAuditActorType {
  customer = 'customer',
  admin = 'admin',
  vendor = 'vendor',
  system = 'system',
}

export const ORDER_AUDIT_EVENT_TYPES = new Set<string>(Object.values(OrderAuditEventType));

export const VENDOR_ADMIN_ACTOR_LABEL = 'ผู้ดูแลระบบ SOPET';
export const MANUAL_BANK_TRANSFER_APPROVAL = 'manual_bank_transfer';
export const FALLBACK_CUSTOMER_ACTOR_LABEL = 'ลูกค้า';
export const FALLBACK_VENDOR_ACTOR_LABEL = 'ร้านค้า';

export interface OrderAuditLogDetails {
  paymentMethod?: string | null;
  previousPaymentMethod?: string | null;
  newPaymentMethod?: string | null;
  approvalMethod?: string | null;
  note?: string | null;
  storeId?: string | null;
}

export interface AppendOrderAuditInput {
  orderId: string;
  eventType: OrderAuditEventType;
  actorType: OrderAuditActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  storeId?: string | null;
  details?: OrderAuditLogDetails;
  occurredAt?: Date;
}
