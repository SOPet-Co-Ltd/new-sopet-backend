import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import { RegisterStoreInput } from './register-store.input';

describe('RegisterStoreInput contactPhone validation', () => {
  const validationPipe = new ValidationPipe();

  const baseInput = {
    name: 'My Shop',
    ownerEmail: 'owner@example.com',
    ownerPassword: 'password123',
    ownerFullName: 'Shop Owner',
  };

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: RegisterStoreInput,
      type: 'body',
    } as never);

  it('rejects an email typed into contactPhone instead of a phone number', async () => {
    await expect(validate({ ...baseInput, contactPhone: 'user@example.com' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a valid Thai phone number', async () => {
    const result = await validate({ ...baseInput, contactPhone: '0812345678' });
    expect(result).toBeDefined();
  });
});
