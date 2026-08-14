import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderAuditLog } from '../../database/entities/order-audit-log.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { StoresService } from '../stores/stores.service';
import {
  OrderAuditActorType,
  OrderAuditEventType,
  VENDOR_ADMIN_ACTOR_LABEL,
} from './order-audit-log.constants';
import { OrderAuditLogsService } from './order-audit-logs.service';

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';
const STORE_A = '33333333-3333-4333-8333-333333333333';
const STORE_B = '44444444-4444-4444-8444-444444444444';

describe('OrderAuditLogsService', () => {
  let service: OrderAuditLogsService;
  const auditRepo = {
    find: jest.fn(),
  };
  const orderItemRepo = {
    count: jest.fn(),
  };
  const storesService = {
    assertStoreAccess: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storesService.assertStoreAccess.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderAuditLogsService,
        { provide: getRepositoryToken(OrderAuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: StoresService, useValue: storesService },
      ],
    }).compile();

    service = module.get(OrderAuditLogsService);
  });

  describe('append', () => {
    it('persists an entry through the given manager', async () => {
      const manager = {
        create: jest.fn((_entity: unknown, data: unknown) => data),
        save: jest.fn((_entity: unknown, data: unknown) => Promise.resolve(data)),
      };

      await service.append(manager as never, {
        orderId: ORDER_A,
        eventType: OrderAuditEventType.ORDER_PLACED,
        actorType: OrderAuditActorType.customer,
        actorId: 'cust-1',
        actorLabel: 'Somchai',
        details: { paymentMethod: 'bank_transfer' },
      });

      expect(manager.create).toHaveBeenCalledWith(
        OrderAuditLog,
        expect.objectContaining({
          orderId: ORDER_A,
          eventType: OrderAuditEventType.ORDER_PLACED,
          storeId: null,
        }),
      );
      expect(manager.save).toHaveBeenCalledWith(OrderAuditLog, expect.any(Object));
    });

    it('rejects unknown event types', async () => {
      await expect(
        service.append({} as never, {
          orderId: ORDER_A,
          eventType: 'NOT_A_REAL_EVENT' as OrderAuditEventType,
          actorType: OrderAuditActorType.customer,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires storeId for ORDER_ACCEPTED', async () => {
      await expect(
        service.append({} as never, {
          orderId: ORDER_A,
          eventType: OrderAuditEventType.ORDER_ACCEPTED,
          actorType: OrderAuditActorType.vendor,
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_AUDIT_EVENT' } });
    });
  });

  describe('listForVendor', () => {
    it('returns only the requested order, oldest-first, redacting admin identity', async () => {
      orderItemRepo.count.mockResolvedValue(1);
      auditRepo.find.mockResolvedValue([
        {
          id: 'e1',
          orderId: ORDER_A,
          eventType: OrderAuditEventType.ORDER_PLACED,
          occurredAt: new Date('2026-08-14T08:00:00.000Z'),
          actorType: OrderAuditActorType.customer,
          actorId: 'cust-1',
          actorLabel: 'Somchai',
          storeId: null,
          details: { paymentMethod: 'bank_transfer' },
        },
        {
          id: 'e2',
          orderId: ORDER_A,
          eventType: OrderAuditEventType.PAYMENT_APPROVED,
          occurredAt: new Date('2026-08-14T09:00:00.000Z'),
          actorType: OrderAuditActorType.admin,
          actorId: 'admin-secret',
          actorLabel: 'admin@sopet.org',
          storeId: null,
          details: { approvalMethod: 'manual_bank_transfer', note: 'matched' },
        },
        {
          id: 'e3',
          orderId: ORDER_A,
          eventType: OrderAuditEventType.ORDER_ACCEPTED,
          occurredAt: new Date('2026-08-14T09:30:00.000Z'),
          actorType: OrderAuditActorType.vendor,
          actorId: 'vendor-1',
          actorLabel: 'Store A',
          storeId: STORE_A,
          details: { storeId: STORE_A },
        },
        {
          id: 'e4',
          orderId: ORDER_A,
          eventType: OrderAuditEventType.ORDER_ACCEPTED,
          occurredAt: new Date('2026-08-14T09:31:00.000Z'),
          actorType: OrderAuditActorType.vendor,
          actorId: 'vendor-2',
          actorLabel: 'Store B',
          storeId: STORE_B,
          details: { storeId: STORE_B },
        },
      ]);

      const result = await service.listForVendor('user-1', STORE_A, ORDER_A);

      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { orderId: ORDER_A },
        order: { occurredAt: 'ASC', id: 'ASC' },
      });
      expect(result.orderId).toBe(ORDER_A);
      expect(result.entries.map((entry) => entry.id)).toEqual(['e1', 'e2', 'e3']);
      expect(result.entries[1]?.actorId).toBeNull();
      expect(result.entries[1]?.actorLabel).toBe(VENDOR_ADMIN_ACTOR_LABEL);
      expect(result.entries[1]?.details.note).toBeNull();
      expect(result.entries.some((entry) => entry.id === 'e4')).toBe(false);
    });

    it('returns ORDER_NOT_FOUND when the store has no items on the order', async () => {
      orderItemRepo.count.mockResolvedValue(0);

      await expect(service.listForVendor('user-1', STORE_A, ORDER_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(auditRepo.find).not.toHaveBeenCalled();
    });

    it('returns ORDER_NOT_FOUND for non-uuid ids', async () => {
      await expect(service.listForVendor('user-1', 'store-1', 'order-1')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_FOUND' },
      });
    });
  });
});
