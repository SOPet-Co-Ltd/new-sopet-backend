import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute, DisputeIssueType, DisputeStatus } from '../../database/entities/dispute.entity';
import { Order } from '../../database/entities/order.entity';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async create(input: {
    customerId: string;
    orderId: string;
    reason: string;
    issueType: DisputeIssueType;
  }): Promise<Dispute> {
    const order = await this.orderRepository.findOne({
      where: { id: input.orderId, customerId: input.customerId },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    const dispute = this.disputeRepository.create({
      orderId: input.orderId,
      customerId: input.customerId,
      reason: input.reason,
      issueType: input.issueType,
      status: DisputeStatus.OPEN,
    });
    return this.disputeRepository.save(dispute);
  }

  async findByCustomer(customerId: string): Promise<Dispute[]> {
    return this.disputeRepository.find({
      where: { customerId },
      relations: { messages: true, images: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOpen(): Promise<Dispute[]> {
    return this.disputeRepository.find({
      where: { status: DisputeStatus.OPEN },
      relations: { messages: true, images: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Dispute | null> {
    return this.disputeRepository.findOne({
      where: { id },
      relations: { messages: true, images: true },
    });
  }
}
