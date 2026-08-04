import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../database/entities/user.entity';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';

// Blocks any vendor request when the account is suspended (isActive=false).
// Runs globally after JwtAuthGuard has populated the request user. Unlike
// StoreStatusGuard, there is no allowlist — a suspended vendor cannot act
// until the account is reactivated.
@Injectable()
export class VendorStatusGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = getRequestFromContext(context);
    if (!user || user.role !== 'vendor') {
      return true;
    }

    const account = await this.userRepository.findOne({
      where: { id: user.id as string },
      select: ['id', 'isActive'],
    });

    if (account && !account.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact support for assistance.',
      });
    }

    return true;
  }
}
