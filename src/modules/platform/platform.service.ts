import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';

export interface PlatformSettings {
  storefrontUrl: string;
  currency: string;
  supportEmail: string;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(PlatformBanner)
    private readonly bannerRepository: Repository<PlatformBanner>,
    @InjectRepository(PlatformSponsor)
    private readonly sponsorRepository: Repository<PlatformSponsor>,
    @InjectRepository(PlatformAd)
    private readonly adRepository: Repository<PlatformAd>,
  ) {}

  async getActiveBanners(): Promise<PlatformBanner[]> {
    const now = new Date();
    return this.bannerRepository
      .createQueryBuilder('banner')
      .where('banner.is_active = true')
      .andWhere('banner.deleted_at IS NULL')
      .andWhere('(banner.starts_at IS NULL OR banner.starts_at <= :now)', { now })
      .andWhere('(banner.ends_at IS NULL OR banner.ends_at >= :now)', { now })
      .orderBy('banner.sort_order', 'ASC')
      .addOrderBy('banner.created_at', 'ASC')
      .addOrderBy('banner.id', 'ASC')
      .getMany();
  }

  async getAllBanners(): Promise<PlatformBanner[]> {
    return this.bannerRepository.find({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  async getActiveSponsors(): Promise<PlatformSponsor[]> {
    const now = new Date();
    return this.sponsorRepository
      .createQueryBuilder('sponsor')
      .where('sponsor.is_active = true')
      .andWhere('sponsor.deleted_at IS NULL')
      .andWhere('(sponsor.starts_at IS NULL OR sponsor.starts_at <= :now)', { now })
      .andWhere('(sponsor.ends_at IS NULL OR sponsor.ends_at >= :now)', { now })
      .orderBy('sponsor.sort_order', 'ASC')
      .addOrderBy('sponsor.created_at', 'ASC')
      .addOrderBy('sponsor.id', 'ASC')
      .getMany();
  }

  async getAllSponsors(): Promise<PlatformSponsor[]> {
    return this.sponsorRepository.find({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  async getActiveAds(): Promise<PlatformAd[]> {
    const now = new Date();
    return this.adRepository
      .createQueryBuilder('ad')
      .where('ad.is_active = true')
      .andWhere('ad.deleted_at IS NULL')
      .andWhere('(ad.starts_at IS NULL OR ad.starts_at <= :now)', { now })
      .andWhere('(ad.ends_at IS NULL OR ad.ends_at >= :now)', { now })
      .orderBy('ad.updated_at', 'DESC')
      .addOrderBy('ad.id', 'DESC')
      .getMany();
  }

  async getAllAds(): Promise<PlatformAd[]> {
    return this.adRepository.find({
      where: { deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  async reorderBanners(ids: string[]): Promise<PlatformBanner[]> {
    await this.bannerRepository.manager.transaction(async (manager) => {
      await Promise.all(
        ids.map((id, index) =>
          manager.update(PlatformBanner, { id, deletedAt: IsNull() }, { sortOrder: index }),
        ),
      );
    });
    return this.getAllBanners();
  }

  async reorderSponsors(ids: string[]): Promise<PlatformSponsor[]> {
    await this.sponsorRepository.manager.transaction(async (manager) => {
      await Promise.all(
        ids.map((id, index) =>
          manager.update(PlatformSponsor, { id, deletedAt: IsNull() }, { sortOrder: index }),
        ),
      );
    });
    return this.getAllSponsors();
  }

  getSettings(): PlatformSettings {
    return {
      storefrontUrl:
        this.configService.get<string>('app.storefrontUrl') ||
        process.env.STOREFRONT_URL ||
        'http://localhost:3000',
      currency: 'THB',
      supportEmail: process.env.PLATFORM_SUPPORT_EMAIL || 'support@sopet.co.th',
    };
  }

  async createBanner(data: Partial<PlatformBanner>): Promise<PlatformBanner> {
    const banner = this.bannerRepository.create(data);
    return this.bannerRepository.save(banner);
  }

  async updateBanner(id: string, data: Partial<PlatformBanner>): Promise<PlatformBanner> {
    const banner = await this.bannerRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!banner) {
      throw new NotFoundException({
        code: 'BANNER_NOT_FOUND',
        message: 'Platform banner not found',
      });
    }
    Object.assign(banner, data);
    return this.bannerRepository.save(banner);
  }

  async deleteBanner(id: string): Promise<boolean> {
    const banner = await this.bannerRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!banner) {
      throw new NotFoundException({
        code: 'BANNER_NOT_FOUND',
        message: 'Platform banner not found',
      });
    }
    await this.bannerRepository.softRemove(banner);
    return true;
  }

  async createSponsor(data: Partial<PlatformSponsor>): Promise<PlatformSponsor> {
    const sponsor = this.sponsorRepository.create(data);
    return this.sponsorRepository.save(sponsor);
  }

  async updateSponsor(id: string, data: Partial<PlatformSponsor>): Promise<PlatformSponsor> {
    const sponsor = await this.sponsorRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!sponsor) {
      throw new NotFoundException({
        code: 'SPONSOR_NOT_FOUND',
        message: 'Platform sponsor not found',
      });
    }
    Object.assign(sponsor, data);
    return this.sponsorRepository.save(sponsor);
  }

  async deleteSponsor(id: string): Promise<boolean> {
    const sponsor = await this.sponsorRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!sponsor) {
      throw new NotFoundException({
        code: 'SPONSOR_NOT_FOUND',
        message: 'Platform sponsor not found',
      });
    }
    await this.sponsorRepository.softRemove(sponsor);
    return true;
  }

  async createAd(data: Partial<PlatformAd>): Promise<PlatformAd> {
    const { sortOrder: _sortOrder, ...rest } = data;
    const ad = this.adRepository.create(rest);
    if (ad.isActive !== false) {
      await this.deactivateOtherAds();
    }
    return this.adRepository.save(ad);
  }

  async updateAd(id: string, data: Partial<PlatformAd>): Promise<PlatformAd> {
    const ad = await this.adRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ad) {
      throw new NotFoundException({
        code: 'AD_NOT_FOUND',
        message: 'Platform ad not found',
      });
    }
    const { sortOrder: _sortOrder, ...rest } = data;
    Object.assign(ad, rest);
    if (ad.isActive) {
      await this.deactivateOtherAds(id);
    }
    return this.adRepository.save(ad);
  }

  private async deactivateOtherAds(excludeId?: string): Promise<void> {
    const qb = this.adRepository
      .createQueryBuilder()
      .update(PlatformAd)
      .set({ isActive: false })
      .where('is_active = true')
      .andWhere('deleted_at IS NULL');
    if (excludeId) {
      qb.andWhere('id != :excludeId', { excludeId });
    }
    await qb.execute();
  }

  async deleteAd(id: string): Promise<boolean> {
    const ad = await this.adRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ad) {
      throw new NotFoundException({
        code: 'AD_NOT_FOUND',
        message: 'Platform ad not found',
      });
    }
    await this.adRepository.softRemove(ad);
    return true;
  }
}
