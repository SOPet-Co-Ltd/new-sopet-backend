import 'reflect-metadata';

// store-team.inputs.ts imports StoreMemberRole from store-member.entity, which is part of a
// circular entity-import chain (store -> user -> store-member -> store-member-invitation).
// Mock it (matching store-team.service.spec.ts's convention) so this file can be the sole
// entry point without tripping over decorator evaluation order in that cycle.
jest.mock('../../database/entities/store-member.entity', () => ({
  StoreMemberRole: { OWNER: 'owner', MANAGER: 'manager', STAFF: 'staff' },
  StoreMember: class StoreMember {},
}));

import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import { AcceptStoreMemberInvitationInput, UpdateStoreSettingsInput } from './store-team.inputs';

describe('AcceptStoreMemberInvitationInput fullName validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: AcceptStoreMemberInvitationInput,
      type: 'body',
    } as never);

  it('rejects a whitespace-only fullName', async () => {
    await expect(
      validate({
        token: 'tok-1',
        password: 'password123',
        fullName: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a fullName with real content', async () => {
    const result = await validate({
      token: 'tok-1',
      password: 'password123',
      fullName: 'New Team Member',
    });
    expect(result).toBeDefined();
  });
});

describe('UpdateStoreSettingsInput contactPhone validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: UpdateStoreSettingsInput,
      type: 'body',
    } as never);

  it('rejects an email typed into contactPhone instead of a phone number', async () => {
    await expect(validate({ contactPhone: 'user@example.com' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a valid Thai phone number', async () => {
    const result = await validate({ contactPhone: '0812345678' });
    expect(result).toBeDefined();
  });
});
