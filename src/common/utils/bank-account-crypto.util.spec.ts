import { getMetadataArgsStorage } from 'typeorm';
import { Store } from '../../database/entities/store.entity';
import {
  decryptBankAccountNumber,
  encryptBankAccountNumber,
  maskBankAccountNumber,
} from './bank-account-crypto.util';

describe('bank-account-crypto', () => {
  const previous = process.env.BANK_DATA_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.BANK_DATA_ENCRYPTION_KEY = 'test-bank-encryption-key';
  });

  afterAll(() => {
    process.env.BANK_DATA_ENCRYPTION_KEY = previous;
  });

  it('round-trips encryption', () => {
    const encrypted = encryptBankAccountNumber('1234567890');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptBankAccountNumber(encrypted)).toBe('1234567890');
  });

  it('leaves plaintext unchanged when key missing', () => {
    const key = process.env.BANK_DATA_ENCRYPTION_KEY;
    delete process.env.BANK_DATA_ENCRYPTION_KEY;
    expect(encryptBankAccountNumber('1234567890')).toBe('1234567890');
    process.env.BANK_DATA_ENCRYPTION_KEY = key;
  });

  it('masks account numbers', () => {
    expect(maskBankAccountNumber('1234567890')).toBe('****7890');
  });

  it('ciphertext for max-length account fits Store.bankAccountNumber column', () => {
    // Frontend allows up to 15 digits; encrypted payload must fit the DB column.
    const encrypted = encryptBankAccountNumber('123456789012345');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted!.length).toBeGreaterThan(50);

    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === Store && c.propertyName === 'bankAccountNumber',
    );
    expect(column).toBeDefined();
    const length = (column!.options as { length?: number | string }).length;
    expect(Number(length)).toBeGreaterThanOrEqual(encrypted!.length);
  });
});
