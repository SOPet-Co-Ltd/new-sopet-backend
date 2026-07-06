import { IsNull } from 'typeorm';
import { PlatformService } from './platform.service';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';

describe('PlatformService', () => {
  let service: PlatformService;
  let configService: { get: jest.Mock };
  let bannerManager: { update: jest.Mock };
  let sponsorManager: { update: jest.Mock };
  let adDeactivateQb: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };
  let bannerRepository: {
    find: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let sponsorRepository: {
    find: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let adRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };

  beforeEach(() => {
    configService = { get: jest.fn() };
    bannerManager = { update: jest.fn().mockResolvedValue(undefined) };
    sponsorManager = { update: jest.fn().mockResolvedValue(undefined) };
    adDeactivateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    bannerRepository = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => cb(bannerManager)),
      },
    };
    sponsorRepository = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => cb(sponsorManager)),
      },
    };
    adRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((ad) => Promise.resolve(ad)),
      createQueryBuilder: jest.fn().mockReturnValue(adDeactivateQb),
      manager: {
        transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) =>
          cb({ update: jest.fn() }),
        ),
      },
    };

    service = new PlatformService(
      configService as never,
      bannerRepository as never,
      sponsorRepository as never,
      adRepository as never,
    );
  });

  it('orders all banners deterministically by sortOrder then createdAt then id', async () => {
    await service.getAllBanners();

    expect(bannerRepository.find).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('orders all sponsors deterministically by sortOrder then createdAt then id', async () => {
    await service.getAllSponsors();

    expect(sponsorRepository.find).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('reorders banners by assigning sequential sortOrder from array index', async () => {
    const reordered = [{ id: 'b2' }, { id: 'b1' }] as PlatformBanner[];
    bannerRepository.find.mockResolvedValue(reordered);

    const result = await service.reorderBanners(['b2', 'b1']);

    expect(bannerRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(bannerManager.update).toHaveBeenNthCalledWith(
      1,
      PlatformBanner,
      { id: 'b2', deletedAt: IsNull() },
      { sortOrder: 0 },
    );
    expect(bannerManager.update).toHaveBeenNthCalledWith(
      2,
      PlatformBanner,
      { id: 'b1', deletedAt: IsNull() },
      { sortOrder: 1 },
    );
    expect(result).toBe(reordered);
  });

  it('reorders sponsors by assigning sequential sortOrder from array index', async () => {
    const reordered = [{ id: 's3' }, { id: 's1' }] as PlatformSponsor[];
    sponsorRepository.find.mockResolvedValue(reordered);

    const result = await service.reorderSponsors(['s3', 's1']);

    expect(sponsorRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(sponsorManager.update).toHaveBeenNthCalledWith(
      1,
      PlatformSponsor,
      { id: 's3', deletedAt: IsNull() },
      { sortOrder: 0 },
    );
    expect(sponsorManager.update).toHaveBeenNthCalledWith(
      2,
      PlatformSponsor,
      { id: 's1', deletedAt: IsNull() },
      { sortOrder: 1 },
    );
    expect(result).toBe(reordered);
  });

  it('orders all ads by updatedAt then id descending', async () => {
    await service.getAllAds();

    expect(adRepository.find).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  });

  it('deactivates other ads when creating an active ad', async () => {
    const input = { title: 'New ad', imageUrl: 'https://example.com/ad.png', isActive: true };

    await service.createAd(input);

    expect(adDeactivateQb.update).toHaveBeenCalledWith(PlatformAd);
    expect(adDeactivateQb.set).toHaveBeenCalledWith({ isActive: false });
    expect(adDeactivateQb.where).toHaveBeenCalledWith('is_active = true');
    expect(adDeactivateQb.andWhere).toHaveBeenCalledWith('deleted_at IS NULL');
    expect(adDeactivateQb.execute).toHaveBeenCalled();
    expect(adRepository.create).toHaveBeenCalledWith(input);
    expect(adRepository.save).toHaveBeenCalled();
  });

  it('does not deactivate other ads when creating an inactive ad', async () => {
    const input = {
      title: 'Draft ad',
      imageUrl: 'https://example.com/ad.png',
      isActive: false,
    };

    await service.createAd(input);

    expect(adRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(adRepository.save).toHaveBeenCalled();
  });

  it('deactivates other ads when updating an ad to active', async () => {
    const existing = {
      id: 'a1',
      title: 'Ad',
      imageUrl: 'https://example.com/ad.png',
      isActive: false,
    } as PlatformAd;
    adRepository.findOne.mockResolvedValue(existing);

    await service.updateAd('a1', { isActive: true });

    expect(adDeactivateQb.andWhere).toHaveBeenCalledWith('id != :excludeId', { excludeId: 'a1' });
    expect(adRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', isActive: true }),
    );
  });

  it('ignores sortOrder on ad create and update inputs', async () => {
    adRepository.findOne.mockResolvedValue({
      id: 'a1',
      title: 'Ad',
      imageUrl: 'https://example.com/ad.png',
      isActive: false,
    });

    await service.createAd({
      title: 'Ad',
      imageUrl: 'https://example.com/ad.png',
      sortOrder: 99,
      isActive: false,
    });
    await service.updateAd('a1', { sortOrder: 42, isActive: false });

    expect(adRepository.create).toHaveBeenCalledWith({
      title: 'Ad',
      imageUrl: 'https://example.com/ad.png',
      isActive: false,
    });
    expect(adRepository.save).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ sortOrder: 42 }),
    );
  });
});
