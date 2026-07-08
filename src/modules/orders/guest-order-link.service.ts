import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';

@Injectable()
export class GuestOrderLinkService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
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

    return result.affected ?? 0;
  }
}
