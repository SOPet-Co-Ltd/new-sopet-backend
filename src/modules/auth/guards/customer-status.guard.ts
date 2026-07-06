import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../../database/entities/customer.entity';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';
import { isAdminSuspended, isPendingDeletion } from '../../customers/customer-deletion.util';

// Blocks any customer request when the account is suspended. Runs globally after
// JwtAuthGuard has populated the request user.
@Injectable()
export class CustomerStatusGuard implements CanActivate {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = getRequestFromContext(context);
    if (!user || user.role !== 'customer') {
      return true;
    }

    const customer = await this.customerRepository.findOne({
      where: { id: user.id as string },
      select: ['id', 'isActive', 'deletionRequestedAt'],
    });

    if (customer && !customer.isActive) {
      if (isPendingDeletion(customer)) {
        throw new ForbiddenException({
          code: 'CUSTOMER_PENDING_DELETION',
          message: 'Your account is pending deletion. Please reactivate your account to continue.',
        });
      }

      if (isAdminSuspended(customer)) {
        throw new ForbiddenException({
          code: 'CUSTOMER_SUSPENDED',
          message: 'Your account has been suspended. Please contact support for assistance.',
        });
      }
    }

    return true;
  }
}
