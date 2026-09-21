import { BadRequestException } from '@nestjs/common';
import { StorefrontMaintenanceSettingsService } from './storefront-maintenance-settings.service';

describe('StorefrontMaintenanceSettingsService', () => {
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

    const service = new StorefrontMaintenanceSettingsService(
      settingsRepository as never,
      redisService as never,
    );

    return { service, settingsRepository, redisService };
  }

  const empty = {
    enabled: false,
    reason: null,
    customMessage: null,
    untilAt: null,
  };

  it('returns defaults when settings row is missing', async () => {
    const { service } = buildService(null);
    await expect(service.get()).resolves.toEqual(empty);
  });

  it('returns enabled maintenance with reason fields', async () => {
    const { service } = buildService({
      value: {
        enabled: true,
        reason: 'MAINTENANCE',
        customMessage: null,
        untilAt: '2099-01-01T00:00:00.000Z',
      },
    });
    await expect(service.get()).resolves.toEqual({
      enabled: true,
      reason: 'MAINTENANCE',
      customMessage: null,
      untilAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it('auto-reopens when untilAt is in the past', async () => {
    const { service, settingsRepository, redisService } = buildService({
      value: {
        enabled: true,
        reason: 'SYSTEM_UPDATE',
        customMessage: null,
        untilAt: '2020-01-01T00:00:00.000Z',
      },
    });

    await expect(service.get()).resolves.toEqual(empty);
    expect(settingsRepository.save).toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalledWith(
      'platform:storefront_maintenance',
      JSON.stringify(empty),
      60,
    );
  });

  it('update requires reason when enabling', async () => {
    const { service } = buildService(null);
    await expect(service.update({ enabled: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update requires customMessage when reason is OTHER', async () => {
    const { service } = buildService(null);
    await expect(
      service.update({ enabled: true, reason: 'OTHER', customMessage: '  ' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STOREFRONT_MAINTENANCE_CUSTOM_MESSAGE_REQUIRED',
      }),
    });
  });

  it('update rejects past untilAt', async () => {
    const { service } = buildService(null);
    await expect(
      service.update({
        enabled: true,
        reason: 'MAINTENANCE',
        untilAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STOREFRONT_MAINTENANCE_UNTIL_NOT_FUTURE',
      }),
    });
  });

  it('update persists enabled maintenance with optional untilAt', async () => {
    const { service, settingsRepository, redisService } = buildService(null);
    const untilAt = '2099-06-01T12:00:00.000Z';
    const result = await service.update({
      enabled: true,
      reason: 'NOT_READY',
      untilAt,
    });

    expect(result).toEqual({
      enabled: true,
      reason: 'NOT_READY',
      customMessage: null,
      untilAt,
    });
    expect(settingsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'platform.storefront_maintenance',
        value: result,
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'platform:storefront_maintenance',
      JSON.stringify(result),
      60,
    );
  });

  it('update with OTHER stores customMessage', async () => {
    const { service } = buildService(null);
    await expect(
      service.update({
        enabled: true,
        reason: 'OTHER',
        customMessage: ' กำลังย้ายเซิร์ฟเวอร์ ',
      }),
    ).resolves.toEqual({
      enabled: true,
      reason: 'OTHER',
      customMessage: 'กำลังย้ายเซิร์ฟเวอร์',
      untilAt: null,
    });
  });

  it('update disables and clears fields', async () => {
    const { service } = buildService({
      value: { enabled: true, reason: 'MAINTENANCE', customMessage: null, untilAt: null },
    });
    await expect(service.update({ enabled: false })).resolves.toEqual(empty);
  });
});
