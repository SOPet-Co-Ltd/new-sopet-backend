import { Test, TestingModule } from '@nestjs/testing';
import { OrderAuditLogsResolver } from './order-audit-logs.resolver';
import { OrderAuditLogsService } from './order-audit-logs.service';
import { OrderAuditActorType, OrderAuditEventType } from './order-audit-log.constants';

describe('OrderAuditLogsResolver', () => {
  let resolver: OrderAuditLogsResolver;
  const orderAuditLogsService = {
    listForVendor: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderAuditLogsResolver,
        { provide: OrderAuditLogsService, useValue: orderAuditLogsService },
      ],
    }).compile();
    resolver = module.get(OrderAuditLogsResolver);
  });

  it('returns the vendor-scoped log for an order', async () => {
    orderAuditLogsService.listForVendor.mockResolvedValue({
      orderId: '11111111-1111-4111-8111-111111111111',
      entries: [
        {
          id: 'e1',
          orderId: '11111111-1111-4111-8111-111111111111',
          eventType: OrderAuditEventType.ORDER_PLACED,
          occurredAt: new Date('2026-08-14T08:00:00.000Z'),
          actorType: OrderAuditActorType.customer,
          actorId: 'cust-1',
          actorLabel: 'Somchai',
          storeId: null,
          details: { paymentMethod: 'bank_transfer' },
        },
      ],
    });

    const result = await resolver.orderAuditLog(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(orderAuditLogsService.listForVendor).toHaveBeenCalledWith(
      'user-1',
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].eventType).toBe(OrderAuditEventType.ORDER_PLACED);
  });
});
