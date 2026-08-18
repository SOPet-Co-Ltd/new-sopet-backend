import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('UpdateStoreAsAdminInput commissionRate validation', () => {
  const validationPipe = new ValidationPipe();
  const storeId = '22222222-2222-4222-8222-222222222222';

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: UpdateStoreAsAdminInput,
      type: 'body',
    } as never);

  it('accepts integer 0 and keeps 0', async () => {
    await expect(validate({ id: storeId, commissionRate: 0 })).resolves.toMatchObject({
      commissionRate: 0,
    });
  });

  it('accepts integer 5 and 100', async () => {
    await expect(validate({ id: storeId, commissionRate: 5 })).resolves.toMatchObject({
      commissionRate: 5,
    });
    await expect(validate({ id: storeId, commissionRate: 100 })).resolves.toMatchObject({
      commissionRate: 100,
    });
  });

  it('accepts omitted commissionRate', async () => {
    await expect(validate({ id: storeId, name: 'Pet Shop' })).resolves.not.toHaveProperty(
      'commissionRate',
    );
  });

  it('rejects 101', async () => {
    await expect(validate({ id: storeId, commissionRate: 101 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects -1', async () => {
    await expect(validate({ id: storeId, commissionRate: -1 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects fractional 7.5', async () => {
    await expect(validate({ id: storeId, commissionRate: 7.5 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-integer string', async () => {
    await expect(validate({ id: storeId, commissionRate: 'abc' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty string', async () => {
    await expect(validate({ id: storeId, commissionRate: '' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('vendor and create store inputs stay rate-free', () => {
  it('does not declare commissionRate on vendor or create inputs', () => {
    const vendorInputs = readFileSync(join(__dirname, 'store-team.inputs.ts'), 'utf8');
    const createInput = readFileSync(join(__dirname, 'stores.inputs.ts'), 'utf8');
    const createClass = createInput.match(
      /export class CreateStoreAsAdminInput \{[\s\S]*?\n\}/,
    )?.[0];
    expect(vendorInputs).not.toMatch(/commissionRate/);
    expect(createClass).toBeDefined();
    expect(createClass).not.toMatch(/commissionRate/);
    expect(new CreateStoreAsAdminInput()).not.toHaveProperty('commissionRate');
  });
});

describe('commissionRate GraphQL contract', () => {
  const schema = readFileSync(join(process.cwd(), 'src/schema.gql'), 'utf8');

  const block = (kind: 'type' | 'input', name: string): string => {
    const match = schema.match(new RegExp(`${kind} ${name} \\{([^}]+)\\}`));
    if (!match) {
      throw new Error(`missing ${kind} ${name} in schema.gql`);
    }
    return match[1];
  };

  it('exposes nullable Int on AdminStoreType and UpdateStoreAsAdminInput', () => {
    expect(block('type', 'AdminStoreType')).toMatch(/commissionRate:\s*Int\s*$/m);
    expect(block('input', 'UpdateStoreAsAdminInput')).toMatch(/commissionRate:\s*Int\s*$/m);
  });

  it('omits commissionRate from vendor, create, and MyStore types', () => {
    expect(block('input', 'UpdateStoreSettingsInput')).not.toMatch(/commissionRate/);
    expect(block('input', 'UpdateStorePayoutInput')).not.toMatch(/commissionRate/);
    expect(block('input', 'CreateStoreAsAdminInput')).not.toMatch(/commissionRate/);
    expect(block('type', 'MyStoreType')).not.toMatch(/commissionRate/);
  });

  it('does not add a platform default-rate GraphQL field or mutation', () => {
    expect(schema).not.toMatch(
      /defaultRatePercent|updatePlatformCommission|platformCommissionRate/,
    );
  });
});
