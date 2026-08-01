import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import {
  RegisterVendorInput,
  AcceptVendorInvitationInput,
  SubmitStoreRequestInput,
  CreateStoreAsAdminInput,
  UpdateStoreAsAdminInput,
} from './stores.inputs';

describe('RegisterVendorInput fullName validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, { metatype: RegisterVendorInput, type: 'body' } as never);

  it('rejects a whitespace-only fullName', async () => {
    await expect(
      validate({
        email: 'vendor@example.com',
        password: 'password123',
        fullName: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a fullName with real content', async () => {
    const result = await validate({
      email: 'vendor@example.com',
      password: 'password123',
      fullName: 'Vendor Name',
    });
    expect(result).toBeDefined();
  });
});

describe('AcceptVendorInvitationInput fullName validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: AcceptVendorInvitationInput,
      type: 'body',
    } as never);

  it('rejects a whitespace-only fullName', async () => {
    await expect(
      validate({
        token: 'tok-1',
        password: 'password123',
        fullName: '\t\n ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a fullName with real content', async () => {
    const result = await validate({
      token: 'tok-1',
      password: 'password123',
      fullName: 'New Vendor',
    });
    expect(result).toBeDefined();
  });
});

describe('SubmitStoreRequestInput contactPhone validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: SubmitStoreRequestInput,
      type: 'body',
    } as never);

  it('rejects an email typed into contactPhone instead of a phone number', async () => {
    await expect(
      validate({
        storeName: 'My Shop',
        contactPhone: 'user@example.com',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid Thai phone number', async () => {
    const result = await validate({
      storeName: 'My Shop',
      contactPhone: '0812345678',
    });
    expect(result).toBeDefined();
  });

  it('accepts a request with no contactPhone (optional field)', async () => {
    const result = await validate({ storeName: 'My Shop' });
    expect(result).toBeDefined();
  });
});

describe('CreateStoreAsAdminInput name validation (row 46 regression)', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: CreateStoreAsAdminInput,
      type: 'body',
    } as never);

  it('rejects a whitespace-only store name', async () => {
    await expect(
      validate({
        ownerUserId: '11111111-1111-4111-8111-111111111111',
        name: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a store name with real content', async () => {
    const result = await validate({
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      name: 'Pet Shop',
    });
    expect(result).toBeDefined();
  });

  it('rejects an email typed into contactPhone instead of a phone number', async () => {
    await expect(
      validate({
        ownerUserId: '11111111-1111-4111-8111-111111111111',
        name: 'Pet Shop',
        contactPhone: 'user@example.com',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateStoreAsAdminInput name validation (row 46 regression)', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: UpdateStoreAsAdminInput,
      type: 'body',
    } as never);

  it('rejects a whitespace-only store name', async () => {
    await expect(
      validate({
        id: '22222222-2222-4222-8222-222222222222',
        name: '\t\n ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a store name with real content', async () => {
    const result = await validate({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Pet Shop',
    });
    expect(result).toBeDefined();
  });
});
