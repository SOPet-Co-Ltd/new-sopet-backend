import { BadRequestException } from '@nestjs/common';
import {
  BankTransferSettingsService,
  type BankTransferSettingsValue,
} from './bank-transfer-settings.service';

describe('BankTransferSettingsService', () => {
  function buildService(row: { value: unknown } | null = null) {
    const settingsRepository = {
      findOne: jest.fn().mockResolvedValue(row),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    const redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const service = new BankTransferSettingsService(
      settingsRepository as never,
      redisService as never,
    );

    return { service, settingsRepository, redisService };
  }

  it('returns empty fields when settings row is missing', async () => {
    const { service } = buildService(null);
    await expect(service.get()).resolves.toEqual({
      enabled: false,
      bankName: '',
      accountName: '',
      accountNumber: '',
      branchName: null,
    });
    await expect(service.isAvailableNow()).resolves.toBe(false);
  });

  it('getConfigured rejects incomplete settings', async () => {
    const { service } = buildService({
      value: { enabled: true, bankName: 'KBANK', accountName: '', accountNumber: '1' },
    });
    await expect(service.getConfigured()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides when enabled is false even with complete account details', async () => {
    const { service } = buildService({
      value: {
        enabled: false,
        bankName: 'KBANK',
        accountName: 'SOPET',
        accountNumber: '123',
      },
    });
    await expect(service.isAvailableNow()).resolves.toBe(false);
    await expect(service.getConfigured()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update persists required fields', async () => {
    const { service, settingsRepository } = buildService(null);
    const result = await service.update({
      enabled: true,
      bankName: ' กสิกรไทย ',
      accountName: 'SOPET',
      accountNumber: '123',
      branchName: ' ',
    });

    expect(result).toEqual({
      enabled: true,
      bankName: 'กสิกรไทย',
      accountName: 'SOPET',
      accountNumber: '123',
      branchName: null,
    });
    expect(settingsRepository.save).toHaveBeenCalled();
  });
});

describe('BankTransferSettingsValue typing', () => {
  it('accepts configured shape', () => {
    const value: BankTransferSettingsValue = {
      enabled: true,
      bankName: 'KBANK',
      accountName: 'SOPET',
      accountNumber: '123',
      branchName: null,
    };
    expect(value.bankName).toBe('KBANK');
  });
});
