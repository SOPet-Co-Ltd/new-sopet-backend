import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Repository } from 'typeorm';
import { User, UserRole } from '../../../database/entities/user.entity';
import { getRequestFromContext } from '../../../common/utils/execution-context.util';

const ALLOWED_QUERIES = new Set(['me']);
const ALLOWED_MUTATIONS = new Set(['changePassword', 'refreshToken']);

/**
 * While `mustChangePassword` is true, admins may only call session bootstrap ops
 * (`me`, `changePassword`, `refreshToken`) — not other Queries or Mutations.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = getRequestFromContext(context);
    if (!user || user.role !== UserRole.ADMIN) {
      return true;
    }

    const account = await this.userRepository.findOne({
      where: { id: user.id as string },
      select: ['id', 'mustChangePassword'],
    });

    if (!account?.mustChangePassword) {
      return true;
    }

    if (context.getType<string>() !== 'graphql') {
      throw new ForbiddenException({
        code: 'MUST_CHANGE_PASSWORD',
        message: 'Password change required before continuing',
      });
    }

    const gqlCtx = GqlExecutionContext.create(context);
    const info = gqlCtx.getInfo<{ parentType?: { name?: string }; fieldName?: string }>();
    const parentType = info.parentType?.name;
    const fieldName = info.fieldName;

    if (parentType === 'Query' && fieldName && ALLOWED_QUERIES.has(fieldName)) {
      return true;
    }

    if (parentType === 'Mutation' && fieldName && ALLOWED_MUTATIONS.has(fieldName)) {
      return true;
    }

    throw new ForbiddenException({
      code: 'MUST_CHANGE_PASSWORD',
      message: 'Password change required before continuing',
    });
  }
}
