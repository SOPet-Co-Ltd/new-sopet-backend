import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { Dispute, DisputeIssueType, DisputeStatus } from '../../database/entities/dispute.entity';
import { Order } from '../../database/entities/order.entity';

describe('DisputesService', () => {
  let service: DisputesService;

  const disputeRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'dispute-1', ...x })),
    find: jest.fn(),
  };

  const orderRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: getRepositoryToken(Dispute), useValue: disputeRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
      ],
    }).compile();

    service = module.get(DisputesService);
  });

  describe('create', () => {
    it('throws NotFoundException when order not found for customer', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          customerId: 'cust-1',
          orderId: 'order-missing',
          reason: 'Item not received',
          issueType: DisputeIssueType.NOT_RECEIVED,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(disputeRepo.save).not.toHaveBeenCalled();
    });

    it('saves dispute when order exists', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'order-1', customerId: 'cust-1' });

      const result = await service.create({
        customerId: 'cust-1',
        orderId: 'order-1',
        reason: 'Damaged item',
        issueType: DisputeIssueType.DAMAGED,
      });

      expect(disputeRepo.create).toHaveBeenCalledWith({
        orderId: 'order-1',
        customerId: 'cust-1',
        reason: 'Damaged item',
        issueType: DisputeIssueType.DAMAGED,
        status: DisputeStatus.OPEN,
      });
      expect(disputeRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('dispute-1');
      expect(result.status).toBe(DisputeStatus.OPEN);
    });
  });

  describe('findByCustomer', () => {
    it('returns disputes', async () => {
      const disputes = [{ id: 'dispute-1' }, { id: 'dispute-2' }];
      disputeRepo.find.mockResolvedValue(disputes);

      const result = await service.findByCustomer('cust-1');

      expect(disputeRepo.find).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        relations: { messages: true, images: true },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(disputes);
    });
  });

  describe('findOpen', () => {
    it('returns open disputes', async () => {
      const disputes = [{ id: 'dispute-1', status: DisputeStatus.OPEN }];
      disputeRepo.find.mockResolvedValue(disputes);

      const result = await service.findOpen();

      expect(disputeRepo.find).toHaveBeenCalledWith({
        where: { status: DisputeStatus.OPEN },
        relations: { messages: true, images: true },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(disputes);
    });
  });
});
