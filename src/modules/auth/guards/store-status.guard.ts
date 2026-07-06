import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, StoreStatus } from '../../../database/entities/store.entity';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';
import { ALLOW_SUSPENDED_STORE_KEY } from '../../../common/decorators';

// Blocks any vendor request scoped to a suspended store. Runs globally after
// JwtAuthGuard has populated the request user. Account-level and store-switch
// routes opt out via @AllowSuspendedStore().
@Injectable()
export class StoreStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_STORE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowSuspended) {
      return true;
    }

    const { user } = getRequestFromContext(context);
    if (!user || user.role !== 'vendor') {
      return true;
    }

    const storeId = user.storeId as string | undefined;
    if (!storeId) {
      return true;
    }

    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'status'],
    });

    if (store && store.status === StoreStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'STORE_SUSPENDED',
        message: 'This store has been suspended. Please contact support to restore access.',
      });
    }

    return true;
  }
}
