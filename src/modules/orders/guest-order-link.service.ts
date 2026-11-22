import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';

@Injectable()
export class GuestOrderLinkService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly customerRepository: CustomerRepository,
  ) {}

  async mergeGuestOrders(customerId: string, phone: string): Promise<number> {
    const lookupValues = guestPhoneLookupValues(normalizeThaiPhoneToLocal(phone));
    if (lookupValues.length === 0) {
      return 0;
    }

    const result = await this.orderRepository.update(
      {
        customerId: IsNull(),
        guestPhone: In(lookupValues),
      },
      { customerId },
    );

    await this.backfillCustomerEmailFromOrders(customerId);

    return result.affected ?? 0;
  }

  /**
   * When OTP creates or links an account, copy the newest checkout email onto
   * the customer only if the account still has no email.
   */
  private async backfillCustomerEmailFromOrders(customerId: string): Promise<void> {
    const latestWithEmail = await this.orderRepository.findOne({
      where: {
        customerId,
        guestEmail: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
    });

    const guestEmail = latestWithEmail?.guestEmail?.trim();
    if (!guestEmail) {
      return;
    }

    await this.customerRepository.setEmailIfMissing(customerId, guestEmail);
  }
}
