import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { MustChangePasswordGuard } from './must-change-password.guard';
import { UserRole } from '../../../database/entities/user.entity';

describe('MustChangePasswordGuard', () => {
  const findOne = jest.fn();
  const guard = new MustChangePasswordGuard({
    findOne,
  } as never);

  let parentType = 'Mutation';
  let fieldName = 'updateSomething';
  let requestUser: { id: string; role: string } | undefined = {
    id: 'admin-1',
    role: UserRole.ADMIN,
  };

  function buildContext(): ExecutionContext {
    return {
      getType: () => 'graphql',
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    parentType = 'Mutation';
    fieldName = 'updateSomething';
    requestUser = { id: 'admin-1', role: UserRole.ADMIN };

    jest.spyOn(GqlExecutionContext, 'create').mockImplementation(
      () =>
        ({
          getInfo: () => ({
            parentType: { name: parentType },
            fieldName,
          }),
          getContext: () => ({
            req: { user: requestUser },
          }),
        }) as unknown as GqlExecutionContext,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows non-admin users without DB lookup', async () => {
    requestUser = { id: 'v1', role: UserRole.VENDOR };

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('allows admin when mustChangePassword is false', async () => {
    findOne.mockResolvedValue({ id: 'admin-1', mustChangePassword: false });

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('allows Query when mustChangePassword is true', async () => {
    findOne.mockResolvedValue({ id: 'admin-1', mustChangePassword: true });
    parentType = 'Query';
    fieldName = 'me';

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('allows changePassword when mustChangePassword is true', async () => {
    findOne.mockResolvedValue({ id: 'admin-1', mustChangePassword: true });
    fieldName = 'changePassword';

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('blocks other mutations when mustChangePassword is true', async () => {
    findOne.mockResolvedValue({ id: 'admin-1', mustChangePassword: true });

    await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(buildContext())).rejects.toMatchObject({
      response: { code: 'MUST_CHANGE_PASSWORD' },
    });
  });
});
