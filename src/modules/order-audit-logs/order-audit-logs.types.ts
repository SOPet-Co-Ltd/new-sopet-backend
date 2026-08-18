import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { OrderAuditActorType, OrderAuditEventType } from './order-audit-log.constants';

registerEnumType(OrderAuditEventType, {
  name: 'OrderAuditEventType',
});

registerEnumType(OrderAuditActorType, {
  name: 'OrderAuditActorType',
});

@ObjectType()
export class OrderAuditLogDetailsType {
  @Field(() => String, { nullable: true })
  paymentMethod?: string | null;

  @Field(() => String, { nullable: true })
  previousPaymentMethod?: string | null;

  @Field(() => String, { nullable: true })
  newPaymentMethod?: string | null;

  @Field(() => String, { nullable: true })
  approvalMethod?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => String, { nullable: true })
  storeId?: string | null;
}

@ObjectType()
export class OrderAuditLogEntryType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orderId!: string;

  @Field(() => OrderAuditEventType)
  eventType!: OrderAuditEventType;

  @Field()
  occurredAt!: Date;

  @Field(() => OrderAuditActorType)
  actorType!: OrderAuditActorType;

  @Field(() => String, { nullable: true })
  actorId?: string | null;

  @Field(() => String, { nullable: true })
  actorLabel?: string | null;

  @Field(() => String, { nullable: true })
  storeId?: string | null;

  @Field(() => OrderAuditLogDetailsType)
  details!: OrderAuditLogDetailsType;
}

@ObjectType()
export class OrderAuditLogType {
  @Field(() => ID)
  orderId!: string;

  @Field(() => [OrderAuditLogEntryType])
  entries!: OrderAuditLogEntryType[];
}
